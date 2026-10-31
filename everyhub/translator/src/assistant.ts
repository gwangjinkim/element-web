/*
Copyright 2026 Gwang-Jin Kim

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { Preferences, isLanguage, type Language } from "./preferences.ts";

/** The subset of a decrypted Matrix event used by the assistant. */
export interface ChatEvent {
    event_id: string;
    sender: string;
    origin_server_ts: number;
    content: {
        "body"?: string;
        "msgtype"?: string;
        "url"?: string;
        "file"?: {
            url: string;
            v: string;
            key: { kty: string; alg: string; k: string };
            iv: string;
            hashes: { sha256: string };
        };
        "info"?: { size?: number; duration?: number };
        "m.relates_to"?: {
            "rel_type"?: string;
            "m.in_reply_to"?: { event_id: string };
        };
    };
}

/** Matrix and inference operations are injected so policy can be tested without sending messages. */
export interface Services {
    ownUser: string;
    members(room: string): Promise<string[]>;
    event(room: string, id: string): Promise<ChatEvent>;
    reply(room: string, event: ChatEvent, text: string): Promise<unknown>;
    translate(text: string, source: Language, target: Language): Promise<string>;
    transcribe(event: ChatEvent): Promise<{ text: string; language: string }>;
}

/** Remove only the Matrix reply fallback at the start, preserving quoted text elsewhere. */
export function messageBody(event: ChatEvent): string {
    return (event.content.body ?? "").replace(/^(?:>[^\n]*\n)+\n?/, "").trim();
}

/** Commands work in Element Web, Element X, and other Matrix clients. */
export const help = [
    "Everyhub language assistant",
    "!bot off / !bot on — pause/resume all translations and transcripts for everyone in this room",
    "!language en — choose your writing/reading language and enable automatic translation in this room",
    "!learn on / !learn off — include original text with translations into your language",
    "!auto on / !auto off — receive automatic translations in this room",
    "!transcribe on / !transcribe off — automatically transcribe your own voice/video uploads",
    "Reply to a voice/video message with !transcribe for a one-time transcript",
    "!translate en ru Hello — one-time translation; or reply with !translate ru en",
    "!settings — your choices; !forget — remove your choices for this room",
    "Languages: en, de, ko, uk, ru, pl, el.",
    "All replies are visible to this room. The invited assistant reads messages here; processing stays on this server.",
    "Original messages stay in the timeline. Machine translation/transcription can make mistakes.",
    "Recordings: up to 20 MiB and 10 minutes. Live calls are not recorded or transcribed.",
].join("\n");

/** Apply per-participant preferences without changing another participant's settings. */
export class Assistant {
    private readonly preferences: Preferences;
    private readonly services: Services;

    public constructor(preferences: Preferences, services: Services) {
        this.preferences = preferences;
        this.services = services;
    }

    public async handle(room: string, event: ChatEvent): Promise<void> {
        if (event.sender === this.services.ownUser || event.content["m.relates_to"]?.rel_type === "m.replace") return;
        const body = messageBody(event);
        const words = body.split(/\s+/);
        const command = words[0];
        const current = this.preferences.get(room, event.sender);
        const generation = this.preferences.generation(room);

        if (command === "!bot") {
            if (words.length !== 2 || !["on", "off"].includes(words[1]))
                return this.reply(room, event, "Use !bot off to silence this room, or !bot on to resume.");
            this.preferences.setMuted(room, words[1] === "off");
            return this.reply(
                room,
                event,
                words[1] === "off"
                    ? "Assistant off for everyone in this room. No translations or transcripts until !bot on. " +
                          "Language choices are saved."
                    : "Assistant on for this room. Saved language and transcription choices apply to new messages.",
            );
        }
        if (command === "!help") return this.reply(room, event, help);
        if (command === "!settings") {
            const status = `Assistant for this room: ${this.preferences.isMuted(room) ? "off (!bot on to resume)" : "on"}\n`;
            return this.reply(
                room,
                event,
                status +
                    (current
                        ? `Language: ${current.language}\nAutomatic: ${current.automatic ? "on" : "off"}\n` +
                          `Learning: ${current.learning ? "on" : "off"}\nYour media transcripts: ${current.transcription ? "on" : "off"}`
                        : "No language choices saved for you in this room.\n" + help),
            );
        }
        if (this.preferences.isMuted(room)) return;
        if (command === "!forget") {
            this.preferences.forget(room, event.sender);
            return this.reply(room, event, "Your language choices for this room have been removed.");
        }
        if (command === "!language") {
            if (words.length !== 2 || !isLanguage(words[1])) return this.reply(room, event, help);
            this.preferences.set(room, event.sender, {
                language: words[1],
                automatic: true,
                learning: current?.learning ?? false,
                transcription: current?.transcription ?? false,
            });
            return this.reply(
                room,
                event,
                `Your language is ${words[1]}; automatic translation is on for this room.\n` +
                    "Each participant should set their own language. Use !learn on to see both languages.\n" +
                    "The assistant processes messages you send here. Replies are visible to everyone in this room.",
            );
        }
        if (["!auto", "!learn"].includes(command) || (command === "!transcribe" && words.length > 1)) {
            if (!current) return this.reply(room, event, "First choose your language, for example: !language en");
            if (words.length !== 2 || !["on", "off"].includes(words[1])) return this.reply(room, event, help);
            const field = command === "!auto" ? "automatic" : command === "!learn" ? "learning" : "transcription";
            this.preferences.set(room, event.sender, { ...current, [field]: words[1] === "on" });
            return this.reply(room, event, `${command.slice(1)} is ${words[1]} for you in this room.`);
        }
        if (command === "!translate") {
            const match = body.match(/^!translate\s+([a-z]{2})\s+([a-z]{2})(?:\s+([\s\S]+))?$/);
            if (!match || !isLanguage(match[1]) || !isLanguage(match[2])) return this.reply(room, event, help);
            const source = match[3] ?? messageBody(await this.original(room, event));
            if (!this.active(room, generation)) return;
            if (!source || source.length > 3000)
                return this.reply(room, event, "Provide up to 3,000 characters.\n" + help);
            const translated = await this.services.translate(source, match[1], match[2]);
            return this.reply(room, event, `${match[1]} → ${match[2]}\n${translated}`, generation);
        }
        if (command === "!transcribe") {
            const original = await this.original(room, event);
            if (!this.active(room, generation)) return;
            if (!this.isMedia(original))
                return this.reply(room, event, "Reply to a recorded voice or video message with !transcribe.");
            return this.transcribe(room, original, generation);
        }
        if (body.startsWith("!") || event.content.msgtype === "m.notice") return;
        if (this.isMedia(event)) {
            if (current?.transcription) await this.transcribe(room, event, generation);
        } else if (current && event.content.msgtype === "m.text") {
            await this.translateForRoom(room, event, body, current.language, generation);
        }
    }

    private async original(room: string, event: ChatEvent): Promise<ChatEvent> {
        const id = event.content["m.relates_to"]?.["m.in_reply_to"]?.event_id;
        return id ? this.services.event(room, id) : event;
    }

    private isMedia(event: ChatEvent): boolean {
        return ["m.audio", "m.video"].includes(event.content.msgtype ?? "");
    }

    private active(room: string, generation: number): boolean {
        return !this.preferences.isMuted(room) && this.preferences.generation(room) === generation;
    }

    private async transcribe(room: string, event: ChatEvent, generation: number): Promise<void> {
        if (!this.active(room, generation)) return;
        const result = await this.services.transcribe(event);
        await this.reply(room, event, `Transcript (${result.language})\n${result.text}`, generation);
        if (isLanguage(result.language))
            await this.translateForRoom(room, event, result.text, result.language, generation);
    }

    private async translateForRoom(
        room: string,
        event: ChatEvent,
        text: string,
        source: Language,
        generation: number,
    ): Promise<void> {
        if (!this.active(room, generation)) return;
        const joined = new Set(await this.services.members(room));
        if (!this.active(room, generation)) return;
        const targets = new Map<Language, boolean>();
        for (const [user, preference] of this.preferences.entries(room)) {
            if (user === event.sender || !joined.has(user) || !preference.automatic || preference.language === source)
                continue;
            targets.set(preference.language, (targets.get(preference.language) ?? false) || preference.learning);
        }
        if (targets.size === 0) return;
        if (text.length > 3000)
            return this.reply(
                room,
                event,
                "Automatic translation supports up to 3,000 characters per message.",
                generation,
            );
        for (const [target, learning] of targets) {
            if (!this.active(room, generation)) return;
            const translated = await this.services.translate(text, source, target);
            const original = learning ? `Original (${source})\n${text}\n\n` : "";
            await this.reply(room, event, `${original}Translation (${source} → ${target})\n${translated}`, generation);
        }
    }

    private async reply(room: string, event: ChatEvent, text: string, generation?: number): Promise<void> {
        // Matrix events have a size limit. Split long transcripts without dropping any text.
        for (let offset = 0; offset < text.length; offset += 6000) {
            if (generation !== undefined && !this.active(room, generation)) return;
            await this.services.reply(room, event, text.slice(offset, offset + 6000));
        }
    }
}
