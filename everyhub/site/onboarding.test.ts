/*
Copyright 2026 Gwang-Jin Kim

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseDevice, chooseLocale, invitationCode, registerAccount } from "./onboarding.ts";
import { copy } from "./copy.ts";

test("invitations accept only our links or codes, never third-party URLs", () => {
    assert.equal(invitationCode(" abcdefgh-1234 "), "abcdefgh-1234");
    assert.equal(invitationCode("https://chat.everyhub.org/?lang=pl#invite=abcdefgh-1234"), "abcdefgh-1234");
    for (const value of [
        "short",
        "<script>x</script>",
        "https://other.example/#invite=abcdefgh-1234",
        "http://chat.everyhub.org/#invite=abcdefgh-1234",
        "https://chat.everyhub.org/",
        "x".repeat(257),
    ])
        assert.equal(invitationCode(value), undefined);
});

test("language/device hints stay focused and every participant language has complete copy", () => {
    assert.equal(chooseLocale(null, "pl-PL"), "pl");
    assert.equal(chooseLocale("de", "en-US"), "de");
    assert.equal(chooseLocale("unknown", "pl-PL"), "en");
    for (const locale of ["ru", "uk", "fr", "fa", "tr", "es"]) {
        assert.equal(chooseLocale(locale, "en-US"), locale);
        assert.equal(chooseLocale(null, locale + "-XX"), locale);
    }
    assert.equal(chooseLocale("__proto__", "en-US"), "en");
    assert.equal(chooseDevice("android", "iPhone"), "android");
    assert.equal(chooseDevice(null, "Android 15"), "android");
    assert.equal(chooseDevice(null, "iPhone"), "iphone");
    assert.equal(chooseDevice(null, "Macintosh", 5), "iphone");
    assert.equal(chooseDevice(null, "Macintosh", 0), "web");
    for (const locale of Object.keys(copy) as (keyof typeof copy)[])
        assert.deepEqual(Object.keys(copy[locale]).sort(), Object.keys(copy.en).sort());
    for (const values of Object.values(copy)) {
        assert.ok(values.signinIntro.length < 180);
        assert.ok(!values.signinIntro.includes("@josephus"));
        assert.ok(values.contact.includes("Josephus"));
    }
});

test("registration uses only the visitor's credentials, completes token and dummy stages, and inhibits login", async () => {
    const bodies: Record<string, unknown>[] = [];
    const id = await registerAccount("newfriend", "a safe password for me", "abcdefgh-1234", async (body) => {
        bodies.push(body);
        if (bodies.length === 1)
            return {
                ok: false,
                status: 401,
                data: { session: "test-session", flows: [{ stages: ["m.login.registration_token", "m.login.dummy"] }] },
            };
        if (bodies.length === 2)
            return {
                ok: false,
                status: 401,
                data: {
                    session: "test-session",
                    completed: ["m.login.registration_token"],
                    flows: [{ stages: ["m.login.registration_token", "m.login.dummy"] }],
                },
            };
        return { ok: true, status: 200, data: { user_id: "@newfriend:chat.everyhub.org" } };
    });
    assert.equal(id, "@newfriend:chat.everyhub.org");
    assert.equal(bodies.length, 3);
    for (const body of bodies) {
        assert.equal(body.username, "newfriend");
        assert.equal(body.inhibit_login, true);
    }
    assert.deepEqual(bodies[1].auth, {
        type: "m.login.registration_token",
        session: "test-session",
        token: "abcdefgh-1234",
    });
    assert.deepEqual(bodies[2].auth, { type: "m.login.dummy", session: "test-session" });
});

test("invalid/used invitations, taken names, rate limits, and unsupported flows have safe participant errors", async () => {
    for (const [status, data, error] of [
        [403, { errcode: "M_FORBIDDEN" }, "invitationExpired"],
        [400, { errcode: "M_USER_IN_USE" }, "usernameTaken"],
        [429, {}, "rateLimited"],
        [401, { errcode: "M_UNAUTHORIZED" }, "invitationExpired"],
        [401, { session: "test", flows: [{ stages: ["m.login.recaptcha"] }] }, "registrationError"],
        [500, { errcode: "M_UNKNOWN" }, "registrationError"],
        [200, { user_id: "@josephus:chat.everyhub.org" }, "registrationError"],
    ] as const) {
        await assert.rejects(
            registerAccount("newfriend", "a safe password for me", "abcdefgh-1234", async () => ({
                ok: status === 200,
                status,
                data,
            })),
            { message: error },
        );
    }
    let called = false;
    const send = async () => {
        called = true;
        return { ok: false, status: 500, data: {} };
    };
    await assert.rejects(registerAccount("newfriend", "a safe password for me", "invalid", send), {
        message: "invitationInvalid",
    });
    await assert.rejects(registerAccount("BAD NAME", "short", "abcdefgh-1234", send), { message: "registrationError" });
    assert.equal(called, false);
});
