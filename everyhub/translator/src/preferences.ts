/*
Copyright 2026 Gwang-Jin Kim

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import fs from "node:fs";

/** Initial languages supported by the local text model. */
export const languages = ["en", "de", "ko", "uk", "ru", "pl", "el"] as const;
export type Language = (typeof languages)[number];

/** A participant's explicit choices, scoped to one room. */
export interface Preference {
    language: Language;
    automatic: boolean;
    learning: boolean;
    transcription: boolean;
}

/** Validate commands before persisting language choices. */
export function isLanguage(value: string): value is Language {
    return (languages as readonly string[]).includes(value);
}

/** Store language choices only; message text is never persisted here. */
export class Preferences {
    private rooms: Record<string, Record<string, Preference>>;
    private readonly file: string;
    private readonly mutedFile: string;
    private mutedRooms: Record<string, boolean>;
    private readonly generations = new Map<string, number>();

    public constructor(file: string) {
        this.file = file;
        this.mutedFile = file + ".muted";
        this.rooms = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
        this.mutedRooms = fs.existsSync(this.mutedFile) ? JSON.parse(fs.readFileSync(this.mutedFile, "utf8")) : {};
    }

    public isMuted(room: string): boolean {
        return this.mutedRooms[room] === true;
    }

    /** Invalidate queued work and results started before a room was switched off. */
    public generation(room: string): number {
        return this.generations.get(room) ?? 0;
    }

    public setMuted(room: string, muted: boolean): void {
        if (this.isMuted(room) === muted) return;
        if (muted) this.mutedRooms[room] = true;
        else delete this.mutedRooms[room];
        const temporary = this.mutedFile + ".tmp";
        fs.writeFileSync(temporary, JSON.stringify(this.mutedRooms), { mode: 0o600 });
        fs.renameSync(temporary, this.mutedFile);
        this.generations.set(room, this.generation(room) + 1);
    }

    public get(room: string, user: string): Preference | undefined {
        return this.rooms[room]?.[user];
    }

    public entries(room: string): [string, Preference][] {
        return Object.entries(this.rooms[room] ?? {});
    }

    public set(room: string, user: string, preference: Preference): void {
        this.rooms[room] ??= {};
        this.rooms[room][user] = { ...preference };
        this.save();
    }

    public forget(room: string, user: string): void {
        delete this.rooms[room]?.[user];
        if (this.rooms[room] && Object.keys(this.rooms[room]).length === 0) delete this.rooms[room];
        this.save();
    }

    public forgetRoom(room: string): void {
        delete this.rooms[room];
        this.setMuted(room, false);
        this.save();
    }

    private save(): void {
        const temporary = this.file + ".tmp";
        fs.writeFileSync(temporary, JSON.stringify(this.rooms), { mode: 0o600 });
        fs.renameSync(temporary, this.file);
    }
}
