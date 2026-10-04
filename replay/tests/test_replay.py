import asyncio
import os
import time

import pytest
from mesp_replay import RecordingError, RecordingWriter, ReplayEngine, read_recording


def make(tmp_path, n=50, dt=0.01):
    p = os.path.join(tmp_path, "r.mesprec")
    with RecordingWriter(p, source="test", synthetic=True, meta={"k": 1}) as w:
        for i in range(n):
            w.write(i * dt, bytes([i]) * (i % 7 + 1))
    return p


def test_roundtrip(tmp_path):
    rec = read_recording(make(tmp_path))
    assert rec.synthetic and rec.header["meta"] == {"k": 1}
    assert len(rec.records) == 50 and rec.records[3] == (0.03, b"\x03" * 4)


def test_truncated(tmp_path):
    data = open(make(tmp_path), "rb").read()
    with pytest.raises(RecordingError):
        read_recording(data[:-2])
    with pytest.raises(RecordingError):
        read_recording(b"nope")


def test_realtime_and_speed(tmp_path):
    rec = read_recording(make(tmp_path, n=21, dt=0.01))  # 0.2 s

    async def run(speed):
        t = time.monotonic()
        got = [x async for x in ReplayEngine(rec, speed=speed)]
        return time.monotonic() - t, got

    el1, got = asyncio.run(run(1.0))
    assert len(got) == 21 and 0.17 < el1 < 0.5
    el4, _ = asyncio.run(run(4.0))
    assert el4 < el1 / 2


def test_seek_and_loop(tmp_path):
    rec = read_recording(make(tmp_path, n=10, dt=0.0))

    async def run():
        eng = ReplayEngine(rec, loop=True)
        out = []
        async for t, d in eng:
            out.append(d[0])
            if len(out) == 3:
                eng.seek(0.0)
            if len(out) >= 25:
                break
        return out

    out = asyncio.run(run())
    assert out[:4] == [0, 1, 2, 0]
    assert len(out) == 25
