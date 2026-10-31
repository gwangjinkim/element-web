# Everyhub Chat language assistant

This fork starts from Element Web **v1.12.33**, the release deployed at Everyhub Chat.
The upstream browser and mobile clients connect to the private Matrix homeserver.
The additions in `translator/` provide language tools through an encrypted Matrix participant,
so they work in Element Web and the standard Element X Android/iPhone apps without custom mobile builds.
There is no custom settings dialog in the client yet: the first version uses chat commands.

## Using it

Invite `@translate:chat.everyhub.org` to the conversation, with the participants' agreement.
It becomes a recipient of the encrypted room. It can read messages in that room.
Its replies are visible to **everyone in that room**, rather than privately replacing one person's timeline.
Original messages remain available. It does not read rooms it has not joined.

For an English/Russian conversation:

| Participant                                                                | Send once in that conversation |
| -------------------------------------------------------------------------- | ------------------------------ |
| English speaker                                                            | `!language en`                 |
| Russian speaker                                                            | `!language ru`                 |
| Either participant wants both texts for learning                           | `!learn on`                    |
| Either participant wants transcripts of their own recordings automatically | `!transcribe on`               |

After this setup, English messages receive Russian translations and Russian messages receive English translations.
Learning mode includes the original and translated text in the assistant's reply for that participant's language.
If several people use the same target language, one reply is shared; the original is included if any of them enables learning.
Settings are per user, per room, and survive a bot restart. Participants cannot change each other's choices.
People who have left the room are excluded when choosing translation targets.

Additional commands:

- `!auto off` / `!auto on`: turn automatic translations into your language off/on.
- `!learn off` / `!learn on`: change learning mode.
- `!transcribe off` / `!transcribe on`: change automatic transcription of your own recorded voice/video messages.
- Reply to a voice/video attachment with `!transcribe` for a one-time transcript, even without automatic mode.
- `!translate en ru Hello`: translate a single text; or reply to text with `!translate ru en`.
- `!settings`: show your current choices; `!forget`: delete your room preferences; `!help`: command reference.

Initial language codes: `en`, `de`, `ko`, `uk`, `ru`, `pl`, `el`.
The chosen language is used for both writing and reading text. Set it to the language you use in that conversation.
Speech transcription detects the recording's language automatically.
Text translation supports 3,000 characters per message. Longer transcripts remain readable, but are not automatically translated.
Recordings are limited to 20 MiB and 10 minutes. Live calls are not recorded or transcribed.
Names, numbers, times, and meaning can be mistranslated; this is a language aid rather than an accuracy guarantee.

## One shared inference service

The Matrix assistant contains **no model** and launches no inference subprocess.
It uses the existing server API, which also serves the Telegram utility bot, with one loaded copy of Whisper small
for speech and one M2M100 text model. These are distinct tasks; consolidating them does not mean running two copies
of the same model. The Telegram bot's behavior is unchanged.

Required API contract (private Docker network):

- `POST /internal/text-translation`: JSON `{text, source, target}`, authenticated `X-Matrix-Translation-Key`,
  returns `{translatedText}`.
- `POST /v1/installations`: returns an installation `{token}`.
- `POST /v1/transcriptions?filename=recording&language=auto`: bounded binary upload,
  installation bearer credential plus `X-Bot-Bridge-Key` containing the Matrix service key, returns job `{id}`.
- `GET /v1/jobs/{id}` / `DELETE /v1/jobs/{id}`: installation-authenticated job polling and cancellation/deletion.
  The API must accept the Matrix key as an authorized bridge, alongside its existing Telegram bridge key.

The assistant deletes its transient speech result after reading it; the encrypted room reply is retained like other messages.
If deletion fails, the API's existing expiry policy applies. Decrypted media is held in bounded memory, not saved by this bot.
Only local homeserver media is fetched. Attachment size is enforced while streaming; encrypted attachments are
SHA-256 checked before AES-CTR decryption. Preferences contain identifiers and language choices, not message text.

## Build, tests, and operation

This is an independent service alongside the upstream pnpm web monorepo. Its existing deployed dependencies are
pinned in `translator/package-lock.json`; Docker uses `npm ci`. Node 24 runs the TypeScript directly.

```sh
node --test everyhub/translator/src/*.test.ts
docker build -t everyhub-chat-translator everyhub/translator
```

Set `CHAT_DOMAIN`, `TRANSLATION_API_URL` (the shared text endpoint URL), and `TRANSLATION_API_KEY`.
Mount the existing bot data directory at `/data`; it contains `credentials.json` (`user_id` and `access_token`),
the encryption store, sync state, language preferences, and a separate speech installation credential.
Preserve the encryption store on upgrades. Keep all credentials and real user data out of Git.
The service needs network access to `http://synapse:8008` and the existing shared API.
The bot account must already exist on the homeserver.

Deploy with **restart policy `no`**. Updates and starts are explicit operator actions; this extension installs no watcher,
scheduled task, or automatic restart. Logs go to container stdout/stderr without message text.
Stop the assistant using `docker compose --profile translation stop translator` in the deployment directory.
Stopping it leaves the original room messages and the shared Telegram inference worker available.

Tests cover reciprocal language selection, learning mode, opt-outs and room boundaries, recorded-media consent,
reply commands, attachment integrity, URL/size bounds, shared API authentication, and result cleanup.
Deployment checks additionally use synthetic accounts and real encrypted media. Real phone recording/playback
still requires a physical Android/iPhone check.

The deployment check on 31 October 2026 passed invitation registration, encrypted message/media delivery,
manual and reply translations, reciprocal English/Russian settings, learning mode, actual speech transcription
from encrypted WAV and MP4 uploads, and authorization for the local calling service. Ten assistant unit tests
passed with 94% line coverage over the tested assistant/inference/media/preferences modules; the Matrix runtime
adapter is covered by the live integration check. Strict TypeScript checking passed. The shared API's twelve
tests passed, including separate Matrix/Telegram bridge credentials using the same speech queue.

The participant guide assets are in `site/`; serve them as `/guide.html` and `/guide.css` on the installation website.

The browser client remains an upstream Element build; a fork of this repository does not itself produce custom
Android/iOS binaries. Participants install the official clients and select `chat.everyhub.org` as their account provider.
