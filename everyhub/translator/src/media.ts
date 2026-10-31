/*
Copyright 2026 Gwang-Jin Kim

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { createHash, createDecipheriv, timingSafeEqual } from "node:crypto";
import type { ChatEvent } from "./assistant.ts";

/** Limit allocations even if an attachment's advertised size is false. */
export const maxMediaBytes = 20 * 1024 * 1024;

/** Reject federated or arbitrary URLs before requesting media. */
export function localMediaUrl(event: ChatEvent, domain: string, homeserver: string): string {
    const raw = event.content.file?.url ?? event.content.url ?? "";
    const match = raw.match(/^mxc:\/\/([^/]+)\/([A-Za-z0-9_-]+)$/);
    if (!match || match[1] !== domain) {
        throw new Error("Only media uploaded to this private homeserver can be transcribed.");
    }
    if ((event.content.info?.size ?? 0) > maxMediaBytes || (event.content.info?.duration ?? 0) > 600000) {
        throw new Error("Recordings must be at most 20 MiB and 10 minutes.");
    }
    return `${homeserver}/_matrix/client/v1/media/download/${encodeURIComponent(domain)}/${match[2]}`;
}

/** Enforce limits while streaming instead of trusting Content-Length. */
export async function boundedBody(response: Response): Promise<Buffer> {
    if (!response.ok || !response.body) throw new Error("The recording could not be downloaded.");
    if (Number(response.headers.get("content-length")) > maxMediaBytes) throw new Error("Recording exceeds 20 MiB.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > maxMediaBytes) throw new Error("Recording exceeds 20 MiB.");
            chunks.push(value);
        }
    } finally {
        await reader.cancel().catch(() => {});
    }
    if (!size) throw new Error("The recording is empty.");
    return Buffer.concat(chunks, size);
}

/** Verify Matrix v2 attachment integrity before decrypting AES-CTR media. */
export function decryptMedia(buffer: Buffer, file: ChatEvent["content"]["file"]): Buffer {
    if (!file) return buffer;
    const key = Buffer.from(file.key.k, "base64url");
    const iv = Buffer.from(file.iv, "base64");
    const expected = Buffer.from(file.hashes.sha256, "base64");
    const actual = createHash("sha256").update(buffer).digest();
    if (
        file.v !== "v2" ||
        file.key.kty !== "oct" ||
        file.key.alg !== "A256CTR" ||
        key.length !== 32 ||
        iv.length !== 16 ||
        expected.length !== 32 ||
        !timingSafeEqual(expected, actual)
    ) {
        throw new Error("The encrypted recording failed its integrity check.");
    }
    const decipher = createDecipheriv("aes-256-ctr", key, iv);
    return Buffer.concat([decipher.update(buffer), decipher.final()]);
}
