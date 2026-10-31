/*
Copyright 2026 Gwang-Jin Kim

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import fs from "node:fs";
import type { Translation, ModelConfiguration, TranslationSettings } from "./assistant.ts";
import type { Language, SourceLanguage } from "./preferences.ts";

/** Access the existing shared inference worker; no models run in the Matrix bot. */
export class Inference {
    private readonly base: string;
    private readonly key: string;
    private readonly credentialFile: string;
    private token?: string;

    public constructor(base: string, key: string, credentialFile: string) {
        this.base = base.replace(/\/$/, "");
        this.key = key;
        this.credentialFile = credentialFile;
        if (fs.existsSync(credentialFile)) this.token = fs.readFileSync(credentialFile, "utf8").trim();
    }

    public async translate(
        text: string,
        source: SourceLanguage,
        target: Language,
        settings?: TranslationSettings,
    ): Promise<Translation> {
        const response = await fetch(this.base + "/internal/text-translation", {
            method: "POST",
            signal: AbortSignal.timeout(300000),
            headers: { "Content-Type": "application/json", "X-Matrix-Translation-Key": this.key },
            body: JSON.stringify({
                text,
                source,
                target,
                temperature: settings?.temperature ?? 0,
                instructions: settings?.instructions ?? "",
            }),
        });
        if (!response.ok) throw new Error("The local translation service is unavailable.");
        const result = (await response.json()) as Translation;
        if (
            typeof result.translatedText !== "string" ||
            typeof result.skipped !== "boolean" ||
            (!result.skipped && !result.translatedText.trim()) ||
            (result.detectedLanguage !== null && typeof result.detectedLanguage !== "string")
        )
            throw new Error("Invalid translation result.");
        return result;
    }

    public async modelConfiguration(): Promise<ModelConfiguration> {
        const response = await fetch(this.base + "/internal/text-translation/config", {
            headers: { "X-Matrix-Translation-Key": this.key },
            signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error("The local model configuration is unavailable.");
        const result = (await response.json()) as ModelConfiguration;
        if (
            typeof result.model !== "string" ||
            typeof result.promptTemplate !== "string" ||
            result.maxTemperature !== 1 ||
            result.maxInstructions !== 1600 ||
            result.defaultTemperature !== 0
        )
            throw new Error("Invalid model configuration.");
        return result;
    }

    public async transcribe(audio: Buffer): Promise<{ text: string; language: string }> {
        if (!this.token) {
            const response = await fetch(this.base + "/v1/installations", {
                method: "POST",
                signal: AbortSignal.timeout(15000),
            });
            if (!response.ok) throw new Error("The transcription service could not be connected.");
            const credential = (await response.json()) as { token: string };
            if (typeof credential.token !== "string") throw new Error("Invalid transcription credential.");
            this.token = credential.token;
            fs.writeFileSync(this.credentialFile, this.token, { mode: 0o600 });
        }
        const headers = { "Authorization": `Bearer ${this.token}`, "X-Bot-Bridge-Key": this.key };
        const response = await fetch(this.base + "/v1/transcriptions?filename=recording&language=auto", {
            method: "POST",
            body: new Uint8Array(audio),
            headers,
            signal: AbortSignal.timeout(120000),
        });
        if (!response.ok) throw new Error("The recording was rejected. Check the size, length, and service queue.");
        const job = (await response.json()) as { id: string };
        const url = this.base + "/v1/jobs/" + encodeURIComponent(job.id);
        try {
            const deadline = Date.now() + 15 * 60 * 1000;
            while (Date.now() < deadline) {
                const poll = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
                if (!poll.ok) throw new Error("The transcription result is unavailable.");
                const result = (await poll.json()) as {
                    status: string;
                    text?: string;
                    detected_language?: string;
                    error?: string;
                };
                if (result.status === "complete" && result.text) {
                    return { text: result.text, language: result.detected_language ?? "unknown" };
                }
                if (["failed", "cancelled"].includes(result.status)) {
                    throw new Error(result.error ?? "The recording could not be transcribed.");
                }
                await new Promise((resolve) => setTimeout(resolve, 1500));
            }
            throw new Error("Transcription timed out. Try a shorter recording.");
        } finally {
            // The encrypted Matrix reply becomes the retained transcript, rather than a second API copy.
            await fetch(url, { method: "DELETE", headers, signal: AbortSignal.timeout(15000) }).catch(() => {});
        }
    }
}
