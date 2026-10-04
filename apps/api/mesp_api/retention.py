"""Raw-sample retention: delete sample chunks older than MESP_RAW_RETENTION_DAYS (vitals/events kept)."""
from __future__ import annotations

import asyncio
import logging
import time

from sqlalchemy import delete, select

from . import models
from .context import AppContext, cancel

log = logging.getLogger("mesp.retention")


class RetentionJob:
    def __init__(self, ctx: AppContext, interval_s: float = 3600):
        self.ctx, self.interval = ctx, interval_s
        self.task: asyncio.Task | None = None

    def start(self) -> None:
        if self.ctx.settings.raw_retention_days > 0:
            self.task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        await cancel(self.task)

    async def run_once(self) -> int:
        cutoff = time.time() - self.ctx.settings.raw_retention_days * 86400
        async with self.ctx.db.session() as s:
            old = select(models.Session.id).where(models.Session.ended_at.is_not(None), models.Session.ended_at < cutoff)
            res = await s.execute(delete(models.SampleChunk).where(models.SampleChunk.session_id.in_(old)))
            await s.commit()
        if res.rowcount:
            log.info("retention removed %d raw chunks", res.rowcount)
        return res.rowcount or 0

    async def _loop(self) -> None:
        while True:
            try:
                await self.run_once()
            except Exception:  # noqa: BLE001
                log.exception("retention run failed")
            await asyncio.sleep(self.interval)
