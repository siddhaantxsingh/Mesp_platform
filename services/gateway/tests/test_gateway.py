import asyncio
import random

import pytest
from mesp_gateway import Backoff, LinkState, LinkStateMachine, decode_batch, encode_batch
from mesp_gateway.ingest_codec import IngestDecodeError
from mesp_gateway.runner import Gateway
from mesp_gateway.sources import SimulatorSource, SourceEvent
from mesp_protocol import Deframer, encode_frame


def test_codec_roundtrip():
    items = [(1.5, encode_frame(1, 3, b"\x00" * 6)), (2.25, encode_frame(4, 4, b"hi"))]
    assert decode_batch(encode_batch(items)) == items
    assert decode_batch(encode_batch([])) == []


@pytest.mark.parametrize("bad", [b"", b"\x02\x00\x00", encode_batch([(1.0, b"abc")])[:-1],
                                 encode_batch([(1.0, b"abc")]) + b"x"])
def test_codec_rejects(bad):
    with pytest.raises(IngestDecodeError):
        decode_batch(bad)


def test_state_machine_transitions_and_stale():
    now = [0.0]
    seen = []
    sm = LinkStateMachine(stale_after=2.0, clock=lambda: now[0], on_change=lambda o, n, r: seen.append(n))
    sm.connecting(); sm.connected(); sm.frame()
    assert sm.state == LinkState.STREAMING
    now[0] = 1.0; sm.tick(); assert sm.state == LinkState.STREAMING
    now[0] = 3.5; sm.tick(); assert sm.state == LinkState.STALE
    sm.frame(); assert sm.state == LinkState.STREAMING
    sm.disconnected(); assert sm.state == LinkState.DISCONNECTED
    with pytest.raises(ValueError):
        sm.connected()
    assert seen == [LinkState.CONNECTING, LinkState.CONNECTED, LinkState.STREAMING, LinkState.STALE,
                    LinkState.STREAMING, LinkState.DISCONNECTED]


def test_backoff_grows_and_caps():
    b = Backoff(base=0.5, cap=8, rng=random.Random(0))
    d = [b.next() for _ in range(10)]
    assert d[0] <= 0.5 and max(d) <= 8 and d[-1] >= 4
    b.reset(); assert b.next() <= 0.5


class ListSource:
    synthetic = True
    name = "list"

    def __init__(self, events):
        self._ev = events

    async def events(self):
        for e in self._ev:
            yield e
            await asyncio.sleep(0)


def test_gateway_forwards_only_valid_frames():
    f1, f2 = encode_frame(5, 0, b"\x08\x00" * 4), encode_frame(2, 1, b"\x00" * 14)
    bad = bytearray(encode_frame(1, 2, b"\x01" * 6)); bad[9] ^= 1
    stream = b"junk" + f1 + bytes(bad) + f2
    evs = [SourceEvent("up")] + [SourceEvent("data", stream[i:i + 5], 100.0 + i) for i in range(0, len(stream), 5)] \
        + [SourceEvent("down", reason="end")]
    out = []

    async def sink(kind, payload):
        out.append((kind, payload))

    gw = Gateway(ListSource(evs), sink, reconnect=False)
    asyncio.run(gw.run())
    frames = [raw for k, p in out if k == "batch" for _, raw in decode_batch(p)]
    assert frames == [f1, f2]
    assert gw.deframer.stats.crc_errors >= 1
    links = [p["to"] for k, p in out if k == "json" and p.get("type") == "link"]
    assert links[:3] == ["connecting", "connected", "streaming"] and links[-1] == "disconnected"
    assert out[0][1]["type"] == "hello"


def test_simulator_source_realtime_scaled():
    async def go():
        src = SimulatorSource("ble_disconnect", speed=40.0)
        d, n_down, n_up, frames = Deframer(), 0, 0, 0
        async for ev in src.events():
            if ev.kind == "data":
                frames += len(d.feed(ev.data))
            elif ev.kind == "down":
                n_down += 1
            elif ev.kind == "up":
                n_up += 1
            if src.device.time >= 45:
                break
        return frames, n_down, n_up, d.stats.crc_errors

    frames, n_down, n_up, crc = asyncio.run(asyncio.wait_for(go(), 10))
    assert frames > 8000 and crc == 0
    assert n_down == 1 and n_up == 2   # start + reconnect
