"""In-process demo/replay sources. They run the real Gateway (deframer + link state machine) and
hand its output to the same IngestSession entry points the WebSocket ingest endpoint uses."""
from __future__ import annotations

import asyncio
import logging
import time

from mesp_gateway import decode_batch
from mesp_gateway.runner import Gateway
from mesp_gateway.sources import ReplaySource, SimulatorSource
from sqlalchemy import select

from . import models
from .context import AppContext, cancel
from .pipeline.ingest import IngestSession
from .security import new_device_key

log = logging.getLogger("mesp.demo")
DEMO_DEVICE_NAME = "Demo wristband (simulated)"


class DemoController:
    def __init__(self, ctx: AppContext):
        self.ctx = ctx
        self.task: asyncio.Task | None = None
        self.session: IngestSession | None = None
        self.scenario: str | None = None
        self.replay_name: str | None = None
        self.started_at: float | None = None
        self.stop_event = asyncio.Event()

    async def demo_device(self) -> models.Device:
        async with self.ctx.db.session() as s:
            dev = (await s.execute(select(models.Device).where(models.Device.simulated.is_(True),
                                                               models.Device.name == DEMO_DEVICE_NAME))).scalar_one_or_none()
            if dev is None:
                _key, kh, prefix = new_device_key()   # the demo device never ingests over the network
                dev = models.Device(name=DEMO_DEVICE_NAME, profile_id="mesp-lab-main-v1", key_hash=kh,
                                    key_prefix=prefix, simulated=True, firmware="simulator")
                s.add(dev)
                await s.commit()
            return dev

    async def start(self, scenario: str | None = None, recording: str | None = None, speed: float = 1.0,
                    seed: int = 1234) -> dict:
        await self.stop()
        dev = await self.demo_device()
        if recording:
            src = ReplaySource(recording, speed=speed, loop=True)
            self.replay_name, self.scenario = src.name, None
        else:
            src = SimulatorSource(scenario or "normal", seed=seed, speed=speed)
            self.scenario, self.replay_name = scenario or "normal", None
        sess = IngestSession(self.ctx, dev, source=src.name, synthetic=True if not recording else src.synthetic,
                             realtime=src.realtime)
        await sess.start()
        self.ctx.ingest[dev.id] = sess
        self.session = sess

        async def sink(kind: str, payload) -> None:
            if kind == "batch":
                await sess.handle_batch(decode_batch(payload))
            else:
                await sess.handle_control(payload)

        self.stop_event = asyncio.Event()
        gw = Gateway(src, sink)
        self.task = asyncio.create_task(self._run(gw))
        self.started_at = time.time()
        return self.status()

    async def _run(self, gw: Gateway) -> None:
        try:
            await gw.run(self.stop_event)
        except asyncio.CancelledError:
            pass
        except Exception:
            log.exception("demo source crashed")

    async def stop(self) -> None:
        self.stop_event.set()
        await cancel(self.task)
        self.task = None
        if self.session:
            await self.session.close("demo stopped", expected=True)
            self.ctx.ingest.pop(self.session.device_id, None)
            self.session = None
        self.scenario = self.replay_name = None

    def status(self) -> dict:
        return {"running": self.task is not None and not self.task.done(), "scenario": self.scenario,
                "replay": self.replay_name, "started_at": self.started_at,
                "device_id": self.session.device_id if self.session else None,
                "session_id": self.session.session_id if self.session else None,
                "label": "DEMO MODE — SYNTHETIC DATA"}
