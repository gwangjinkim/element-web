# Shared speech and translation API

Copyright 2026 Gwang-Jin Kim. Code: AGPL-3.0-only; see the repository license.
This is the existing Chat Utilities backend with the Everyhub translation endpoint included.
Run **one** Uvicorn worker. The Telegram utility bot and Matrix assistant share this process and speech queue.

- Text: [Index-Translate 2B](https://huggingface.co/IndexTeam/Index-Translate-2B), official Q4_K_M GGUF,
  1,312,164,352 bytes, Apache 2.0. Supports 150 language/script entries according to the authors;
  quality differs across languages. [Model weights](https://huggingface.co/IndexTeam/Index-Translate-2B-GGUF).
- Language identification: [fastText lid.176.bin](https://fasttext.cc/docs/en/language-identification.html),
  176 languages, CC-BY-SA 3.0. Credit: A. Joulin, E. Grave, P. Bojanowski, T. Mikolov,
  *Bag of Tricks for Efficient Text Classification*; and A. Joulin, E. Grave, P. Bojanowski, M. Douze,
  H. Jégou, T. Mikolov, *FastText.zip: Compressing text classification models*.
- Speech: existing faster-whisper **small**, CPU INT8. Preserve `/data/models` and the data volume on upgrades.

Download weights with `sh download-model.sh /path/to/translation-model`. Exact hashes and the translation model
revision are pinned in the script. It verifies existing files and fails on checksum mismatches.
Mount that directory read-only at `/models/text`; set `TEXT_TRANSLATION_MODEL_DIR` if using another path.
Model loading is local and lazy; no external inference API is used.

Build with `docker build -t chat-utilities-api:local .`. The Dockerfile targets the deployment's ARMv8.2 + dot-product CPU;
change the CMake CPU architecture for other hardware. Dependencies are managed with uv and pinned in `uv.lock`.
Export the container dependencies with:

```sh
uv export --locked --extra speech --extra text --no-dev --no-emit-project --output-file requirements.lock
uv run --extra test pytest
```

Keep the existing data volume at `/data`, private service keys, network, quotas, and restart policy `no`.
The image uses the existing unprivileged app UID 10001, one worker, and no access logs. The deployed container has
2 CPUs and a 4 GiB limit. Native translation calls are serialized; the bot also bounds its queue.
The `/healthz` response identifies the installed speech and text models.

The authenticated `POST /internal/text-translation` accepts `{text, source: "auto", target: "en"}` (up to 3,000 characters),
or a canonical explicit source code. Optional `temperature` (finite 0–1; default 0) and `instructions`
(up to 1,600 characters; default empty) apply to **that request only**. `GET /internal/text-translation/config`,
with the same service authentication, returns the installed model, limits, and exact base prompt template.
The bot persists these choices per room; `!prompt set` replaces custom additions while keeping the base rules.
Custom instructions are configuration data, not message history. They are shown to the participants on request. It returns `{translatedText, detectedLanguage, skipped, confidence?}`.
Same-language text is skipped when detection confidence is at least 0.65; explicit identical codes are always skipped.
URLs/numbers/emoji without other letters are skipped. Detection can be wrong, especially on short, mixed or romanized text;
use `!lang` to override it. The language detector covers fewer languages than the translator: unknown source labels are
passed to the translation model in automatic mode, but same-language suppression cannot be guaranteed for those languages.

The model uses the author's constrained translation prompt and a Qwen3.5 template with thinking disabled. Requests have
no tools or execution access. Input instructions should be translated as content, but this remains a statistical model.
Paragraphs and bounded pieces are translated without silently truncating input. An output length limit returns an error
rather than publishing a partial translation. No message text is written to API logs or a text-translation database.
The Matrix replies themselves are retained as room messages. Audio/result handling follows the existing API's expiry rules.

When replacing weights, first test quality, memory, speech regression, and encrypted Matrix behavior. Switch the existing API
and bot explicitly, verify their health, then remove only the superseded translation directory and its known model cache.
Do not remove the Whisper cache, user databases, encryption stores, or unrelated Docker images/volumes.
