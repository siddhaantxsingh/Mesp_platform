"""Link state machine and reconnection backoff, shared by every transport."""
from __future__ import annotations

import enum
import random
import time
from collections.abc import Callable
from dataclasses import dataclass, field


class LinkState(str, enum.Enum):
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"      # transport up, no data yet
    STREAMING = "streaming"      # valid frames arriving
    STALE = "stale"              # transport up but no valid frame for stale_after seconds


_ALLOWED = {
    LinkState.DISCONNECTED: {LinkState.CONNECTING},
    LinkState.CONNECTING: {LinkState.CONNECTED, LinkState.DISCONNECTED},
    LinkState.CONNECTED: {LinkState.STREAMING, LinkState.STALE, LinkState.DISCONNECTED},
    LinkState.STREAMING: {LinkState.STALE, LinkState.DISCONNECTED},
    LinkState.STALE: {LinkState.STREAMING, LinkState.DISCONNECTED},
}


@dataclass
class LinkStateMachine:
    stale_after: float = 2.0
    on_change: Callable[[LinkState, LinkState, str], None] | None = None
    clock: Callable[[], float] = time.monotonic
    state: LinkState = LinkState.DISCONNECTED
    last_frame: float | None = None
    history: list[tuple[float, str, str, str]] = field(default_factory=list)

    def _go(self, new: LinkState, reason: str) -> None:
        if new == self.state:
            return
        if new not in _ALLOWED[self.state]:
            raise ValueError(f"illegal transition {self.state.value} -> {new.value}")
        old, self.state = self.state, new
        self.history.append((time.time(), old.value, new.value, reason))
        if self.on_change:
            self.on_change(old, new, reason)

    def connecting(self, reason: str = "") -> None:
        if self.state != LinkState.DISCONNECTED:
            self._go(LinkState.DISCONNECTED, "restart")
        self._go(LinkState.CONNECTING, reason)

    def connected(self, reason: str = "") -> None:
        self._go(LinkState.CONNECTED, reason)

    def disconnected(self, reason: str = "") -> None:
        self._go(LinkState.DISCONNECTED, reason)

    def frame(self) -> None:
        self.last_frame = self.clock()
        if self.state in (LinkState.CONNECTED, LinkState.STALE):
            self._go(LinkState.STREAMING, "frames arriving")

    def tick(self) -> None:
        if self.state in (LinkState.STREAMING, LinkState.CONNECTED):
            ref = self.last_frame
            if ref is not None and self.clock() - ref > self.stale_after:
                self._go(LinkState.STALE, f"no valid frame for {self.stale_after:.0f} s")


@dataclass
class Backoff:
    """Exponential backoff with equal jitter: delay in [c/2, c], c = min(cap, base * 2^n)."""
    base: float = 0.5
    cap: float = 30.0
    rng: random.Random = field(default_factory=random.Random)
    attempt: int = 0

    def next(self) -> float:
        ceiling = min(self.cap, self.base * (2 ** self.attempt))
        self.attempt += 1
        return self.rng.uniform(ceiling / 2, ceiling)

    def reset(self) -> None:
        self.attempt = 0
