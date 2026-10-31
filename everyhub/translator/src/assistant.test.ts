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
import { Assistant, messageBody, type ChatEvent } from "./assistant.ts";
import { Preferences } from "./preferences.ts";

function event(sender: string, body: string, msgtype = "m.text"): ChatEvent {
    return { event_id: "$test", sender, origin_server_ts: Date.now(), content: { body, msgtype } };
}

function fixture() {
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
