/*
Copyright 2026 Gwang-Jin Kim

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { Preferences, isLanguage, parseLanguage, type Language, type SourceLanguage } from "./preferences.ts";

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
    reply(room: string, event: ChatEvent, text: string, html?: string): Promise<unknown>;
    pause(milliseconds: number): Promise<void>;
    translate(
        text: string,
        source: SourceLanguage,
        target: Language,
        settings?: TranslationSettings,
    ): Promise<Translation>;
    modelConfiguration(): Promise<ModelConfiguration>;
    transcribe(event: ChatEvent): Promise<{ text: string; language: string }>;
}

/** Shared model controls are supplied separately for each request, never changed globally. */
export interface TranslationSettings {
    temperature: number;
    instructions: string;
}

/** The runtime exposes the actual installed model and base prompt. */
export interface ModelConfiguration {
    model: string;
    defaultTemperature: number;
    maxTemperature: number;
    maxInstructions: number;
    promptTemplate: string;
}

/** A skipped translation must not produce a room notice. */
export interface Translation {
    translatedText: string;
    detectedLanguage: string | null;
    skipped: boolean;
}

/** Remove only the Matrix reply fallback at the start, preserving quoted text elsewhere. */
export function messageBody(event: ChatEvent): string {
    return (event.content.body ?? "").replace(/^(?:>[^\n]*\n)+\n?/, "").trim();
}

/** Commands work in Element Web, Element X, and other Matrix clients. */
export const detailedHelp = [
    "Everyhub language assistant",
    "!bot — toggle the whole assistant; !bot off / !bot on — pause/resume translations AND transcripts for everyone in this room",
    "!target en / !target english — shared language for everyone in this room",
    "!auto — toggle automatic translation; !auto on / !auto off — enable/pause it for everyone in this room",
    "!learn — toggle learning mode; !learn on / !learn off — include/omit the repeated original for this room",
    "!lang auto — detect each message's language (the default)",
    "!lang en / !lang english — override your own source language in this room",
    "!transcribe on / !transcribe off — automatically transcribe your own voice/video uploads",
    "Reply to a voice/video message with !transcribe for a one-time transcript",
    "!translate auto english text — one-time translation; or reply with !translate ru en",
    "!model — show the installed model, your room's temperature, and custom instructions",
    "!temperature — show current value; !temperature 0..1 — set it for this room; !temperature reset — restore 0",
    "!prompt — show the exact current prompt template (source/target/text are placeholders)",
    "!prompt add TEXT — append room-specific instructions; !prompt set TEXT — replace those custom instructions; !prompt reset — remove them",
    "The base translation prompt remains in place. Extra instructions may be English, are visible to this room, and are saved as configuration (maximum 1,600 characters). No message history is added to the prompt.",
    "Temperature defaults to 0 for consistent translation. Higher values add variation and may reduce fidelity. Model settings affect this room only; anyone here can change them.",
    "!settings — room and personal choices; !forget — reset your own source/transcription choices; !help — this full reference",
    "150 languages: use a code or English name, for example en/english, de/german, ko/korean, uk/ukrainian, ru/russian, pl/polish, el/greek.",
    "Messages already in the target language receive no translation. Short, mixed-language, or transliterated text may need !lang.",
    "The target, auto switch, and learning mode are shared by the room; anyone here can change them. Your source override and recording consent apply only to you.",
    "Defaults: source auto; auto on; learn off; own media transcription off. Set !target first. No target means no automatic translation.",
    "!language is a legacy alias for !lang. Source choices and recording consent from older versions remain saved; choose a shared target for the new mode.",
    "!auto off pauses automatic translations only; manual translation and opted-in transcripts still work. !bot off pauses all processing and replies except !bot, !help and !settings. Model controls !model, !prompt and !temperature also remain available while paused.",
    "Settings survive restarts. Controls suppress old queued/in-flight results. Resuming handles only new messages, with no replay.",
    "Voice language is detected automatically. Transcripts also translate into the shared target when !auto is on. Bot notices and edits are ignored to prevent loops.",
    "All replies are visible to this room. The invited assistant reads messages here; processing stays on this server.",
    "Turning the bot off does not remove its room membership or encryption keys. Remove it from the room to stop sharing new messages with it.",
    "Original messages stay in the timeline. Machine translation/transcription can make mistakes.",
    "Recordings: up to 20 MiB and 10 minutes. Live calls are not recorded or transcribed.",
].join("\n");

const commandRows = [
    ["!bot [on/off]", "All processing"],
    ["!auto [on/off]", "Auto translation"],
    ["!learn [on/off]", "Original + translation"],
    ["!target en / english", "Room language"],
    ["!lang auto / en / english", "Your source language"],
    ["!transcribe on/off", "Your recordings"],
    ["!transcribe (reply to clip)", "One transcript"],
    ["!translate auto en text", "One translation"],
    ["!model · !settings", "Current setup"],
    ["!temperature 0–1 / reset", "Sampling"],
    ["!prompt [add/set/reset]", "Translation instructions"],
    ["!forget", "Reset your choices"],
    ["!help details", "Full rules"],
];
const reminder = "Bare !bot / !auto / !learn = toggle. Room settings are shared; !lang / !transcribe are yours.";
/** A brief command reminder, with a plain-text fallback for every Matrix client. */
export const help =
    "Everyhub · quick reference\n" +
    commandRows.map(([command, meaning]) => `${command}  |  ${meaning}`).join("\n") +
    "\n" +
    reminder;
/** Static, supported Matrix HTML keeps the two-column reminder readable on phones. */
export const helpHtml =
    "<b>Everyhub · quick reference</b><table><tbody>" +
    commandRows.map(([command, meaning]) => `<tr><td><code>${command}</code></td><td>${meaning}</td></tr>`).join("") +
    "</tbody></table><p>" +
    reminder +
    "</p>";

/** Apply shared room controls and each participant's own source/media choices. */
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
            if (words.length > 2 || (words.length === 2 && !["on", "off"].includes(words[1])))
                return this.reply(
                    room,
                    event,
                    "Use !bot to toggle, !bot off to silence this room, or !bot on to resume.",
                );
            const muted = words.length === 1 ? !this.preferences.isMuted(room) : words[1] === "off";
            this.preferences.setMuted(room, muted);
            return this.reply(
                room,
                event,
                muted
                    ? "Assistant off for everyone in this room. No translations or transcripts until !bot on. " +
                          "Language choices are saved."
                    : "Assistant on for this room. Saved language and transcription choices apply to new messages.",
            );
        }
        if (command === "!help")
            return words[1] === "details"
                ? this.reply(room, event, detailedHelp)
                : this.reply(room, event, help, undefined, helpHtml);
        if (command === "!settings") {
            const choice = this.preferences.room(room);
            return this.reply(
                room,
                event,
                `Assistant for this room: ${this.preferences.isMuted(room) ? "off (!bot on to resume)" : "on"}\n` +
                    `Room target: ${choice.target ?? "not set (!target english)"}\n` +
                    `Room automatic translation: ${choice.automatic ? "on" : "off"}\n` +
                    `Room learning mode: ${choice.learning ? "on" : "off"}\n` +
                    `Your source language: ${current?.language ?? "auto"}\n` +
                    `Your media transcripts: ${current?.transcription ? "on" : "off"}\n` +
                    `Room temperature: ${choice.temperature}\nRoom extra instructions: ${choice.instructions || "none"}`,
            );
        }
        if (command === "!model") {
            const config = await this.services.modelConfiguration();
            const choice = this.preferences.room(room);
            return this.reply(
                room,
                event,
                `Model: ${config.model}\nRoom temperature: ${choice.temperature}\n` +
                    `Room extra instructions: ${choice.instructions || "none"}\n` +
                    "Use !prompt for the exact template, !temperature to change sampling, and !help for all rules.",
            );
        }
        if (command === "!temperature") {
            if (words.length === 1)
                return this.reply(
                    room,
                    event,
                    `Room temperature: ${this.preferences.room(room).temperature}. Use !temperature 0..1 or !temperature reset.`,
                );
            const value = words[1] === "reset" ? 0 : Number(words[1]);
            if (words.length !== 2 || !Number.isFinite(value) || value < 0 || value > 1)
                return this.reply(
                    room,
                    event,
                    "Use !temperature 0..1, for example !temperature 0.2, or !temperature reset.",
                );
            this.preferences.configure(room, { temperature: value });
            return this.reply(
                room,
                event,
                `Temperature is ${value} for this room only. Higher values add variation, not guaranteed accuracy.`,
            );
        }
        if (command === "!prompt") {
            if (body === "!prompt") {
                const config = await this.services.modelConfiguration();
                const choice = this.preferences.room(room);
                const template = config.promptTemplate.replace(
                    "{instructions}",
                    choice.instructions ? "4. 【用户补充要求】" + choice.instructions + "\n" : "",
                );
                return this.reply(
                    room,
                    event,
                    "Actual translation prompt template for this room (the model's authors use Chinese instructions).\n" +
                        "{source}/{target} become language names; {text} becomes the current message. No chat history is included.\n\n" +
                        template +
                        "\n\nUse !prompt add TEXT, !prompt set TEXT, or !prompt reset. Set replaces custom instructions; the base rules remain.",
                );
            }
            if (body === "!prompt reset") {
                this.preferences.configure(room, { instructions: "" });
                return this.reply(
                    room,
                    event,
                    "Custom prompt instructions removed for this room. The default translation prompt applies.",
                );
            }
            const match = body.match(/^!prompt\s+(add|set)\s+([\s\S]+)$/);
            if (!match)
                return this.reply(room, event, "Use !prompt, !prompt add TEXT, !prompt set TEXT, or !prompt reset.");
            const old = this.preferences.room(room).instructions;
            const instructions = (match[1] === "add" && old ? old + "\n" : "") + match[2].trim();
            if (!instructions || instructions.length > 1600)
                return this.reply(
                    room,
                    event,
                    "Custom instructions must contain 1–1,600 characters in total. Use !prompt set or !prompt reset to shorten them.",
                );
            this.preferences.configure(room, { instructions });
            return this.reply(room, event, "Custom prompt instructions saved for this room only:\n" + instructions);
        }
        if (this.preferences.isMuted(room)) return;
        if (command === "!forget") {
            this.preferences.forget(room, event.sender);
            return this.reply(
                room,
                event,
                "Your source language and media choices were removed. Source detection is automatic. Room settings remain.",
            );
        }
        if (command === "!target") {
            const target = parseLanguage(words.slice(1).join(" "));
            if (!target)
                return this.reply(
                    room,
                    event,
                    "Use a supported language code or English name, e.g. !target en or !target english.",
                );
            this.preferences.configure(room, { target });
            return this.reply(
                room,
                event,
                `Shared target language: ${target}. This applies to everyone in this room. ` +
                    `Messages already in this language are skipped. Automatic translation is ${this.preferences.room(room).automatic ? "on" : "off"}.`,
            );
        }
        if (["!lang", "!language"].includes(command)) {
            const value = words.slice(1).join(" ").toLowerCase();
            const language = value === "auto" ? "auto" : parseLanguage(value);
            if (!language)
                return this.reply(
                    room,
                    event,
                    "Use !lang auto, !lang en, or !lang english (your own source language).",
                );
            this.preferences.set(room, event.sender, {
                language,
                automatic: current?.automatic ?? true,
                learning: current?.learning ?? false,
                transcription: current?.transcription ?? false,
            });
            return this.reply(
                room,
                event,
                `Your source language: ${language}. ` +
                    (language === "auto"
                        ? "Each message is detected automatically."
                        : "This overrides automatic source detection for your messages. Use !lang auto to restore it."),
            );
        }
        if (["!auto", "!learn"].includes(command)) {
            if (words.length > 2 || (words.length === 2 && !["on", "off"].includes(words[1])))
                return this.reply(room, event, help);
            const field = command === "!auto" ? "automatic" : "learning";
            const enabled = words.length === 1 ? !this.preferences.room(room)[field] : words[1] === "on";
            this.preferences.configure(room, { [field]: enabled });
            return this.reply(
                room,
                event,
                `${command.slice(1)} is ${enabled ? "on" : "off"} for everyone in this room.` +
                    (!this.preferences.room(room).target ? " Choose a shared language with !target english." : ""),
            );
        }
        if (command === "!transcribe" && words.length > 1) {
            if (words.length !== 2 || !["on", "off"].includes(words[1])) return this.reply(room, event, help);
            this.preferences.set(room, event.sender, {
                language: current?.language ?? "auto",
                automatic: current?.automatic ?? true,
                learning: current?.learning ?? false,
                transcription: words[1] === "on",
            });
            return this.reply(room, event, `transcribe is ${words[1]} for your own recordings in this room.`);
        }
        if (command === "!translate") {
            const sourceCode = words[1]?.toLowerCase() === "auto" ? "auto" : parseLanguage(words[1] ?? "");
            const target = parseLanguage(words[2] ?? "");
            if (!sourceCode || !target) return this.reply(room, event, help);
            const source = words.length > 3 ? words.slice(3).join(" ") : messageBody(await this.original(room, event));
            if (!this.active(room, generation)) return;
            if (!source || source.length > 3000)
                return this.reply(room, event, "Provide up to 3,000 characters.\n" + help);
            if (sourceCode === target) return;
            const result = await this.services.translate(source, sourceCode, target, this.preferences.room(room));
            if (!result.skipped)
                await this.reply(
                    room,
                    event,
                    `${result.detectedLanguage ?? sourceCode} → ${target}\n${result.translatedText}`,
                    generation,
                );
            return;
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
        } else if (event.content.msgtype === "m.text") {
            await this.translateForRoom(room, event, body, current?.language ?? "auto", generation);
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
        await this.translateForRoom(
            room,
            event,
            result.text,
            isLanguage(result.language) ? result.language : "auto",
            generation,
        );
    }

    private async translateForRoom(
        room: string,
        event: ChatEvent,
        text: string,
        source: SourceLanguage,
        generation: number,
    ): Promise<void> {
        if (!this.active(room, generation)) return;
        const { target, automatic, learning } = this.preferences.room(room);
        if (!target || !automatic || source === target || !text.trim()) return;
        if (text.length > 3000)
            return this.reply(
                room,
                event,
                "Automatic translation supports up to 3,000 characters per message.",
                generation,
            );
        const result = await this.services.translate(text, source, target, this.preferences.room(room));
        if (result.skipped) return;
        const detected = result.detectedLanguage ?? source;
        const original = learning ? `Original (${detected})\n${text}\n\n` : "";
        await this.reply(
            room,
            event,
            `${original}Translation (${detected} → ${target})\n${result.translatedText}`,
            generation,
        );
    }

    private async reply(
        room: string,
        event: ChatEvent,
        text: string,
        generation?: number,
        html?: string,
    ): Promise<void> {
        // Retry only explicit rate-limit rejections; uncertain transport failures could otherwise duplicate a reply.
        for (let offset = 0; offset < text.length; offset += 6000) {
            for (let attempt = 0; ; attempt++) {
                if (generation !== undefined && !this.active(room, generation)) return;
                try {
                    await this.services.reply(room, event, text.slice(offset, offset + 6000), html);
                    break;
                } catch (error) {
                    const rate = error as { errcode?: string; retryAfterMs?: number };
                    if (rate?.errcode !== "M_LIMIT_EXCEEDED" || attempt >= 3) throw error;
                    const delay =
                        typeof rate.retryAfterMs === "number" && Number.isFinite(rate.retryAfterMs)
                            ? Math.min(5000, Math.max(0, rate.retryAfterMs))
                            : 1000;
                    await this.services.pause(delay + 100);
                }
            }
        }
    }
}
