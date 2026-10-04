"""Raw byte-stream recordings (.mesprec) and a timing-faithful replay engine.

Format (little-endian):
    b"MESPREC1\\n"
    one JSON header line: {"source", "synthetic", "created", "meta", "format_version": 1}
    records: float64 t (seconds from start) | uint32 n | n raw bytes   (repeated)

Recordings hold *raw link bytes*, before deframing, so a replay exercises the deframer, CRC
checks and the whole pipeline exactly as live hardware does. A header with
"synthetic": true marks SIMULATED DATA and the platform labels the session that way.
"""
from __future__ import annotations

import asyncio
import json
import struct
import time
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from typing import BinaryIO

MAGIC = b"MESPREC1\n"
_REC = struct.Struct("<dI")


class RecordingError(ValueError):
    pass


class RecordingWriter:
    def __init__(self, path: str, source: str, synthetic: bool, meta: dict | None = None):
        self.path = path
        self._f: BinaryIO = open(path, "wb")
        hdr = {"format_version": 1, "source": source, "synthetic": synthetic,
               "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "meta": meta or {}}
        self._f.write(MAGIC + json.dumps(hdr).encode() + b"\n")
        self.records = 0

    def write(self, t: float, data: bytes) -> None:
        self._f.write(_REC.pack(t, len(data)) + data)
        self.records += 1

    def close(self) -> None:
        self._f.close()

    def __enter__(self) -> RecordingWriter:
        return self

    def __exit__(self, *exc) -> None:
        self.close()


@dataclass
class Recording:
    header: dict
    records: list[tuple[float, bytes]]

    @property
    def duration(self) -> float:
        return self.records[-1][0] if self.records else 0.0

    @property
    def synthetic(self) -> bool:
        return bool(self.header.get("synthetic"))


def read_recording(path_or_bytes: str | bytes) -> Recording:
    data = open(path_or_bytes, "rb").read() if isinstance(path_or_bytes, str) else path_or_bytes
    if not data.startswith(MAGIC):
        raise RecordingError("not a .mesprec file")
    nl = data.index(b"\n", len(MAGIC))
    header = json.loads(data[len(MAGIC):nl])
    if header.get("format_version") != 1:
        raise RecordingError(f"unsupported recording version {header.get('format_version')}")
    pos, recs, last = nl + 1, [], -1.0
    while pos < len(data):
        if pos + _REC.size > len(data):
            raise RecordingError("truncated record header")
        t, n = _REC.unpack_from(data, pos)
        pos += _REC.size
        if pos + n > len(data):
            raise RecordingError("truncated record body")
        if t < last:
            raise RecordingError("timestamps go backwards")
        recs.append((t, data[pos:pos + n]))
        pos += n
        last = t
    return Recording(header, recs)


class ReplayEngine:
    """Plays a recording back in (scaled) real time. Controls: speed, pause/resume, seek, loop."""

    def __init__(self, rec: Recording, speed: float = 1.0, loop: bool = False):
        if speed <= 0:
            raise ValueError("speed must be > 0")
        self.rec, self.speed, self.loop = rec, speed, loop
        self._paused = asyncio.Event()
        self._paused.set()
        self._pos = 0
        self._seek_to: float | None = None
        self.position_s = 0.0

    def pause(self) -> None:
        self._paused.clear()

    def resume(self) -> None:
        self._paused.set()

    @property
    def paused(self) -> bool:
        return not self._paused.is_set()

    def seek(self, t: float) -> None:
        self._seek_to = max(0.0, t)

    def iter_fast(self) -> Iterator[tuple[float, bytes]]:
        """No timing: every record immediately (tests, bulk import)."""
        yield from self.rec.records

    async def __aiter__(self) -> AsyncIterator[tuple[float, bytes]]:
        recs = self.rec.records
        while True:
            wall0, t0 = time.monotonic(), (recs[self._pos][0] if recs and self._pos < len(recs) else 0.0)
            while self._pos < len(recs):
                if self._seek_to is not None:
                    self._pos = next((i for i, r in enumerate(recs) if r[0] >= self._seek_to), len(recs))
                    self._seek_to = None
                    break
                if self.paused:
                    await self._paused.wait()
                    break  # re-anchor the clock after a pause
                t, data = recs[self._pos]
                delay = (t - t0) / self.speed - (time.monotonic() - wall0)
                if delay > 0:
                    await asyncio.sleep(delay)
                self.position_s = t
                self._pos += 1
                yield t, data
            else:
                if not self.loop:
                    return
                self._pos = 0
