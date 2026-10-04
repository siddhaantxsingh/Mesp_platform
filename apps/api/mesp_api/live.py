"""In-process pub/sub for live WebSocket clients (one API instance; see ADR-003 for scale-out)."""
from __future__ import annotations

import asyncio
import json
from collections import defaultdict


class LiveHub:
    def __init__(self, queue_size: int = 400):
        self.queue_size = queue_size
        self._subs: dict[str, set[asyncio.Queue[str]]] = defaultdict(set)
        self.dropped = 0
        self.published = 0

    def subscribe(self, device_id: str) -> asyncio.Queue[str]:
        q: asyncio.Queue[str] = asyncio.Queue(self.queue_size)
        self._subs[device_id].add(q)
        return q

    def unsubscribe(self, device_id: str, q: asyncio.Queue[str]) -> None:
        self._subs[device_id].discard(q)

    @property
    def client_count(self) -> int:
        return sum(len(s) for s in self._subs.values())

    def publish(self, device_id: str, msg: dict) -> None:
        msg.setdefault("v", 1)
        msg.setdefault("device_id", device_id)
        data = json.dumps(msg, separators=(",", ":"), allow_nan=False, default=_default)
        for key in (device_id, "*"):
            for q in list(self._subs.get(key, ())):
                if q.full():                 # slow client: drop its oldest message, never block ingest
                    try:
                        q.get_nowait()
                        self.dropped += 1
                    except asyncio.QueueEmpty:
                        pass
                q.put_nowait(data)
        self.published += 1


def _default(o):
    try:
        import numpy as np
        if isinstance(o, np.generic):
            return o.item()
    except ImportError:
        pass
    raise TypeError(type(o))
