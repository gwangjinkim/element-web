/*
Copyright 2026 Gwang-Jin Kim

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import fs from "node:fs";
import {
    MatrixClient,
    SimpleFsStorageProvider,
    RustSdkCryptoStorageProvider,
    LogService,
    LogLevel,
} from "matrix-bot-sdk";
import { Assistant, messageBody, type ChatEvent } from "./assistant.ts";
import { Preferences } from "./preferences.ts";
import { Inference } from "./inference.ts";
import { boundedBody, decryptMedia, localMediaUrl } from "./media.ts";

LogService.setLevel(LogLevel.ERROR);
const credentials = JSON.parse(fs.readFileSync("/data/credentials.json", "utf8"));
const homeserver = "http://synapse:8008";
const domain = process.env.CHAT_DOMAIN;
if (!domain || !process.env.TRANSLATION_API_KEY || !process.env.TRANSLATION_API_URL) {
    throw new Error("Missing Matrix or shared inference configuration.");
}
const client = new MatrixClient(
    homeserver,
    credentials.access_token,
    new SimpleFsStorageProvider("/data/sync.json"),
    new RustSdkCryptoStorageProvider("/data/crypto", 0), // StoreType.Sqlite, preserving the existing store.
);
const preferences = new Preferences("/data/preferences.json");
const inference = new Inference(
    new URL(process.env.TRANSLATION_API_URL).origin,
    process.env.TRANSLATION_API_KEY,
    "/data/speech-credential",
);
const assistant = new Assistant(preferences, {
    ownUser: credentials.user_id,
    members: (room) => client.getJoinedRoomMembers(room),
    event: async (room, id) => (await client.getEvent(room, id)) as ChatEvent,
    reply: (room, event, text) => client.replyNotice(room, event, text),
    translate: (text, source, target) => inference.translate(text, source, target),
    transcribe: async (event) => {
        const url = localMediaUrl(event, domain, homeserver);
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${credentials.access_token}` },
            redirect: "error",
            signal: AbortSignal.timeout(120000),
        });
        return inference.transcribe(decryptMedia(await boundedBody(response), event.content.file));
    },
});
const started = Date.now();
const seen = new Set<string>();
let queued = 0;
let queue = Promise.resolve();
let stopping = false;
client.on("room.invite", async (room: string, event: ChatEvent) => {
    if (event.sender.endsWith(":" + domain)) await client.joinRoom(room);
});
client.on("room.message", (room: string, event: ChatEvent) => {
    if (
        stopping ||
        event.sender === credentials.user_id ||
        event.origin_server_ts < started - 10000 ||
        !event.sender.endsWith(":" + domain) ||
        seen.has(event.event_id)
    )
        return;
    seen.add(event.event_id);
    if (seen.size > 2000) seen.delete(seen.values().next().value!);
    const command = messageBody(event).split(/\s+/, 1)[0];
    const generation = preferences.generation(room);
    // Room controls bypass slow inference so off also suppresses an in-flight result.
    if (command === "!bot") {
        assistant.handle(room, event).catch(() => console.error("Language assistant room control failed"));
        return;
    }
    if (preferences.isMuted(room) && !["!help", "!settings"].includes(command)) return;
    if (queued >= 20) {
        client.replyNotice(room, event, "The language assistant queue is full. Try again shortly.").catch(() => {});
        return;
    }
    queued++;
    queue = queue
        .then(() => {
            if (preferences.generation(room) === generation) return assistant.handle(room, event);
        })
        .catch(async (error: unknown) => {
            // Never log message text, attachments, keys, or raw exception payloads.
            console.error("Language assistant request failed", error instanceof Error ? error.name : "Error");
            if (preferences.isMuted(room) || preferences.generation(room) !== generation) return;
            await client
                .replyNotice(
                    room,
                    event,
                    "The language assistant could not process this message. Check that recordings are under 20 MiB and " +
                        "10 minutes, then try again. Use !help for commands.",
                )
                .catch(() => {});
        })
        .finally(() => queued--);
});
client.on("room.failed_decryption", () =>
    console.error("Verify the assistant device to decrypt this room's messages."),
);
await client.start();
console.log("Everyhub language assistant connected");
process.on("SIGTERM", () => {
    stopping = true;
    client.stop();
    // Do not accept new messages; finish the bounded in-flight job before exiting when possible.
    queue.finally(() => process.exit(0));
});
