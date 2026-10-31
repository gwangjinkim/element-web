# Copyright 2026 Gwang-Jin Kim
# SPDX-License-Identifier: AGPL-3.0-only

import hashlib
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.main import Settings, create_app
from app.store import Store


class FakeEngine:
    def __init__(self):
        self.release = threading.Event()
        self.release.set()
        self.entered = threading.Event()
        self.calls = 0

    def transcribe(self, path, language):
        self.entered.set()
        self.release.wait(timeout=5)
        self.calls += 1
        content = path.read_bytes()
        if content == b"invalid":
            raise ValueError("No speech detected in this recording.")
        return {"text": content.decode(), "language": "de" if language == "auto" else language}


def credential(client):
    response = client.post("/v1/installations")
    assert response.status_code == 201
    return {"Authorization": "Bearer " + response.json()["token"]}


def wait_result(client, headers, identifier, expected="complete"):
    for _ in range(200):
        response = client.get("/v1/jobs/" + identifier, headers=headers)
        if response.status_code == 200 and response.json()["status"] == expected:
            return response.json()
        time.sleep(0.005)
    raise AssertionError(response.text)


@pytest.fixture
def service(tmp_path):
    engine = FakeEngine()
    app = create_app(Settings(data=tmp_path, registrations_per_hour=20), engine)
    with TestClient(app) as client:
        try:
            yield app, client, engine
        finally:
            engine.release.set()


def test_no_auth_and_no_cross_installation_access(service):
    app, client, engine = service
    assert client.post("/v1/transcriptions", content=b"hello").status_code == 401
    alice, bob = credential(client), credential(client)
    response = client.post("/v1/transcriptions?filename=voice.ogg", content=b"Hallo", headers=alice)
    assert response.status_code == 202
    identifier = response.json()["id"]
    assert wait_result(client, alice, identifier)["text"] == "Hallo"
    assert client.get("/v1/jobs/" + identifier, headers=bob).status_code == 404
    assert client.delete("/v1/jobs/" + identifier, headers=bob).status_code == 404
    assert not app.state.store.audio(identifier).exists()
    assert client.delete("/v1/jobs/" + identifier, headers=alice).status_code == 204
    assert client.get("/v1/jobs/" + identifier, headers=alice).status_code == 404


def test_upload_size_empty_language_and_filename(tmp_path):
    app = create_app(Settings(data=tmp_path, max_bytes=12), FakeEngine())
    with TestClient(app) as client:
        headers = credential(client)
        assert client.post("/v1/transcriptions", content=b"x" * 13, headers=headers).status_code == 413
        assert client.post("/v1/transcriptions", content=iter([b"x" * 7, b"x" * 7]), headers=headers).status_code == 413
        assert client.post("/v1/transcriptions", content=b"", headers=headers).status_code == 400
        assert client.post("/v1/transcriptions?language=xx", content=b"x", headers=headers).status_code == 422
        response = client.post("/v1/transcriptions", params={"filename": "../../hello.ogg"}, content=b"ok", headers=headers)
        result = wait_result(client, headers, response.json()["id"])
        assert result["filename"] == "hello.ogg"
        assert list((tmp_path / "audio").iterdir()) == []


def test_bounded_queue_and_worker_continues_after_failure(tmp_path):
    engine = FakeEngine()
    engine.release.clear()
    app = create_app(Settings(data=tmp_path, queue_size=2), engine)
    with TestClient(app) as client:
        try:
            headers = credential(client)
            one = client.post("/v1/transcriptions", content=b"invalid", headers=headers).json()["id"]
            assert engine.entered.wait(2)
            two = client.post("/v1/transcriptions", content=b"second", headers=headers).json()["id"]
            assert client.post("/v1/transcriptions", content=b"third", headers=headers).status_code == 429
            engine.release.set()
            assert "No speech" in wait_result(client, headers, one, "failed")["error"]
            assert wait_result(client, headers, two)["text"] == "second"
        finally:
            engine.release.set()


def test_cancellation_during_inference_does_not_resurrect_result(service):
    app, client, engine = service
    engine.release.clear()
    headers = credential(client)
    identifier = client.post("/v1/transcriptions", content=b"cancel me", headers=headers).json()["id"]
    assert engine.entered.wait(2)
    assert client.delete("/v1/jobs/" + identifier, headers=headers).status_code == 204
    engine.release.set()
    for _ in range(200):
        if not app.state.store.audio(identifier).exists():
            break
        time.sleep(0.005)
    assert not app.state.store.audio(identifier).exists()
    assert app.state.store.get(identifier)["text"] is None
    assert client.get("/v1/jobs/" + identifier, headers=headers).status_code == 404


def test_quota_remains_after_deletion_and_registration_is_rate_limited(tmp_path):
    app = create_app(Settings(data=tmp_path, daily=1, registrations_per_hour=1), FakeEngine())
    with TestClient(app) as client:
        headers = credential(client)
        assert client.post("/v1/installations").status_code == 429
        identifier = client.post("/v1/transcriptions", content=b"hello", headers=headers).json()["id"]
        wait_result(client, headers, identifier)
        client.delete("/v1/jobs/" + identifier, headers=headers)
        assert client.post("/v1/transcriptions", content=b"again", headers=headers).status_code == 429


def test_expired_results_inaccessible_and_credentials_are_hashed(service):
    app, client, engine = service
    headers = credential(client)
    token = headers["Authorization"][7:]
    identifier = client.post("/v1/transcriptions", content=b"hello", headers=headers).json()["id"]
    wait_result(client, headers, identifier)
    store = app.state.store
    with store.lock, store.db:
        store.db.execute("UPDATE jobs SET expires=? WHERE id=?", (time.time() - 1, identifier))
    assert client.get("/v1/jobs/" + identifier, headers=headers).status_code == 404
    assert store.rows("SELECT token FROM installations")[0]["token"] == hashlib.sha256(token.encode()).hexdigest()
    assert store.ip_key("1.2.3.4") != "1.2.3.4"


def test_restart_recovers_interrupted_inference_and_rejects_partial_upload(tmp_path):
    store = Store(tmp_path)
    raw = store.installation()
    owner = store.owner(raw)
    completed_upload = store.reserve(owner, "voice.ogg", "auto", 86400, 32, 20)
    partial_upload = store.reserve(owner, "partial.ogg", "auto", 86400, 32, 20)
    store.audio(completed_upload).write_bytes(b"recover")
    store.audio(partial_upload).write_bytes(b"partial")
    store.update(completed_upload, "processing")
    store.close()
    with TestClient(create_app(Settings(data=tmp_path), FakeEngine())) as client:
        headers = {"Authorization": "Bearer " + raw}
        assert wait_result(client, headers, completed_upload)["text"] == "recover"
        assert client.get("/v1/jobs/" + partial_upload, headers=headers).json()["status"] == "failed"
    assert list((tmp_path / "audio").iterdir()) == []


def test_health_and_privacy_do_not_load_a_model(service):
    app, client, engine = service
    assert client.get("/healthz").json()["status"] == "ok"
    assert "phone" in client.get("/privacy").json()["archives"]
    assert client.get("/").status_code == 200
    assert engine.calls == 0


@pytest.mark.parametrize("key", ["telegram-bridge-test-key", "matrix-bridge-test-key"])
def test_both_authorized_bridges_share_the_existing_speech_queue(tmp_path, key):
    app = create_app(Settings(data=tmp_path, daily=1,
                    bot_bridge_key="telegram-bridge-test-key",
                    text_translation_key="matrix-bridge-test-key"), FakeEngine())
    with TestClient(app) as client:
        headers = credential(client)
        rejected = client.post("/v1/transcriptions", content=b"hello",
                               headers={**headers, "X-Bot-Bridge-Key": "invalid-key"})
        assert rejected.status_code == 403
        headers["X-Bot-Bridge-Key"] = key
        for _ in range(2):
            response = client.post("/v1/transcriptions", content=b"hello", headers=headers)
            assert response.status_code == 202
            assert wait_result(client, headers, response.json()["id"])["text"] == "hello"


def test_restart_removes_audio_left_by_cancelled_inference(tmp_path):
    store = Store(tmp_path)
    owner = store.owner(store.installation())
    identifier = store.reserve(owner, "voice.ogg", "auto", 86400, 32, 20)
    store.audio(identifier).write_bytes(b"cancelled recording")
    store.update(identifier, "cancelled", text=None)
    store.close()
    with TestClient(create_app(Settings(data=tmp_path), FakeEngine())):
        assert not (tmp_path / "audio" / identifier).exists()
