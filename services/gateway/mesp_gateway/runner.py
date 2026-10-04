"""Gateway core: source -> Deframer -> link state -> batched uplink. Transport-agnostic."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from mesp_protocol import Deframer

from .ingest_codec import encode_batch
from .link import Backoff, LinkState, LinkStateMachine
from .sources import Source, SourceEvent

log = logging.getLogger("mesp.gateway")

# Sink: receives ("batch", bytes) or ("json", dict)
Sink = Callable[[str, object], Awaitable[None]]


@dataclass
class Gateway:
    source: Source
    sink: Sink
    flush_interval: float = 0.05
    status_interval: float = 1.0
    reconnect: bool = True
    recorder: object | None = None           # mesp_replay.RecordingWriter
    deframer: Deframer = field(default_factory=Deframer)
    backoff: Backoff = field(default_factory=Backoff)

    def __post_init__(self) -> None:
        self.link = LinkStateMachine(on_change=self._on_link)
        self._pending: list[tuple[float, bytes]] = []
        self._events: list[dict] = []
        self.frames_forwarded = 0
        self._rec_t0: float | None = None

    def _on_link(self, old: LinkState, new: LinkState, reason: str) -> None:
        log.info("link %s -> %s (%s)", old.value, new.value, reason)
        self._events.append({"type": "link", "from": old.value, "to": new.value, "reason": reason, "at": time.time()})

    async def _flush(self) -> None:
        for ev in self._events:
            await self.sink("json", ev)
        self._events.clear()
        if self._pending:
            batch, self._pending = self._pending, []
            await self.sink("batch", encode_batch(batch))
            self.frames_forwarded += len(batch)

    def _status(self) -> dict:
        return {"type": "status", "source": self.source.name, "synthetic": self.source.synthetic,
                "link_state": self.link.state.value, "deframer": self.deframer.stats.as_dict(),
                "frames_forwarded": self.frames_forwarded, "at": time.time()}

    async def _handle(self, ev: SourceEvent) -> None:
        if ev.kind == "up":
            self.link.connected(ev.reason)
        elif ev.kind == "down":
            self.link.disconnected(ev.reason)
        else:
            if self.recorder is not None:
                if self._rec_t0 is None:
                    self._rec_t0 = ev.rx_time
                self.recorder.write(ev.rx_time - self._rec_t0, ev.data)  # type: ignore[attr-defined]
            for f in self.deframer.feed(ev.data, ev.rx_time):
                self._pending.append((ev.rx_time, f.to_bytes()))
                self.link.frame()

    async def run(self, stop: asyncio.Event | None = None) -> None:
        stop = stop or asyncio.Event()
        await self.sink("json", {"type": "hello", "source": self.source.name, "synthetic": self.source.synthetic,
                                 "realtime": getattr(self.source, "realtime", True),
                                 "ingest_version": 1, "gateway_version": "1.0.0"})
        ticker = asyncio.create_task(self._ticker(stop))
        try:
            while not stop.is_set():
                self.link.connecting(f"opening {self.source.name}")
                try:
                    async for ev in self.source.events():
                        await self._handle(ev)
                        if ev.kind == "up":
                            self.backoff.reset()
                        if stop.is_set():
                            break
                except asyncio.CancelledError:
                    raise
                except Exception as e:  # transport failure -> reconnect
                    log.warning("source error: %s", e)
                if self.link.state != LinkState.DISCONNECTED and not stop.is_set():
                    self.link.disconnected("source ended")   # (a deliberate stop is announced by "bye" instead)
                await self._flush()
                if not self.reconnect or stop.is_set():
                    break
                delay = self.backoff.next()
                log.info("reconnecting in %.1f s", delay)
                try:
                    await asyncio.wait_for(stop.wait(), timeout=delay)
                except TimeoutError:
                    pass
        finally:
            ticker.cancel()
            await self._flush()

    async def _ticker(self, stop: asyncio.Event) -> None:
        last_status = 0.0
        while not stop.is_set():
            await asyncio.sleep(self.flush_interval)
            self.link.tick()
            await self._flush()
            if time.monotonic() - last_status >= self.status_interval:
                last_status = time.monotonic()
                await self.sink("json", self._status())


class WebSocketUplink:
    """Sink that ships batches to the API over WebSocket, reconnecting with backoff and
    buffering a bounded backlog (drop-oldest) while the API is unreachable."""

    def __init__(self, url: str, device_key: str, max_backlog: int = 2000):
        self.url, self.device_key, self.max_backlog = url, device_key, max_backlog
        self._q: asyncio.Queue[tuple[str, object]] = asyncio.Queue()
        self.dropped = 0
        self._hello: dict | None = None
        self._task: asyncio.Task | None = None
        self.connected = False

    async def __call__(self, kind: str, payload: object) -> None:
        if kind == "json" and isinstance(payload, dict) and payload.get("type") == "hello":
            self._hello = payload
        if self._q.qsize() >= self.max_backlog:
            self._q.get_nowait()
            self.dropped += 1
        await self._q.put((kind, payload))
        if self._task is None:
            self._task = asyncio.create_task(self._pump())

    async def close(self, timeout: float = 5.0) -> None:
        """Graceful stop: drain the backlog, then announce "bye" so the API raises no disconnect alarm."""
        await self("json", {"type": "bye"})
        t0 = asyncio.get_running_loop().time()
        while not self._q.empty() and asyncio.get_running_loop().time() - t0 < timeout:
            await asyncio.sleep(0.05)
        await asyncio.sleep(0.1)
        if self._task:
            self._task.cancel()

    async def _pump(self) -> None:
        import websockets
        backoff = Backoff()
        while True:
            try:
                async with websockets.connect(self.url, additional_headers={"X-Device-Key": self.device_key},
                                              max_size=2 ** 22, ping_interval=10) as ws:
                    self.connected = True
                    backoff.reset()
                    log.info("uplink connected to %s", self.url)
                    if self._hello:
                        await ws.send(json.dumps(self._hello))
                    while True:
                        kind, payload = await self._q.get()
                        if kind == "batch":
                            await ws.send(payload)  # type: ignore[arg-type]
                        elif not (isinstance(payload, dict) and payload.get("type") == "hello"):
                            await ws.send(json.dumps(payload))
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.connected = False
                d = backoff.next()
                log.warning("uplink error (%s); retry in %.1f s", e, d)
                await asyncio.sleep(d)
