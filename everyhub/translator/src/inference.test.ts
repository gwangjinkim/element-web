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
import { Inference } from "./inference.ts";

test("uses one shared worker and deletes the transient speech result after retrieving it", async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "everyhub-api-test-"));
    const calls: { url: string; options?: RequestInit }[] = [];
    const results = [
        { translatedText: "Hallo" },
        { token: "test-owner-credential" },
        { id: "speech-job" },
        { status: "complete", text: "Spoken words", detected_language: "en" },
        null,
    ];
    t.mock.method(globalThis, "fetch", async (url: string, options?: RequestInit) => {
        calls.push({ url, options });
        const result = results.shift();
        return result === null ? new Response(null, { status: 204 }) : Response.json(result);
    });
    try {
        const api = new Inference("http://shared:8000", "matrix-test-key", path.join(directory, "credential"));
        assert.equal(await api.translate("Hello", "en", "de"), "Hallo");
        assert.deepEqual(await api.transcribe(Buffer.from("audio")), { text: "Spoken words", language: "en" });
        assert.ok(calls.every((call) => call.url.startsWith("http://shared:8000/")));
        assert.equal(calls[4].options?.method, "DELETE");
        const upload = calls[2].options?.headers as Record<string, string>;
        assert.equal(upload.Authorization, "Bearer test-owner-credential");
        assert.equal(upload["X-Bot-Bridge-Key"], "matrix-test-key");
        assert.equal(fs.statSync(path.join(directory, "credential")).mode & 0o777, 0o600);
    } finally {
        fs.rmSync(directory, { recursive: true });
    }
});

test("cancels a failed speech job instead of retaining a second copy", async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "everyhub-api-test-"));
    const file = path.join(directory, "credential");
    fs.writeFileSync(file, "existing-test-credential");
    const methods: (string | undefined)[] = [];
    const results = [{ id: "speech-job" }, { status: "failed", error: "No speech detected." }, null];
    t.mock.method(globalThis, "fetch", async (_url: string, options?: RequestInit) => {
        methods.push(options?.method);
        const result = results.shift();
        return result === null ? new Response(null, { status: 204 }) : Response.json(result);
    });
    try {
        const api = new Inference("http://shared:8000", "matrix-test-key", file);
        await assert.rejects(api.transcribe(Buffer.from("audio")), /No speech/);
        assert.equal(methods.at(-1), "DELETE");
    } finally {
        fs.rmSync(directory, { recursive: true });
    }
});
