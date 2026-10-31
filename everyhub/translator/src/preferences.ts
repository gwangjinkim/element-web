/*
Copyright 2026 Gwang-Jin Kim

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import fs from "node:fs";

import inventory from "./languages.json" with { type: "json" };

/** Canonical codes from the model's published 150-language inventory. */
export const languages = inventory.languages.map((entry) => entry.code);
export type Language = string;
export type SourceLanguage = Language | "auto";
const aliases = new Map<string, Language>();
for (const entry of inventory.languages) {
    for (const alias of [...entry.aliases, entry.name]) aliases.set(alias.toLowerCase(), entry.code);
}
for (const [alias, code] of Object.entries({
    deutsch: "de",
    korean: "ko",
    korea: "ko",
    ukrainian: "uk",
    polish: "pl",
})) {
    aliases.set(alias, code);
}

/** Accept a short code, published identifier, or English language name. */
export function parseLanguage(value: string): Language | undefined {
    return aliases.get(value.trim().toLowerCase());
}

/** Validate canonical language codes returned by the service. */
export function isLanguage(value: string): value is Language {
    return languages.includes(value);
}

/** A participant's source override and consent for their own media, scoped to a room. */
export interface Preference {
    language: SourceLanguage;
    automatic: boolean; // Retained when reading legacy settings; new automatic mode is room-wide.
    learning: boolean; // Retained for migration; new learning mode is room-wide.
    transcription: boolean;
}

/** Shared translation settings for one conversation. */
export interface RoomPreference {
    target?: Language;
    automatic: boolean;
    learning: boolean;
    temperature: number;
    instructions: string;
}

/** Store language choices only; message text is never persisted here. */
export class Preferences {
    private rooms: Record<string, Record<string, Preference>>;
    private readonly file: string;
    private readonly mutedFile: string;
    private readonly roomFile: string;
    private roomChoices: Record<string, RoomPreference>;
    private mutedRooms: Record<string, boolean>;
    private readonly generations = new Map<string, number>();

    public constructor(file: string) {
        this.file = file;
        this.mutedFile = file + ".muted";
        this.roomFile = file + ".room";
        this.roomChoices = fs.existsSync(this.roomFile) ? JSON.parse(fs.readFileSync(this.roomFile, "utf8")) : {};
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

    public room(room: string): RoomPreference {
        const choice = this.roomChoices[room];
        return {
            target: choice?.target,
            automatic: choice?.automatic ?? true,
            learning: choice?.learning ?? false,
            temperature: choice?.temperature ?? 0,
            instructions: choice?.instructions ?? "",
        };
    }

    public configure(room: string, change: Partial<RoomPreference>): void {
        this.roomChoices[room] = { ...this.room(room), ...change };
        const temporary = this.roomFile + ".tmp";
        fs.writeFileSync(temporary, JSON.stringify(this.roomChoices), { mode: 0o600 });
        fs.renameSync(temporary, this.roomFile);
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
        this.generations.set(room, this.generation(room) + 1);
        this.save();
    }

    public forget(room: string, user: string): void {
        delete this.rooms[room]?.[user];
        this.generations.set(room, this.generation(room) + 1);
        if (this.rooms[room] && Object.keys(this.rooms[room]).length === 0) delete this.rooms[room];
        this.save();
    }

    public forgetRoom(room: string): void {
        delete this.rooms[room];
        delete this.roomChoices[room];
        fs.writeFileSync(this.roomFile, JSON.stringify(this.roomChoices), { mode: 0o600 });
        this.setMuted(room, false);
        this.save();
    }

    private save(): void {
        const temporary = this.file + ".tmp";
        fs.writeFileSync(temporary, JSON.stringify(this.rooms), { mode: 0o600 });
        fs.renameSync(temporary, this.file);
    }
}
