"""Application context shared by routes, WebSockets and the ingest pipeline."""
from __future__ import annotations

import asyncio
import logging
import time

from sqlalchemy import select

from . import models
from .config import Settings
from .db import Database
from .live import LiveHub
from .security import RateLimiter

log = logging.getLogger("mesp")


class Metrics:
    def __init__(self) -> None:
        self.counters: dict[str, float] = {"ingest_batches_total": 0, "ingest_frames_total": 0,
                                           "ingest_rejected_messages_total": 0, "http_requests_total": 0,
                                           "ws_live_connections_total": 0}
        self.started = time.time()

    def inc(self, name: str, v: float = 1) -> None:
        self.counters[name] = self.counters.get(name, 0) + v


class AppContext:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.db = Database(settings.database_url)
        self.hub = LiveHub()
        self.metrics = Metrics()
        self.ingest: dict[str, object] = {}       # device_id -> IngestSession
        self.login_limiter = RateLimiter(settings.login_rate_per_minute)
        self.demo = None                           # DemoController
        self.jwt_secret = settings.resolved_jwt_secret()

    def publish(self, device_id: str, msg: dict) -> None:
        self.hub.publish(device_id, msg)

    async def audit(self, actor: str, action: str, target: str | None = None, detail: dict | None = None,
                    ip: str | None = None) -> None:
        async with self.db.session() as s:
            s.add(models.AuditLog(actor=actor, action=action, target=target, detail=detail or {}, ip=ip))
            await s.commit()

    async def bootstrap(self) -> None:
        if self.settings.auto_create_schema:
            await self.db.create_all()
        from .security import hash_password
        st = self.settings
        if st.admin_email and st.admin_password:
            if len(st.admin_password) < 10:
                # don't crash the deployment over a bootstrap setting; just don't create the account
                log.error("MESP_ADMIN_PASSWORD is shorter than 10 characters: admin account NOT created")
                return
            async with self.db.session() as s:
              existing = (await s.execute(
    select(models.User).where(
        models.User.email == st.admin_email.lower()
    )
)).scalar_one_or_none()

if existing is None:
    s.add(models.User(
        email=st.admin_email.lower(),
        password_hash=hash_password(st.admin_password),
        role="admin"
    ))
    await s.commit()
    log.info("bootstrap admin %s created", st.admin_email)
else:
    existing.password_hash = hash_password(st.admin_password)
    existing.role = "admin"
    await s.commit()
    log.info("bootstrap admin %s password synchronized", st.admin_email)
