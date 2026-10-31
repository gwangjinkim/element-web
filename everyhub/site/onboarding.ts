/*
Copyright 2026 Gwang-Jin Kim

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import { copy } from "./copy.js";

type Locale = keyof typeof copy;
type CopyKey = keyof typeof copy.en;
type Device = "android" | "iphone" | "web";
interface RegistrationResponse {
    ok: boolean;
    status: number;
    data: {
        user_id?: string;
        errcode?: string;
        session?: string;
        completed?: string[];
        flows?: { stages: string[] }[];
    };
}
type RegistrationSender = (body: Record<string, unknown>) => Promise<RegistrationResponse>;

/** Invitations are kept in memory, never sent in navigation URLs or browser storage. */
export function invitationCode(value: string): string | undefined {
    const input = value.trim();
    if (/^[A-Za-z0-9_-]{8,256}$/.test(input)) return input;
    try {
        const url = new URL(input);
        if (url.origin !== "https://chat.everyhub.org") return;
        const token = new URLSearchParams(url.hash.slice(1)).get("invite") ?? "";
        return /^[A-Za-z0-9_-]{8,256}$/.test(token) ? token : undefined;
    } catch {
        return;
    }
}

/** Prefer an explicit link choice, then the visitor's language, with English as fallback. */
export function chooseLocale(value: string | null, browserLanguage: string): Locale {
    const candidate = (value ?? browserLanguage).toLowerCase().split("-")[0];
    return Object.hasOwn(copy, candidate) ? (candidate as Locale) : "en";
}

/** Device selection hides instructions for other platforms without blocking a manual choice. */
export function chooseDevice(value: string | null, userAgent: string, touchPoints = 0): Device {
    if (value === "android" || value === "iphone" || value === "web") return value;
    if (/Android/i.test(userAgent)) return "android";
    if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && touchPoints > 1)) return "iphone";
    return "web";
}

/** Complete Synapse's invite-only flow for the visitor's own credentials; never sign in as the host. */
export async function registerAccount(
    username: string,
    password: string,
    invitation: string,
    send: RegistrationSender = async (body) => {
        const response = await fetch("/_matrix/client/v3/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30000),
        });
        return { ok: response.ok, status: response.status, data: await response.json() };
    },
): Promise<string> {
    if (!/^[a-z0-9._=-]{3,40}$/.test(username) || password.length < 12 || password.length > 128)
        throw new Error("registrationError");
    if (!invitationCode(invitation)) throw new Error("invitationInvalid");
    const base = { username, password, inhibit_login: true };
    let result = await send(base);
    for (let attempt = 0; result.status === 401 && attempt < 4; attempt++) {
        if (result.data.errcode) throw new Error("invitationExpired");
        const completed = result.data.completed ?? [];
        const flow = result.data.flows?.find((flow) =>
            flow.stages.every((stage) => ["m.login.registration_token", "m.login.dummy"].includes(stage)),
        );
        const stage = flow?.stages.find((stage) => !completed.includes(stage));
        if (!stage || !result.data.session) throw new Error("registrationError");
        result = await send({
            ...base,
            auth: {
                type: stage,
                session: result.data.session,
                ...(stage === "m.login.registration_token" ? { token: invitationCode(invitation) } : {}),
            },
        });
    }
    if (result.status === 429) throw new Error("rateLimited");
    if (result.data.errcode === "M_USER_IN_USE") throw new Error("usernameTaken");
    if (result.data.errcode === "M_FORBIDDEN" || result.status === 401) throw new Error("invitationExpired");
    if (!result.ok || result.data.user_id !== `@${username}:chat.everyhub.org`) throw new Error("registrationError");
    return result.data.user_id;
}

function start(): void {
    const params = new URLSearchParams(location.search);
    let locale = chooseLocale(params.get("lang"), navigator.language);
    let device = chooseDevice(params.get("device"), navigator.userAgent, navigator.maxTouchPoints);
    let step = 1;
    let createdId = "";
    let submitting = false;
    const get = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
    const username = get<HTMLInputElement>("username");
    const invite = get<HTMLInputElement>("invite");
    const password = get<HTMLInputElement>("password");
    const confirm = get<HTMLInputElement>("confirm");
    const form = get<HTMLFormElement>("join-form");
    const button = get<HTMLButtonElement>("join-button");
    const status = get("join-status");
    const hash = new URLSearchParams(location.hash.slice(1));
    const token = invitationCode(hash.get("invite") ?? "");
    if (token) invite.value = token;
    // Remove invitations before the user opens any external app, store, or source link.
    if (hash.has("invite")) history.replaceState(null, "", location.pathname + location.search);
    const text = (key: CopyKey): string => copy[locale][key];
    const currentId = (): string =>
        createdId || (/^[a-z0-9._=-]{3,40}$/.test(username.value) ? `@${username.value}:chat.everyhub.org` : "");
    const updateIdentity = (): void => {
        get("preview-id").textContent = `@${username.value || text("placeholder")}:chat.everyhub.org`;
        document.querySelectorAll<HTMLElement>(".own-id").forEach((element) => {
            element.textContent = currentId() || text("yourUsername");
        });
    };
    const updateDevices = (): void => {
        document.querySelectorAll<HTMLElement>("[data-device]").forEach((element) => {
            const name = element.dataset.device;
            element.hidden = !(
                (name === "mobile" && device !== "web") ||
                (name === "browser" && device === "web") ||
                name === device
            );
        });
        document.querySelectorAll<HTMLElement>("[data-choice]").forEach((element) => {
            element.setAttribute("aria-pressed", String(element.dataset.choice === device));
        });
        get("app-next").textContent = text(device === "web" ? "browserNext" : "installed");
    };
    const render = (): void => {
        document.documentElement.lang = locale;
        document.documentElement.dir = locale === "fa" ? "rtl" : "ltr";
        document.title = text("pageTitle");
        document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
            element.textContent = text(element.dataset.i18n as CopyKey);
        });
        get<HTMLSelectElement>("language").value = locale;
        get("language").setAttribute("aria-label", text("language"));
        username.placeholder = text("placeholder");
        get("invitation-state").textContent = text(
            createdId ? "created" : invitationCode(invite.value) ? "invitationReady" : "invitationMissing",
        );
        get("invitation-field").hidden = Boolean(invitationCode(invite.value));
        if (status.dataset.key) status.textContent = text(status.dataset.key as CopyKey);
        button.textContent = text(submitting ? "creating" : "create");
        button.disabled = submitting || Boolean(createdId);
        updateIdentity();
        updateDevices();
    };
    const go = (next: number): void => {
        step = next;
        document.querySelectorAll<HTMLElement>("[data-step]").forEach((element) => {
            element.hidden = Number(element.dataset.step) !== step;
        });
        document.querySelectorAll<HTMLElement>("[data-progress]").forEach((element) => {
            if (Number(element.dataset.progress) === step) element.setAttribute("aria-current", "step");
            else element.removeAttribute("aria-current");
        });
        get("back").hidden = step === 1;
        get("copy-status").textContent = "";
        document.querySelector<HTMLElement>(`[data-step="${step}"] h2`)?.focus();
        updateIdentity();
    };
    get("language").addEventListener("change", (event) => {
        locale = (event.target as HTMLSelectElement).value as Locale;
        render();
    });
    username.addEventListener("input", updateIdentity);
    get("show-password").addEventListener("change", (event) => {
        password.type = confirm.type = (event.target as HTMLInputElement).checked ? "text" : "password";
    });
    get("already-account").addEventListener("click", () => go(2));
    document.querySelectorAll<HTMLElement>("[data-next]").forEach((element) => {
        element.addEventListener("click", () => go(Number(element.dataset.next)));
    });
    get("back").addEventListener("click", () => go(Math.max(1, step - 1)));
    document.querySelectorAll<HTMLElement>("[data-choice]").forEach((element) => {
        element.addEventListener("click", () => {
            device = element.dataset.choice as Device;
            updateDevices();
        });
    });
    document.querySelectorAll<HTMLElement>("[data-copy]").forEach((element) => {
        element.addEventListener("click", async () => {
            const value =
                element.dataset.copy === "server"
                    ? "chat.everyhub.org"
                    : element.dataset.copy === "host"
                      ? "@josephus:chat.everyhub.org"
                      : currentId();
            if (!value) {
                get("copy-status").textContent = text("missingUsername");
                return;
            }
            try {
                await navigator.clipboard.writeText(value);
                get("copy-status").textContent = text("copied");
            } catch {
                get("copy-status").textContent = text("copyFailed");
            }
        });
    });
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (submitting || createdId) return;
        status.textContent = "";
        delete status.dataset.key;
        const fail = (key: CopyKey): void => {
            status.dataset.key = key;
            status.textContent = text(key);
        };
        if (password.value !== confirm.value) {
            fail("passwordMismatch");
            return;
        }
        const invitation = invitationCode(invite.value);
        if (!invitation) {
            fail("invitationInvalid");
            return;
        }
        submitting = true;
        render();
        try {
            createdId = await registerAccount(username.value.trim(), password.value, invitation);
            // Passwords and invitation codes leave the form immediately; no browser storage or access token is retained.
            password.value = confirm.value = invite.value = "";
            get("account-created").hidden = false;
            form.hidden = true;
            go(2);
        } catch (error) {
            const key =
                error instanceof Error && error.message in copy.en ? (error.message as CopyKey) : "registrationError";
            fail(key);
        } finally {
            submitting = false;
            render();
        }
    });
    render();
}

if (typeof document !== "undefined") start();
