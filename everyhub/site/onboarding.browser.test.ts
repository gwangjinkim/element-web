/*
Copyright 2026 Gwang-Jin Kim

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// The optional override lets desktop QA reuse its installed browser runtime without changing project dependencies.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH ?? "playwright");
const directory = path.dirname(fileURLToPath(import.meta.url));

test("invitees can create their own account and follow focused mobile/browser instructions", async () => {
    const posts: Record<string, unknown>[] = [];
    const coverage: {
        url: string;
        source?: string;
        functions: { ranges: { startOffset: number; endOffset: number; count: number }[] }[];
    }[] = [];
    const server = http.createServer(async (request, response) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (request.method === "POST" && url.pathname === "/_matrix/client/v3/register") {
            let input = "";
            for await (const chunk of request) input += chunk;
            const body = JSON.parse(input);
            posts.push(body);
            response.setHeader("Content-Type", "application/json");
            if (body.username === "taken") {
                response.writeHead(400);
                response.end(JSON.stringify({ errcode: "M_USER_IN_USE" }));
                return;
            }
            if (body.username === "expired" && body.auth) {
                response.writeHead(403);
                response.end(JSON.stringify({ errcode: "M_FORBIDDEN" }));
                return;
            }
            if (!body.auth) {
                response.writeHead(401);
                response.end(
                    JSON.stringify({ session: "local-test-only", flows: [{ stages: ["m.login.registration_token"] }] }),
                );
                return;
            }
            response.end(JSON.stringify({ user_id: `@${body.username}:chat.everyhub.org` }));
            return;
        }
        const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        if (!/^[a-z.-]+$/.test(name)) {
            response.writeHead(404);
            response.end();
            return;
        }
        try {
            const content = await fs.readFile(path.join(directory, name));
            response.setHeader(
                "Content-Type",
                name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html",
            );
            response.end(content);
        } catch {
            response.writeHead(404);
            response.end();
        }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    let browser;
    try {
        browser = await chromium.launch({
            headless: true,
            ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
        });
        const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            permissions: ["clipboard-read", "clipboard-write"],
        });
        const page = await context.newPage();
        await page.coverage.startJSCoverage({ resetOnNavigation: false });
        await page.goto(base + "/?lang=en&device=android#invite=fixture_invitation");
        await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#join-button")!.disabled);
        assert.equal(new URL(page.url()).hash, "");
        assert.equal(await page.locator("[data-step]:visible").count(), 1);
        assert.equal(await page.locator("#invitation-field").isVisible(), false);
        assert.equal(await page.locator("#username").inputValue(), "");
        assert.ok(!(await page.locator("#preview-id").textContent()).includes("josephus"));
        await page.getByLabel("Choose your username", { exact: true }).fill("newfriend");
        assert.equal(await page.locator("#preview-id").textContent(), "@newfriend:chat.everyhub.org");
        await page.getByLabel("Choose your password", { exact: true }).fill("my new personal password");
        await page.getByLabel("Type your password again", { exact: true }).fill("my new personal password");
        await page.getByLabel("Show passwords", { exact: true }).check();
        assert.equal(await page.locator("#password").getAttribute("type"), "text");
        await page.getByRole("button", { name: "Create my account" }).click();
        await page.locator("[data-step='2']").waitFor({ state: "visible" });
        assert.equal(await page.locator("#password").inputValue(), "");
        assert.equal(await page.locator("#confirm").inputValue(), "");
        assert.equal(await page.locator("#invite").inputValue(), "");
        assert.equal(await page.locator("[data-device='iphone']").isVisible(), false);
        assert.ok((await page.locator("#account-created").textContent()).includes("@newfriend:chat.everyhub.org"));
        await page.getByText("No Google Play?", { exact: false }).click();
        assert.ok(await page.getByRole("link", { name: "Download Android APK" }).isVisible());
        await page.locator("#app-next").click();
        await page.locator("[data-step='3']").waitFor({ state: "visible" });
        assert.equal(await page.locator("[data-step='3'] .own-id").textContent(), "@newfriend:chat.everyhub.org");
        assert.equal(
            await page.getByRole("link", { name: "Open Element X" }).getAttribute("href"),
            "https://mobile.element.io/element/?account_provider=chat.everyhub.org",
        );
        await page.locator("[data-copy='username']").click();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "@newfriend:chat.everyhub.org");
        await page.locator("[data-copy='server']").click();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "chat.everyhub.org");
        await page.locator("#back").click();
        await page.locator("[data-choice='iphone']").click();
        assert.equal(await page.locator("[data-device='android']").isVisible(), false);
        assert.ok(await page.getByRole("link", { name: "Get Element X on the App Store" }).isVisible());
        await page.locator("[data-choice='web']").click();
        await page.locator("#app-next").click();
        assert.equal(await page.locator("[data-device='mobile']").isVisible(), false);
        assert.ok(await page.locator("[data-device='browser']").isVisible());
        await page.getByRole("button", { name: "I’m signed in" }).click();
        assert.ok(
            (await page.locator("[data-step='4']").textContent()).includes(
                "Josephus’s contact — not your sign-in name",
            ),
        );
        await page.locator("[data-copy='host']").click();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "@josephus:chat.everyhub.org");
        assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
        assert.ok(posts.every((p) => p.username === "newfriend" && p.inhibit_login === true));
        coverage.push(...(await page.coverage.stopJSCoverage()));
        await context.close();

        const polish = await browser.newContext({
            locale: "pl-PL",
            viewport: { width: 375, height: 812 },
            userAgent: "Mozilla/5.0 (Linux; Android 15)",
        });
        const pl = await polish.newPage();
        await pl.coverage.startJSCoverage({ resetOnNavigation: false });
        await pl.goto(base + "/#invite=fixture_invitation");
        await pl.getByRole("heading", { name: "Załóż swoje konto" }).waitFor();
        const screenshots = process.env.ONBOARDING_SCREENSHOTS;
        if (screenshots) {
            await fs.mkdir(screenshots, { recursive: true });
            await pl.screenshot({ path: path.join(screenshots, "everyhub-join-polish-android.png"), fullPage: true });
        }
        await pl.locator("#username").fill("agata_test");
        await pl.locator("#already-account").click();
        assert.ok(await pl.getByRole("link", { name: "Zainstaluj Element X z Google Play" }).isVisible());
        assert.equal(await pl.locator("[data-device='iphone']").isVisible(), false);
        await pl.locator("#app-next").click();
        assert.equal(await pl.locator("[data-step='3'] .own-id").textContent(), "@agata_test:chat.everyhub.org");
        if (screenshots)
            await pl.screenshot({ path: path.join(screenshots, "everyhub-join-polish-signin.png"), fullPage: true });
        await pl.locator("#language").selectOption("de");
        assert.ok(await pl.getByRole("heading", { name: "Melde dich mit deinem Konto an" }).isVisible());
        coverage.push(...(await pl.coverage.stopJSCoverage()));
        await polish.close();

        const errors = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const err = await errors.newPage();
        await err.coverage.startJSCoverage({ resetOnNavigation: false });
        await err.goto(base + "/?lang=de#invite=fixture_invitation");
        await err.locator("#username").fill("expired");
        await err.locator("#password").fill("a safe personal password");
        await err.locator("#confirm").fill("a different personal password");
        await err.locator("#join-button").click();
        assert.match(await err.locator("#join-status").textContent(), /Passwörter sind nicht gleich/);
        await err.locator("#confirm").fill("a safe personal password");
        await err.locator("#join-button").click();
        await err.getByText("Diese Einladung wurde bereits verwendet", { exact: false }).waitFor();
        assert.equal(await err.locator("#join-button").isDisabled(), false);
        await err.locator("#username").fill("taken");
        await err.locator("#join-button").click();
        await err.getByText("Dieser Benutzername ist schon vergeben", { exact: false }).waitFor();
        await err.goto(base + "/?lang=en&device=web");
        assert.ok(await err.locator("#invitation-field").isVisible());
        if (screenshots)
            await err.screenshot({ path: path.join(screenshots, "everyhub-join-desktop.png"), fullPage: true });
        await err.locator("#username").fill("manualfriend");
        await err.locator("#password").fill("a safe personal password");
        await err.locator("#confirm").fill("a safe personal password");
        await err.locator("#join-button").click();
        assert.match(await err.locator("#join-status").textContent(), /valid invitation code/);
        await err.locator("#invite").fill("https://chat.everyhub.org/#invite=fixture_invitation");
        await err.locator("#join-button").click();
        await err.locator("[data-step='2']").waitFor({ state: "visible" });
        await err.locator("#back").click();
        assert.equal(await err.locator("#join-form").isVisible(), false);
        await err.locator("#already-account").click();
        await err.locator("#app-next").click();
        await err.getByRole("button", { name: "I’m signed in" }).click();
        await err.locator(".help summary").click();
        assert.ok(await err.getByRole("heading", { name: "Which account should I use?" }).isVisible());
        await err.locator(".about summary").click();
        assert.ok((await err.locator(".about").textContent()).includes("Hetzner"));
        for (const width of [320, 375, 390, 1280]) {
            await err.setViewportSize({ width, height: 900 });
            assert.ok(
                await err.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                `Horizontal overflow at ${width}px`,
            );
        }
        coverage.push(...(await err.coverage.stopJSCoverage()));
        await errors.close();
        const scripts = coverage.filter((s) => new URL(s.url).pathname === "/onboarding.js");
        const source = scripts[0].source!;
        const covered = new Uint8Array(source.length);
        for (const script of scripts) {
            const ranges = script.functions
                .flatMap((f) => f.ranges)
                .sort((a, b) => b.endOffset - b.startOffset - (a.endOffset - a.startOffset));
            const seen = new Uint8Array(source.length);
            for (const range of ranges) seen.fill(range.count > 0 ? 1 : 0, range.startOffset, range.endOffset);
            for (let i = 0; i < seen.length; i++) if (seen[i]) covered[i] = 1;
        }
        const percentage = (100 * covered.reduce((n, v) => n + v, 0)) / covered.length;
        console.log(
            JSON.stringify({
                browser: "Chromium",
                real_accounts_created: 0,
                registration: "local mock only",
                browser_script_coverage_percent: Number(percentage.toFixed(2)),
                temporary_server_closed_in_finally: true,
            }),
        );
        assert.ok(percentage >= 80, `Browser script coverage ${percentage}% is below 80%`);
    } finally {
        await browser?.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});
