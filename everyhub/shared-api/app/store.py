# Copyright 2026 Gwang-Jin Kim
# SPDX-License-Identifier: AGPL-3.0-only

from __future__ import annotations

import hashlib
import hmac
import secrets
import sqlite3
import threading
import time
from pathlib import Path


class Store:
    def __init__(self, root: Path):
        root.mkdir(parents=True, exist_ok=True)
        (root / "audio").mkdir(exist_ok=True)
        key_file = root / "ip-hash.key"
        if not key_file.exists():
            with key_file.open("xb") as file:
                file.write(secrets.token_bytes(32))
            key_file.chmod(0o600)
        self.key = key_file.read_bytes()
        self.root = root
        self.lock = threading.RLock()
        self.db = sqlite3.connect(root / "service.sqlite3", check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS installations (token TEXT PRIMARY KEY, created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS rates (scope TEXT, slot INTEGER, hits INTEGER,
                PRIMARY KEY(scope,slot));
            CREATE TABLE IF NOT EXISTS usage (owner TEXT, day INTEGER, hits INTEGER,
                PRIMARY KEY(owner,day));
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY, owner TEXT NOT NULL, filename TEXT NOT NULL,
                language TEXT NOT NULL, status TEXT NOT NULL, created REAL NOT NULL,
                expires REAL NOT NULL, text TEXT, detected_language TEXT, error TEXT);
            CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(owner,created);
        """)
        columns = {row[1] for row in self.db.execute("PRAGMA table_info(jobs)")}
        for column in ("duration", "processing_seconds"):
            if column not in columns:
                self.db.execute(f"ALTER TABLE jobs ADD COLUMN {column} REAL NOT NULL DEFAULT 0")
        self.db.commit()

    def ip_key(self, address: str):
        return hmac.new(self.key, address.encode(), hashlib.sha256).hexdigest()

    def rate(self, scope: str, limit: int, seconds: int = 3600):
        slot = int(time.time()) // seconds
        with self.lock, self.db:
            row = self.db.execute("SELECT hits FROM rates WHERE scope=? AND slot=?", (scope, slot)).fetchone()
            if row and row[0] >= limit:
                return False
            self.db.execute("INSERT INTO rates VALUES(?,?,1) ON CONFLICT(scope,slot) DO UPDATE SET hits=hits+1", (scope, slot))
            # All rate buckets use hours; retain two days only.
            self.db.execute("DELETE FROM rates WHERE slot < ?", (slot - 48,))
        return True

    def installation(self):
        token = secrets.token_urlsafe(32)
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.lock, self.db:
            self.db.execute("INSERT INTO installations VALUES (?,?)", (digest, time.time()))
        return token

    def owner(self, token: str):
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.lock:
            row = self.db.execute("SELECT token FROM installations WHERE token=?", (digest,)).fetchone()
        return digest if row else None

    def reserve(self, owner: str, filename: str, language: str, ttl: int, capacity: int, daily: int | None):
        now, day = time.time(), int(time.time()) // 86400
        with self.lock, self.db:
            used = self.db.execute("SELECT hits FROM usage WHERE owner=? AND day=?", (owner, day)).fetchone()
            if daily is not None and used and used[0] >= daily:
                raise ValueError("Daily transcription limit reached. Try again tomorrow.")
            pending = self.db.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('uploading','queued','processing')").fetchone()[0]
            personal = self.db.execute("SELECT COUNT(*) FROM jobs WHERE owner=? AND status IN ('uploading','queued','processing')", (owner,)).fetchone()[0]
            if pending >= capacity or personal >= 10:
                raise ValueError("The queue is full. Try again after your existing jobs finish.")
            identifier = secrets.token_hex(16)
            self.db.execute("INSERT INTO jobs(id,owner,filename,language,status,created,expires,text,detected_language,error) VALUES (?,?,?,?,?,?,?,?,?,?)", (
                identifier, owner, filename, language, "uploading", now, now + ttl, None, None, None,
            ))
            self.db.execute("INSERT INTO usage VALUES(?,?,1) ON CONFLICT(owner,day) DO UPDATE SET hits=hits+1", (owner, day))
            self.db.execute("DELETE FROM usage WHERE day < ?", (day - 7,))
        return identifier

    def get(self, identifier: str, owner: str | None = None):
        with self.lock:
            row = self.db.execute("SELECT * FROM jobs WHERE id=?", (identifier,)).fetchone()
        if not row or (owner is not None and row["owner"] != owner):
            return None
        return dict(row)

    def update(self, identifier: str, status: str, **values):
        # Only internal callers supply columns. Keep SQL identifiers fixed.
        allowed = {"text", "detected_language", "error", "duration", "processing_seconds"}
        if not set(values) <= allowed:
            raise ValueError("Invalid job update")
        columns = ["status=?", *[f"{name}=?" for name in values]]
        with self.lock, self.db:
            self.db.execute(f"UPDATE jobs SET {','.join(columns)} WHERE id=?", (status, *values.values(), identifier))

    def rows(self, sql, params=()):
        with self.lock:
            return [dict(row) for row in self.db.execute(sql, params).fetchall()]

    def audio(self, identifier: str):
        # IDs are generated by us or read from our own DB, never arbitrary paths.
        if len(identifier) != 32 or any(c not in "0123456789abcdef" for c in identifier):
            raise ValueError("Invalid recording identifier")
        return self.root / "audio" / identifier

    def close(self):
        self.db.close()
