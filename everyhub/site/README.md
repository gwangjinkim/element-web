# Invitation website

The landing page is a four-step guide for **invitees**, not instructions for the administrator.
Each person chooses their own username/password. Josephus's ID appears only as the contact to message after sign-in.
The account provider is `chat.everyhub.org`; `app.chat.everyhub.org` is the browser client.

Existing personal links (`https://chat.everyhub.org/#invite=…`) keep working. The invitation fragment is read into
memory and removed from the address bar before any external navigation. Tokens, passwords, and access tokens are
never saved to browser storage. Registration uses the existing same-origin Synapse endpoint with `inhibit_login`;
this page does not become a signed-in Matrix device. Do not put real invitation codes into source or tests.

English, German and Polish instructions are in `copy.ts`. The page uses the browser language by default.
A link can select a language/device, for example `https://chat.everyhub.org/?lang=pl&device=android`.
Only the selected platform's instructions are shown; users can change platform manually. No tracking is involved.
Users who already created an account can skip registration.

## Build and check

The runtime consists of static HTML/CSS and the generated `onboarding.js` / `copy.js`. Edit the TypeScript sources,
then regenerate both JavaScript files. A TypeScript compiler is already a development dependency of the translator:

```sh
npm ci --prefix everyhub/translator
./everyhub/translator/node_modules/.bin/tsc -p everyhub/site/tsconfig.json
./everyhub/translator/node_modules/.bin/tsc -p everyhub/site/tsconfig.json --noEmit
node --test everyhub/site/onboarding.test.ts
pnpm exec oxfmt everyhub/site/onboarding.js everyhub/site/copy.js
```

Run from the repository root with Node 24+. Format source with the repository's oxfmt.

Browser coverage uses Playwright with an installed Chromium browser. It starts a finite localhost fixture server,
uses **mock registration only**, and closes the server/browser in `finally`. No real account is created. The runtime
has no Playwright dependency; tests can use a separately installed Playwright package:

```sh
PLAYWRIGHT_MODULE_PATH=/absolute/path/to/node_modules/playwright \
PLAYWRIGHT_CHANNEL=chrome \
ONBOARDING_SCREENSHOTS=/absolute/path/to/test-output \
node --test everyhub/site/onboarding.browser.test.ts
```

Omit `PLAYWRIGHT_MODULE_PATH` if normal Node resolution finds Playwright; omit `PLAYWRIGHT_CHANNEL` if its bundled
Chromium is installed. Screenshots are optional. Tests cover account creation, own-ID sign-in, platform isolation,
Polish/German copy, returning users, errors, clipboard behavior, layout widths and no browser credential storage.

## Deploy to the existing server

Copy `index.html`, `onboarding.css`, `onboarding.js`, and `copy.js` to the existing website's `site/` directory.
Keep `downloads/`, `guide.html`, `guide.css`, and the existing Caddy configuration. No service restart is required.
Back up the previous files first. Deploy the versioned scripts/styles before switching the HTML entry point.
Personal invitation tokens are not part of the website source or deployment.

App/provider links were checked against [Element's mobile provisioning documentation](https://docs.element.io/latest/element-server-suite-pro/administration/mobile-client-provisioning/).
The optional direct APK remains the official Element X build. Server-side translation/transcription works through
the invited Matrix assistant in the standard clients; this page does not advertise a custom mobile binary.
