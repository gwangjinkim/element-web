# Copyright 2026 Gwang-Jin Kim
# SPDX-License-Identifier: AGPL-3.0-only

from __future__ import annotations

import asyncio
import contextlib
import logging
import hmac
import os
import time
from dataclasses import dataclass
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from .speech import WhisperEngine
from .store import Store
from .text_translation import LANGUAGES, MODEL, TextTranslationEngine, model_configuration


class TextTranslationRequest(BaseModel):
    text: str = Field(min_length=1, max_length=3000)
    source: str = "auto"
    target: str
    temperature: float = Field(default=0.0, ge=0.0, le=1.0, allow_inf_nan=False)
    instructions: str = Field(default="", max_length=1600)

log = logging.getLogger(__name__)


@dataclass
class Settings:
    data: Path = Path(os.getenv("DATA_DIR", "/data"))
    max_bytes: int = int(os.getenv("MAX_UPLOAD_MB", "20")) * 1024 * 1024
    max_duration: int = int(os.getenv("MAX_AUDIO_SECONDS", "600"))
    ttl: int = int(os.getenv("RESULT_TTL_SECONDS", "86400"))
    queue_size: int = int(os.getenv("QUEUE_SIZE", "32"))
    daily: int = int(os.getenv("DAILY_JOBS_PER_INSTALLATION", "20"))
    threads: int = int(os.getenv("WHISPER_THREADS", "2"))
    bot_bridge_key: str = os.getenv("BOT_BRIDGE_KEY", "")
    registrations_per_hour: int = int(os.getenv("REGISTRATIONS_PER_IP_HOUR", "5"))
    jobs_per_ip_hour: int = int(os.getenv("JOBS_PER_IP_HOUR", "40"))
    text_translation_key: str = os.getenv("MATRIX_TRANSLATION_KEY", "")
    text_model_directory: Path = Path(os.getenv("TEXT_TRANSLATION_MODEL_DIR", "/models/text"))

    def __post_init__(self):
        for key in ("max_bytes", "max_duration", "ttl", "queue_size", "daily", "threads",
                    "registrations_per_hour", "jobs_per_ip_hour"):
            if getattr(self, key) <= 0:
                raise ValueError(f"{key} must be positive")


async def native(function, *args):
    task = asyncio.create_task(asyncio.to_thread(function, *args))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        with contextlib.suppress(Exception):
            await task
        raise


def create_app(settings: Settings | None = None, engine=None, text_engine=None):
    config = settings or Settings()

    @contextlib.asynccontextmanager
    async def lifespan(app):
        os.umask(0o077)
        store = Store(config.data)
        app.state.store = store
        app.state.engine = engine or WhisperEngine(config.data / "models", config.threads, config.max_duration)
        app.state.text_engine = text_engine or TextTranslationEngine(config.text_model_directory, config.threads)
        app.state.text_slots = asyncio.Semaphore(1)
        app.state.queue = asyncio.Queue(maxsize=config.queue_size)
        app.state.upload_slots = asyncio.Semaphore(4)
        app.state.uploading = set()
        app.state.active = set()
        app.state.stopping = False
        for row in store.rows("SELECT * FROM jobs WHERE status IN ('complete','failed','cancelled')"):
            store.audio(row["id"]).unlink(missing_ok=True)
        # An interrupted upload is not a complete audio file. Inference can safely retry.
        for row in store.rows("SELECT * FROM jobs WHERE status IN ('uploading','processing','queued')"):
            identifier = row["id"]
            if row["status"] == "uploading" or row["expires"] <= time.time() or not store.audio(identifier).exists():
                store.update(identifier, "failed", error="Interrupted upload or expired recording. Please share it again.")
                store.audio(identifier).unlink(missing_ok=True)
            else:
                store.update(identifier, "queued")
                app.state.queue.put_nowait(identifier)

        async def process(identifier):
            row = store.get(identifier)
            if not row or row["status"] != "queued":
                return
            if row["expires"] <= time.time():
                store.update(identifier, "cancelled", text=None)
                store.audio(identifier).unlink(missing_ok=True)
                return
            store.update(identifier, "processing")
            app.state.active.add(identifier)
            started = time.monotonic()
            try:
                result = await native(app.state.engine.transcribe, store.audio(identifier), row["language"])
                current = store.get(identifier)
                if current and current["status"] == "processing" and current["expires"] > time.time():
                    store.update(identifier, "complete", text=result["text"], detected_language=result["language"],
                                 duration=result.get("duration", 0), processing_seconds=time.monotonic() - started)
            except asyncio.CancelledError:
                current = store.get(identifier)
                if current and current["status"] == "processing":
                    store.update(identifier, "queued")
                raise
            except Exception as exc:
                current = store.get(identifier)
                if current and current["status"] == "processing":
                    detail = str(exc) if isinstance(exc, ValueError) else "Audio could not be transcribed. Check the file and try again."
                    store.update(identifier, "failed", error=detail, processing_seconds=time.monotonic() - started)
                log.warning("Speech job failed (%s)", type(exc).__name__)
            finally:
                app.state.active.discard(identifier)
                current = store.get(identifier)
                if not current or current["status"] != "queued":
                    store.audio(identifier).unlink(missing_ok=True)

        async def worker():
            while True:
                identifier = await app.state.queue.get()
                try:
                    await process(identifier)
                finally:
                    app.state.queue.task_done()

        async def cleaner():
            while True:
                for row in store.rows("SELECT * FROM jobs WHERE expires <= ?", (time.time(),)):
                    identifier = row["id"]
                    if identifier in app.state.active or row["status"] == "uploading":
                        store.update(identifier, "cancelled", text=None)
                    else:
                        store.audio(identifier).unlink(missing_ok=True)
                        with store.lock, store.db:
                            store.db.execute("DELETE FROM jobs WHERE id=?", (identifier,))
                await asyncio.sleep(30)

        worker_task = asyncio.create_task(worker())
        clean_task = asyncio.create_task(cleaner())
        app.state.worker = worker_task
        try:
            yield
        finally:
            app.state.stopping = True
            clean_task.cancel()
            worker_task.cancel()
            await asyncio.gather(clean_task, worker_task, return_exceptions=True)
            store.close()

    app = FastAPI(title="Chat Utilities", version="0.1.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)

    def ip(request: Request):
        return request.app.state.store.ip_key(request.client.host if request.client else "unknown")

    async def owner(request: Request):
        header = request.headers.get("authorization", "")
        token = header[7:] if header.startswith("Bearer ") else ""
        identifier = request.app.state.store.owner(token) if 20 <= len(token) <= 256 else None
        if identifier is None:
            raise HTTPException(401, "App authentication expired. Please retry to reconnect.")
        return identifier

    @app.get("/healthz")
    async def health():
        if app.state.stopping or app.state.worker.done():
            raise HTTPException(503, "Service is stopping")
        return {"status": "ok", "model": "whisper-small", "max_upload_bytes": config.max_bytes,
                "max_audio_seconds": config.max_duration, "result_ttl_seconds": config.ttl,
                "translation_model": MODEL, "translation_languages": len(LANGUAGES)}

    @app.get("/", response_class=HTMLResponse)
    async def index():
        return """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
        <title>Chat Utilities</title><style>body{font:18px system-ui;max-width:650px;margin:10vh auto;padding:24px;line-height:1.6;color:#17233c}</style>
        <h1>Chat Utilities</h1><p>Voice transcripts and useful chat archives. No Telegram login.</p>
        <p>This service accepts recordings explicitly submitted by the mobile app. It does not access Telegram accounts.</p>
        <p>Uploads are deleted after processing. Results expire automatically. Chat archives are processed on your phone.</p>
        <p><a href="/privacy">Data handling details</a></p></html>"""

    def text_service_auth(request: Request):
        supplied = request.headers.get("x-matrix-translation-key", "")
        if not config.text_translation_key or not supplied or not hmac.compare_digest(supplied, config.text_translation_key):
            raise HTTPException(403, "Invalid service credential.")

    @app.get("/internal/text-translation/config")
    async def text_configuration(request: Request):
        text_service_auth(request)
        return model_configuration()

    @app.post("/internal/text-translation")
    async def translate_text(payload: TextTranslationRequest, request: Request):
        text_service_auth(request)
        if payload.source != "auto" and payload.source not in LANGUAGES or payload.target not in LANGUAGES:
            raise HTTPException(400, "Unsupported language code")
        async with app.state.text_slots:
            try:
                return await native(app.state.text_engine.translate, payload.text, payload.source, payload.target,
                                    payload.temperature, payload.instructions)
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc

    @app.get("/privacy")
    async def privacy():
        return {"audio": "Deleted after processing, cancellation, or expiry.",
                "transcripts": f"Available to the submitting installation for at most {config.ttl} seconds from upload.",
                "archives": "Processed on the phone, not uploaded.",
                "account": "No Telegram account connection or login codes collected.",
                "limits": "Random installation credentials and keyed IP hashes enforce service limits; no raw IPs are stored by this app.",
                "transport": "The production service requires HTTPS. Hosting infrastructure may process connection metadata."}

    @app.post("/v1/installations", status_code=201)
    async def register(request: Request):
        if not app.state.store.rate("register:" + ip(request), config.registrations_per_hour):
            raise HTTPException(429, "Too many app registrations. Please try again later.", headers={"Retry-After": "3600"})
        return {"token": app.state.store.installation()}

    @app.post("/v1/transcriptions", status_code=202)
    async def upload(request: Request, filename: str = Query("recording.ogg", max_length=200),
                     language: str = Query("auto", pattern="^(auto|de|en)$"), installation: str = Depends(owner)):
        store = app.state.store
        bridge_header = request.headers.get("x-bot-bridge-key", "")
        trusted_bridge = bool(bridge_header and any(
            key and hmac.compare_digest(bridge_header, key)
            for key in (config.bot_bridge_key, config.text_translation_key)
        ))
        if bridge_header and not trusted_bridge:
            raise HTTPException(403, "Invalid service credential.")
        length = request.headers.get("content-length")
        if length and (not length.isdigit() or int(length) > config.max_bytes):
            raise HTTPException(413, "Recording exceeds the upload limit.")
        if not store.rate("upload:" + ip(request), config.jobs_per_ip_hour):
            raise HTTPException(429, "Service limit reached. Please try again later.", headers={"Retry-After": "3600"})
        name = filename.replace("\\", "/").split("/")[-1]
        name = "".join(c for c in name if ord(c) >= 32)[:180] or "recording.ogg"
        try:
            identifier = store.reserve(installation, name, language, config.ttl, config.queue_size, None if trusted_bridge else config.daily)
        except ValueError as exc:
            raise HTTPException(429, str(exc), headers={"Retry-After": "60"}) from exc
        path = store.audio(identifier)
        try:
            async with app.state.upload_slots:
                received = 0
                with path.open("xb") as file:
                    async with asyncio.timeout(120):
                        async for chunk in request.stream():
                            received += len(chunk)
                            if received > config.max_bytes:
                                raise HTTPException(413, "Recording exceeds the upload limit.")
                            file.write(chunk)
                if not received:
                    raise HTTPException(400, "The recording is empty.")
            store.update(identifier, "queued")
            app.state.queue.put_nowait(identifier)
        except BaseException:
            path.unlink(missing_ok=True)
            store.update(identifier, "failed", error="Upload did not complete. Please try again.")
            raise
        return {"id": identifier, "status": "queued", "expires_at": store.get(identifier)["expires"]}

    def owned(identifier, installation):
        row = app.state.store.get(identifier, installation)
        if not row or row["expires"] <= time.time() or row["status"] == "cancelled":
            raise HTTPException(404, "Recording result is unavailable or expired.")
        return row

    @app.get("/v1/jobs/{identifier}")
    async def result(identifier: str, installation: str = Depends(owner)):
        row = owned(identifier, installation)
        return {key: row[key] for key in ("id", "filename", "status", "text", "detected_language", "error", "expires", "duration", "processing_seconds")}

    @app.delete("/v1/jobs/{identifier}", status_code=204)
    async def delete(identifier: str, installation: str = Depends(owner)):
        row = owned(identifier, installation)
        app.state.store.update(identifier, "cancelled", text=None, error=None)
        if row["status"] != "processing":
            app.state.store.audio(identifier).unlink(missing_ok=True)

    return app


app = create_app()
