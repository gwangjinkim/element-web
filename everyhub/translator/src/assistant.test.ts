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
import { Preferences } from "./preferences.ts";

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
        members: async () => members,
        event: async () => event("@a:local", "clip", "m.video"),
        reply: async (_room, _event, text) => {
            replies.push(text);
        },
        translate: async (text, source, target) => `${source}:${target}:${text}`,
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

test("translates both ways using participants' own choices and shows both texts in learning mode", async () => {
    const f = fixture();
    try {
        await f.assistant.handle("!room", event("@a:local", "!language en"));
        await f.assistant.handle("!room", event("@b:local", "!language ru"));
        await f.assistant.handle("!room", event("@b:local", "!learn on"));
        f.replies.length = 0;
        await f.assistant.handle("!room", event("@a:local", "Hello"));
        assert.equal(f.replies[0], "Original (en)\nHello\n\nTranslation (en → ru)\nen:ru:Hello");
        await f.assistant.handle("!room", event("@b:local", "Привет"));
        assert.equal(f.replies[1], "Translation (ru → en)\nru:en:Привет");
        const restored = new Preferences(f.file);
        assert.equal(restored.get("!room", "@b:local")?.learning, true);
        assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
        assert.ok(!fs.readFileSync(f.file, "utf8").includes("Hello"));
    } finally {
        f.dispose();
    }
});

test("honours opt-outs, room boundaries, left members, and rejects invalid settings", async () => {
    const f = fixture();
    try {
        await f.assistant.handle("!room", event("@a:local", "!language en"));
        await f.assistant.handle("!room", event("@b:local", "!language ru"));
        await f.assistant.handle("!room", event("@a:local", "!language zz"));
        assert.equal(f.preferences.get("!room", "@a:local")?.language, "en");
        await f.assistant.handle("!room", event("@b:local", "!auto off"));
        f.replies.length = 0;
        await f.assistant.handle("!room", event("@a:local", "No reply"));
        await f.assistant.handle("!elsewhere", event("@a:local", "No cross-room settings"));
        assert.deepEqual(f.replies, []);
        await f.assistant.handle("!room", event("@b:local", "!auto on"));
        f.setMembers(["@a:local"]);
        f.replies.length = 0;
        await f.assistant.handle("!room", event("@a:local", "Recipient left"));
        assert.deepEqual(f.replies, []);
        await f.assistant.handle("!room", event("@b:local", "!forget"));
        assert.equal(f.preferences.get("!room", "@b:local"), undefined);
        assert.equal(f.preferences.get("!room", "@a:local")?.language, "en");
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
            return "Translated";
        },
        transcribe: async () => {
            transcriptions++;
            return { text: "Spoken words", language: "en" };
        },
    });
    try {
        for (const room of ["!room", "!other"]) {
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
        assert.match(f.replies.at(-1)!, /!bot off \/ !bot on/);
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
                return pending;
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
