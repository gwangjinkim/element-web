# Everyhub Chat language assistant

This fork starts from Element Web **v1.12.33**, the release deployed at Everyhub Chat.
The upstream browser and mobile clients connect to the private Matrix homeserver.
The additions in `translator/` provide language tools through an encrypted Matrix participant,
so they work in Element Web and the standard Element X Android/iPhone apps without custom mobile builds.
There is no custom settings dialog in the client yet: the first version uses chat commands.

## Using it

### Finding the assistant and enabling calls

The assistant already has its own account: `@translate:chat.everyhub.org` (including the leading `@`).
Synapse's default user directory only finds people sharing a room or visible in public rooms.
For this private deployment, the owner has approved `user_directory.search_all_users: true` with
`exclude_remote_users: true`, allowing signed-in users to find local accounts including the assistant.
This is a directory privacy choice, not a requirement for inviting an exact Matrix ID.

Calls also require `experimental_features.msc4143_enabled: true` alongside the existing `matrix_rtc.transports`.
Without that flag, the authenticated `/_matrix/client/unstable/org.matrix.msc4143/rtc/transports` endpoint returns
404 even when the LiveKit backend and `.well-known` advertisement are configured. Check this endpoint as well as
the actual media connection; successful token issuance alone does not establish a working video call.

### Inviting the assistant

Invite `@translate:chat.everyhub.org` to the conversation, with the participants' agreement.
It becomes a recipient of the encrypted room. It can read messages in that room.
Its replies are visible to **everyone in that room**, rather than privately replacing one person's timeline.
Original messages remain available. It does not read rooms it has not joined.

Choose one language that everyone should understand, for example English:

```text
!target english
!auto on
!learn on
```

`!target en` and `!target english` mean the same thing. The target, automatic translation switch, and learning
mode are **shared by the room**. Anyone in the room can change them. Every participant's new text messages
are detected and translated into that target, including messages from people who have never configured the bot.
Messages already in the target language receive no translation reply. Learning mode repeats the original with
the translation; original messages remain in the timeline in either mode.

`!lang auto` is the default source setting for new participants. Use `!lang ru` or `!lang russian` to force
**your own** source language in this room, and `!lang auto` to restore detection. Short messages, names,
transliteration and mixed-language messages can be ambiguous. Detection applies to the whole message;
a high-confidence match with the target is skipped. This is a shared-target mode, so English targets do not
also produce Russian replies for English messages. Change the target when the conversation needs another language.

Bare `!auto`, `!learn`, and `!bot` toggle their current state and confirm the resulting on/off status.
Explicit `on`/`off` sets a state without toggling it. `!help` is a compact two-column reminder. `!help details` shows the full operating rules.

Commands:

| Command                                                    | Scope and effect                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `!target en` / `!target english`                           | Shared target language for the room                                                 |
| `!auto on` / `!auto off`                                   | Enable/pause automatic translations for the whole room                              |
| `!learn on` / `!learn off`                                 | Include/omit a repeated original in translation replies for the room                |
| `!lang en` / `!lang english` / `!lang auto`                | Your own source override or automatic detection                                     |
| `!bot off` / `!bot on`                                     | Pause/resume all automatic and manual translations **and transcripts** for the room |
| `!transcribe on` / `!transcribe off`                       | Opt in/out of automatic transcripts of **your own** voice/video uploads             |
| Reply with `!transcribe`                                   | One-time transcript of that voice/video message                                     |
| `!lang auto persian text`                                  | Translate this text once, detecting its source; no saved changes                    |
| `!target persian text`                                     | Translate this text once using your saved source (auto by default)                  |
| `!translate auto en text`                                  | One-time translation, with source detection                                         |
| `!translate ru english text`                               | One-time translation with an explicit source                                        |
| Reply with `!translate auto en`                            | Translate the replied-to text once                                                  |
| `!model`                                                   | Show installed model and room model settings                                        |
| `!temperature` / `!temperature 0.2` / `!temperature reset` | Show/set/reset sampling (0–1; default 0)                                            |
| `!prompt`                                                  | Show the actual current prompt template and room-specific additions                 |
| `!prompt add TEXT` / `!prompt set TEXT` / `!prompt reset`  | Append/replace/reset this room's custom instructions (up to 1,600 characters)       |
| `!settings`                                                | Show shared room settings and your own source/transcription choices                 |
| `!forget`                                                  | Remove your own source/transcription choices; shared settings remain                |
| `!help` / `!help detailed`                                 | Reminder / full rules                                                               |

Add message text after a translation control to apply it **only to that message**, without saving changes:
`!target persian Hello`, `!learn on Hello`, `!auto on Hello`, `!bot on Hello`, or
`!temperature 0.2 Hello`. `!lang <source> <target> <text>` supplies both languages, for example
`!lang english persian Hello`, `!lang en fa Hello`, or `!lang auto persian Hello` for source detection.
Reply to text with `!lang auto persian` to translate that message instead. Text may span multiple lines.
Local target uses your saved source override, defaulting to automatic detection. Local learn includes/omits the
original. Other local controls use the saved room target; choose one first. Local requests work with room auto off,
but never bypass the room's silencer. Local `!auto off text` and `!bot off text` suppress that request only.
Without message text, controls retain their existing persistent behavior; bare bot/auto/learn still toggle.
`!prompt add/set TEXT` takes instructions as its required argument and saves them; it does not translate those
instructions. `!transcribe` operates on recordings, not appended text. `!help details` remains an alias for
`!help detailed`.

Codes and English language names are case-insensitive. The model's full 150-entry inventory, including script
variants, is in `translator/src/languages.json`; it is taken from the technical report's Appendix C.
Initial requested languages are all covered: English `en`, German `de`, Korean `ko`, Ukrainian `uk`,
Russian `ru`, Polish `pl`, and Greek `el`. A legacy `!language` command aliases `!lang`.
Legacy saved source/transcription settings and the room silencer survive upgrades; each room must explicitly
choose its new shared target with `!target`. Old per-recipient translation settings do not invent a room target.

Room settings survive restarts. A room control change invalidates queued/in-flight translations, so old results
are suppressed. While `!bot off`, `!bot`, `!help`, `!settings`, `!model`, `!prompt`, and `!temperature` respond.
Model instructions and temperature are applied per request, not as mutable global model settings.
The base translation rules remain; `!prompt set` replaces the room-specific additions. Use English instructions
such as `!prompt add Use friendly, informal language.` Higher temperatures add variety and can reduce fidelity.
Any participant can inspect/change these shared room settings. Custom instructions are saved as configuration,
and no message history is added to the prompt. The default template uses Chinese to match the model authors'
inference recipe; `!prompt` shows the exact user-prompt template with placeholders. Resuming handles new messages only.
Learning replies use bold language labels, a quoted original, and a divider before the translation. A visible
plain-text divider keeps the sections separate in clients that collapse empty lines. Long replies fall back to
plain-text chunks without repeating the complete formatted message.

Text translation supports 3,000 characters per message. Longer transcripts remain readable, but are not automatically
translated. Recordings are limited to 20 MiB and 10 minutes. Live calls are not recorded or transcribed.
Names, numbers, times, and meaning can be mistranslated; this is a language aid rather than an accuracy guarantee.

## One shared inference service

The Matrix assistant contains **no model** and launches no inference subprocess.
It uses the existing server API, which also serves the Telegram utility bot, with one loaded copy of Whisper small
for speech and one **Index-Translate 2B Q4_K_M** text model. A fastText language detector identifies the source. These are distinct tasks; consolidating them does not mean running two copies
of the same model. The Telegram bot's behavior is unchanged.

Required API contract (private Docker network):

- `POST /internal/text-translation`: JSON `{text, source, target}`, authenticated `X-Matrix-Translation-Key`,
  returns `{translatedText, detectedLanguage, skipped, confidence?}`. Source accepts `auto`; skipped results produce no bot reply.
- `POST /v1/installations`: returns an installation `{token}`.
- `POST /v1/transcriptions?filename=recording&language=auto`: bounded binary upload,
  installation bearer credential plus `X-Bot-Bridge-Key` containing the Matrix service key, returns job `{id}`.
- `GET /v1/jobs/{id}` / `DELETE /v1/jobs/{id}`: installation-authenticated job polling and cancellation/deletion.
  The API must accept the Matrix key as an authorized bridge, alongside its existing Telegram bridge key.

The assistant deletes its transient speech result after reading it; the encrypted room reply is retained like other messages.
If deletion fails, the API's existing expiry policy applies. Decrypted media is held in bounded memory, not saved by this bot.
Only local homeserver media is fetched. Attachment size is enforced while streaming; encrypted attachments are
SHA-256 checked before AES-CTR decryption. Preferences contain identifiers, language choices and explicitly saved custom instructions. Ordinary message text is not saved there.

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

Tests cover shared targets, code/name aliases, automatic detection metadata, same-language skips, learning mode,
room controls and boundaries, recorded-media consent,
reply commands, attachment integrity, URL/size bounds, shared API authentication, and result cleanup.
Deployment checks additionally use synthetic accounts and real encrypted media. Real phone recording/playback
still requires a physical Android/iPhone check.

The shared backend source and reproducible model download instructions are in `shared-api/`. It runs in the
existing one-worker API service, not an additional server. The Matrix bot uses the same private API as the Telegram
utility bot. Keep the existing speech data volume and credentials when upgrading. Model weights are not stored in Git.

The participant guide assets are in `site/`; serve them as `/guide.html` and `/guide.css` on the installation website.

The browser client remains an upstream Element build; a fork of this repository does not itself produce custom
Android/iOS binaries. Participants install the official clients and select `chat.everyhub.org` as their account provider.
