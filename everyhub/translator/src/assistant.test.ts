/*
Copyright 2026 Gwang-Jin Kim

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Assistant, messageBody, type ChatEvent, type Services } from "./assistant.ts";
import { Preferences, parseLanguage } from "./preferences.ts";

function event(sender: string, body: string, msgtype = "m.text"): ChatEvent {
    return { event_id: "$test", sender, origin_server_ts: Date.now(), content: { body, msgtype } };
}

function fixture(overrides: Partial<Services> = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "everyhub-test-"));
    const file = path.join(directory, "preferences.json");
    const preferences = new Preferences(file);
    const replies: string[] = [];
    let members = ["@a:local", "@b:local"];
    const assistant = new Assistant(preferences, {
        ownUser: "@bot:local",
        pause: async () => {},
        members: async () => members,
        event: async () => event("@a:local", "clip", "m.video"),
        reply: async (_room, _event, text) => {
            replies.push(text);
        },
        translate: async (text, source, target) => ({
            translatedText: `${source}:${target}:${text}`,
            detectedLanguage: source === "auto" ? "ru" : source,
            skipped: false,
        }),
        modelConfiguration: async () => ({
            model: "Test model",
            defaultTemperature: 0,
            maxTemperature: 1,
            maxInstructions: 1600,
            promptTemplate: "Translate {source} to {target}: {text}\n{instructions}",
        }),
        transcribe: async () => ({ text: "Spoken words", language: "en" }),
        ...overrides,
    });
    return {
        assistant,
        preferences,
        replies,
        file,
        setMembers: (value: string[]) => {
            members = value;
        },
        dispose: () => fs.rmSync(directory, { recursive: true }),
    };
}

test("uses one shared target, accepts codes/names, detects unconfigured participants, and persists learning mode", async () => {
    const f = fixture();
    try {
        await f.assistant.handle("!room", event("@a:local", "!target English"));
        await f.assistant.handle("!room", event("@b:local", "!learn on"));
        f.replies.length = 0;
        await f.assistant.handle("!room", event("@b:local", "Привет"));
        assert.equal(f.replies[0], "Original (ru)\nПривет\n\nTranslation (ru → en)\nauto:en:Привет");
        await f.assistant.handle("!room", event("@a:local", "!lang russian"));
        await f.assistant.handle("!room", event("@a:local", "Привет"));
        assert.match(f.replies.at(-1)!, /ru:en:Привет/);
        await f.assistant.handle("!room", event("@a:local", "!lang auto"));
        assert.equal(f.preferences.get("!room", "@a:local")?.language, "auto");
        const restored = new Preferences(f.file);
        assert.deepEqual(restored.room("!room"), {
            target: "en",
            automatic: true,
            learning: true,
            temperature: 0,
            instructions: "",
        });
        assert.equal(fs.statSync(f.file + ".room").mode & 0o777, 0o600);
        assert.ok(!fs.readFileSync(f.file, "utf8").includes("Привет"));
        for (const [code, name] of [
            ["en", "english"],
            ["de", "German"],
            ["ru", "RUSSIAN"],
            ["uk", "Ukrainian"],
            ["ko", "korean"],
            ["pl", "Polish"],
            ["el", "Greek"],
        ])
            assert.equal(parseLanguage(name), code);
        assert.equal(parseLanguage("unsupported-language"), undefined);
    } finally {
        f.dispose();
    }
});

test("honours room auto off, source equals target, room boundaries, and invalid commands", async () => {
    let calls = 0;
    const f = fixture({
        translate: async () => {
            calls++;
            return { translatedText: "", detectedLanguage: "en", skipped: true };
        },
    });
    try {
        await f.assistant.handle("!room", event("@a:local", "!target english"));
        await f.assistant.handle("!room", event("@a:local", "!lang english"));
        await f.assistant.handle("!room", event("@a:local", "!target zz"));
        assert.equal(f.preferences.room("!room").target, "en");
        f.replies.length = 0;
        await f.assistant.handle("!room", event("@a:local", "Already English"));
        await f.assistant.handle("!elsewhere", event("@b:local", "No target"));
        assert.equal(calls, 0);
        await f.assistant.handle("!room", event("@b:local", "English detected"));
        assert.equal(calls, 1);
        assert.deepEqual(f.replies, []);
        await f.assistant.handle("!room", event("@b:local", "!auto off"));
        f.replies.length = 0;
        await f.assistant.handle("!room", event("@b:local", "Paused"));
        assert.equal(calls, 1);
        assert.deepEqual(f.replies, []);
        await f.assistant.handle("!room", event("@b:local", "!auto on"));
        await f.assistant.handle("!room", event("@a:local", "!forget"));
        assert.equal(f.preferences.get("!room", "@a:local"), undefined);
        assert.equal(f.preferences.room("!room").target, "en");
    } finally {
        f.dispose();
    }
});

test("transcribes voice/video only after opting in or an explicit reply request", async () => {
    const f = fixture();
    try {
        await f.assistant.handle("!room", event("@a:local", "clip", "m.video"));
        assert.deepEqual(f.replies, []);
        await f.assistant.handle("!room", event("@a:local", "!language en"));
        await f.assistant.handle("!room", event("@a:local", "!transcribe on"));
        f.replies.length = 0;
        await f.assistant.handle("!room", event("@a:local", "clip", "m.audio"));
        assert.equal(f.replies[0], "Transcript (en)\nSpoken words");
        const manual = event("@b:local", "!transcribe");
        manual.content["m.relates_to"] = { "m.in_reply_to": { event_id: "$clip" } };
        await f.assistant.handle("!room", manual);
        assert.equal(f.replies[1], "Transcript (en)\nSpoken words");
        await f.assistant.handle("!room", event("@a:local", "!transcribe off"));
        f.replies.length = 0;
        await f.assistant.handle("!room", event("@a:local", "clip", "m.video"));
        assert.deepEqual(f.replies, []);
    } finally {
        f.dispose();
    }
});

test("ignores bot replies, notices, and edits without translation loops", async () => {
    const f = fixture();
    try {
        await f.assistant.handle("!room", event("@bot:local", "!help"));
        await f.assistant.handle("!room", event("@a:local", "Notice", "m.notice"));
        const edit = event("@a:local", "!language ru");
        edit.content["m.relates_to"] = { rel_type: "m.replace" };
        await f.assistant.handle("!room", edit);
        assert.deepEqual(f.replies, []);
        assert.equal(f.preferences.get("!room", "@a:local"), undefined);
    } finally {
        f.dispose();
    }
});

test("removes reply fallbacks without destroying later quoted lines", () => {
    assert.equal(
        messageBody(event("@a:local", "> <@b:local> Before\n\n!translate ru en\n> keep")),
        "!translate ru en\n> keep",
    );
});

test("room off persists, silences automatic and manual work, and resumes saved choices only in that room", async () => {
    let translations = 0;
    let transcriptions = 0;
    const f = fixture({
        translate: async () => {
            translations++;
            return { translatedText: "Translated", detectedLanguage: "en", skipped: false };
        },
        transcribe: async () => {
            transcriptions++;
            return { text: "Spoken words", language: "en" };
        },
    });
    try {
        for (const room of ["!room", "!other"]) {
            await f.assistant.handle(room, event("@a:local", "!target russian"));
            await f.assistant.handle(room, event("@a:local", "!language en"));
            await f.assistant.handle(room, event("@b:local", "!language ru"));
        }
        await f.assistant.handle("!room", event("@a:local", "!transcribe on"));
        await f.assistant.handle("!room", event("@b:local", "!bot off"));
        assert.match(f.replies.at(-1)!, /off for everyone/);
        assert.equal(new Preferences(f.file).isMuted("!room"), true);
        assert.equal(fs.statSync(f.file + ".muted").mode & 0o777, 0o600);
        f.replies.length = 0;
        for (const body of ["Hello", "!translate en ru Hello", "!transcribe", "!language de", "!auto on"]) {
            await f.assistant.handle("!room", event("@a:local", body));
        }
        for (const type of ["m.audio", "m.video"]) {
            await f.assistant.handle("!room", event("@a:local", "Recording", type));
        }
        assert.deepEqual(f.replies, []);
        assert.equal(translations, 0);
        assert.equal(transcriptions, 0);
        assert.equal(f.preferences.get("!room", "@a:local")?.language, "en");
        await f.assistant.handle("!room", event("@a:local", "!settings"));
        assert.match(f.replies.at(-1)!, /Assistant for this room: off/);
        await f.assistant.handle("!room", event("@a:local", "!help"));
        assert.match(f.replies.at(-1)!, /!bot \[on\/off\]/);
        await f.assistant.handle("!other", event("@a:local", "Other room"));
        assert.equal(translations, 1);
        await f.assistant.handle("!room", event("@a:local", "!bot invalid"));
        assert.equal(f.preferences.isMuted("!room"), true);
        await f.assistant.handle("!room", event("@a:local", "!bot on"));
        assert.equal(new Preferences(f.file).isMuted("!room"), false);
        assert.equal(translations, 1);
        await f.assistant.handle("!room", event("@a:local", "New message"));
        assert.equal(translations, 2);
        await f.assistant.handle("!room", event("@a:local", "Recording", "m.audio"));
        assert.equal(transcriptions, 1);
        f.preferences.setMuted("!room", true);
        f.preferences.forgetRoom("!room");
        assert.equal(new Preferences(f.file).isMuted("!room"), false);
    } finally {
        f.dispose();
    }
});

test("suppresses translation and transcript results started before off, even if on follows immediately", async () => {
    for (const body of ["!translate en ru Hello", "!transcribe"]) {
        let finish!: (value: string) => void;
        let started!: () => void;
        const pending = new Promise<string>((resolve) => {
            finish = resolve;
        });
        const entered = new Promise<void>((resolve) => {
            started = resolve;
        });
        const f = fixture({
            translate: async () => {
                started();
                return { translatedText: await pending, detectedLanguage: "en", skipped: false };
            },
            transcribe: async () => {
                started();
                return { text: await pending, language: "en" };
            },
        });
        try {
            const request = event("@a:local", body);
            request.content["m.relates_to"] = { "m.in_reply_to": { event_id: "$clip" } };
            const running = f.assistant.handle("!room", request);
            await entered;
            await f.assistant.handle("!room", event("@a:local", "!bot off"));
            await f.assistant.handle("!room", event("@a:local", "!bot on"));
            f.replies.length = 0;
            finish("Old result");
            await running;
            assert.deepEqual(f.replies, []);
        } finally {
            f.dispose();
        }
    }
});

test("loads legacy source/transcription settings without inventing a shared target", () => {
    const f = fixture();
    try {
        fs.writeFileSync(
            f.file,
            JSON.stringify({
                "!room": {
                    "@a:local": {
                        language: "de",
                        automatic: true,
                        learning: true,
                        transcription: true,
                    },
                },
            }),
        );
        const legacy = new Preferences(f.file);
        assert.equal(legacy.get("!room", "@a:local")?.transcription, true);
        assert.equal(legacy.room("!room").target, undefined);
        legacy.configure("!room", { target: "en", learning: true });
        legacy.forgetRoom("!room");
        assert.equal(new Preferences(f.file).room("!room").target, undefined);
    } finally {
        f.dispose();
    }
});

test("room translation changes suppress an in-flight result and learning off omits repeated original", async () => {
    let finish!: (value: { translatedText: string; detectedLanguage: string; skipped: boolean }) => void;
    const pending = new Promise<{ translatedText: string; detectedLanguage: string; skipped: boolean }>((resolve) => {
        finish = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const f = fixture({
        translate: async () => {
            entered();
            return pending;
        },
    });
    try {
        await f.assistant.handle("!room", event("@a:local", "!target en"));
        const running = f.assistant.handle("!room", event("@b:local", "Привет"));
        await started;
        await f.assistant.handle("!room", event("@a:local", "!auto off"));
        f.replies.length = 0;
        finish({ translatedText: "Hello", detectedLanguage: "ru", skipped: false });
        await running;
        assert.deepEqual(f.replies, []);
        await f.assistant.handle("!room", event("@a:local", "!auto on"));
        f.replies.length = 0;
        await f.assistant.handle("!room", event("@b:local", "Привет"));
        assert.equal(f.replies[0], "Translation (ru → en)\nHello");
    } finally {
        f.dispose();
    }
});

test("bare bot, auto and learn commands toggle and explicit states remain idempotent", async () => {
    const f = fixture();
    try {
        for (const [command, field] of [
            ["!auto", "automatic"],
            ["!learn", "learning"],
        ] as const) {
            const before = f.preferences.room("!room")[field];
            await f.assistant.handle("!room", event("@a:local", command));
            assert.equal(f.preferences.room("!room")[field], !before);
            assert.match(f.replies.at(-1)!, new RegExp(`is ${before ? "off" : "on"} for everyone`));
            await f.assistant.handle("!room", event("@b:local", command));
            assert.equal(f.preferences.room("!room")[field], before);
            await f.assistant.handle("!room", event("@a:local", command + " off"));
            await f.assistant.handle("!room", event("@a:local", command + " off"));
            assert.equal(f.preferences.room("!room")[field], false);
            await f.assistant.handle("!room", event("@a:local", command + " invalid"));
            assert.equal(f.preferences.room("!room")[field], false);
        }
        await f.assistant.handle("!room", event("@a:local", "!bot"));
        assert.equal(f.preferences.isMuted("!room"), true);
        await f.assistant.handle("!room", event("@b:local", "!bot"));
        assert.equal(f.preferences.isMuted("!room"), false);
        await f.assistant.handle("!room", event("@a:local", "!bot on"));
        assert.equal(f.preferences.isMuted("!room"), false);
        await f.assistant.handle("!room", event("@a:local", "!help details"));
        for (const command of [
            "!bot",
            "!auto",
            "!learn",
            "!target",
            "!lang",
            "!transcribe",
            "!translate",
            "!forget",
            "!settings",
            "!help",
        ])
            assert.ok(f.replies.at(-1)!.includes(command));
        assert.match(f.replies.at(-1)!, /Defaults:/);
        assert.match(f.replies.at(-1)!, /encryption keys/);
    } finally {
        f.dispose();
    }
});

test("room model controls show the actual prompt, append/replace/reset instructions, and isolate sampling", async () => {
    const calls: { temperature: number; instructions: string }[] = [];
    const f = fixture({
        translate: async (_text, _source, _target, settings) => {
            calls.push({ temperature: settings!.temperature, instructions: settings!.instructions });
            return { translatedText: "Hello", detectedLanguage: "ru", skipped: false };
        },
    });
    try {
        await f.assistant.handle("!room", event("@a:local", "!model"));
        assert.match(f.replies.at(-1)!, /Test model/);
        await f.assistant.handle("!room", event("@a:local", "!temperature 0.2"));
        await f.assistant.handle("!room", event("@a:local", "!prompt set Keep it informal."));
        await f.assistant.handle("!room", event("@a:local", "!prompt add Preserve names."));
        assert.equal(f.preferences.room("!room").instructions, "Keep it informal.\nPreserve names.");
        await f.assistant.handle("!room", event("@a:local", "!prompt"));
        assert.match(f.replies.at(-1)!, /Translate \{source\} to \{target\}: \{text\}/);
        assert.match(f.replies.at(-1)!, /Keep it informal/);
        for (const room of ["!room", "!other"]) {
            await f.assistant.handle(room, event("@a:local", "!target english"));
            await f.assistant.handle(room, event("@a:local", "Привет"));
        }
        assert.deepEqual(calls, [
            { temperature: 0.2, instructions: "Keep it informal.\nPreserve names." },
            { temperature: 0, instructions: "" },
        ]);
        assert.equal(new Preferences(f.file).room("!room").temperature, 0.2);
        for (const command of [
            "!temperature -1",
            "!temperature NaN",
            "!temperature 1.1",
            "!temperature 0 extra",
            "!prompt set " + "x".repeat(1601),
            "!prompt bogus",
        ]) {
            await f.assistant.handle("!room", event("@a:local", command));
        }
        assert.equal(f.preferences.room("!room").temperature, 0.2);
        await f.assistant.handle("!room", event("@a:local", "!bot off"));
        await f.assistant.handle("!room", event("@a:local", "!prompt set Use formal language."));
        assert.equal(f.preferences.room("!room").instructions, "Use formal language.");
        await f.assistant.handle("!room", event("@a:local", "!prompt reset"));
        await f.assistant.handle("!room", event("@a:local", "!temperature reset"));
        await f.assistant.handle("!room", event("@a:local", "!temperature"));
        assert.match(f.replies.at(-1)!, /Room temperature: 0/);
        assert.equal(f.preferences.room("!room").instructions, "");
    } finally {
        f.dispose();
    }
});

test("help is a compact HTML table with a short fallback; full rules are optional", async () => {
    const rendered: { text: string; html?: string }[] = [];
    const f = fixture({
        reply: async (_room, _event, text, html) => {
            rendered.push({ text, html });
        },
    });
    try {
        await f.assistant.handle("!room", event("@a:local", "!help"));
        assert.ok(rendered[0].text.length < 1000);
        assert.match(rendered[0].html!, /<table>/);
        assert.match(rendered[0].html!, /!temperature/);
        assert.match(rendered[0].text, /!help details/);
        await f.assistant.handle("!room", event("@a:local", "!help details"));
        assert.match(rendered[1].text, /Defaults:/);
        assert.equal(rendered[1].html, undefined);
    } finally {
        f.dispose();
    }
});

test("rate-limited replies retry, but a paused room suppresses a stale translation retry", async () => {
    let attempts = 0;
    const waits: number[] = [];
    const f = fixture({
        reply: async () => {
            if (++attempts === 1) throw { errcode: "M_LIMIT_EXCEEDED", retryAfterMs: 250 };
        },
        pause: async (ms) => {
            waits.push(ms);
        },
    });
    try {
        await f.assistant.handle("!room", event("@a:local", "!help"));
        assert.equal(attempts, 2);
        assert.deepEqual(waits, [350]);
        f.preferences.configure("!room", { target: "en" });
        let retried = 0;
        const blocked = fixture({
            reply: async () => {
                retried++;
                throw { errcode: "M_LIMIT_EXCEEDED", retryAfterMs: 0 };
            },
            pause: async () => {
                blocked.preferences.setMuted("!room", true);
            },
        });
        try {
            blocked.preferences.configure("!room", { target: "en" });
            await blocked.assistant.handle("!room", event("@a:local", "Привет"));
            assert.equal(retried, 1);
        } finally {
            blocked.dispose();
        }
    } finally {
        f.dispose();
    }
});
