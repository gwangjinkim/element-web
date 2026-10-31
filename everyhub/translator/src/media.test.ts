/*
Copyright 2026 Gwang-Jin Kim

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { localMediaUrl, boundedBody, decryptMedia, maxMediaBytes } from "./media.ts";
import type { ChatEvent } from "./assistant.ts";

const event = (url: string): ChatEvent => ({
    event_id: "$m",
    sender: "@a:local",
    origin_server_ts: 1,
    content: { msgtype: "m.audio", url },
});

test("media cannot redirect inference to remote URLs or federated homeservers", () => {
    assert.equal(
        localMediaUrl(event("mxc://chat.local/abc"), "chat.local", "http://synapse:8008"),
        "http://synapse:8008/_matrix/client/v1/media/download/chat.local/abc",
    );
    for (const url of [
        "https://evil.example/file",
        "mxc://evil.example/a",
        "mxc://chat.local/a/../secret",
        "mxc://chat.local/a?x=1",
        "mxc://user@chat.local/a",
    ]) {
        assert.throws(() => localMediaUrl(event(url), "chat.local", "http://synapse:8008"));
    }
    const large = event("mxc://chat.local/a");
    large.content.info = { size: maxMediaBytes + 1 };
    assert.throws(() => localMediaUrl(large, "chat.local", "http://synapse:8008"));
});

test("downloads enforce actual streamed length as well as advertised size", async () => {
    assert.equal((await boundedBody(new Response("audio"))).toString(), "audio");
    await assert.rejects(boundedBody(new Response("", { headers: { "Content-Length": String(maxMediaBytes + 1) } })));
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(new Uint8Array(maxMediaBytes));
            controller.enqueue(new Uint8Array(1));
            controller.close();
        },
    });
    await assert.rejects(boundedBody(new Response(stream)), /20 MiB/);
});

test("decrypts Matrix attachments and rejects tampering before decoding audio", () => {
    const original = Buffer.from("Synthetic audio bytes");
    const key = randomBytes(32);
    const iv = Buffer.alloc(16);
    const cipher = createCipheriv("aes-256-ctr", key, iv);
    const encrypted = Buffer.concat([cipher.update(original), cipher.final()]);
    const file = {
        url: "mxc://chat.local/a",
        v: "v2",
        key: { kty: "oct", alg: "A256CTR", k: key.toString("base64url") },
        iv: iv.toString("base64"),
        hashes: { sha256: createHash("sha256").update(encrypted).digest("base64") },
    };
    assert.deepEqual(decryptMedia(encrypted, file), original);
    encrypted[0] ^= 1;
    assert.throws(() => decryptMedia(encrypted, file), /integrity/);
});
