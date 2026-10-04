"""Ingest pipeline: validate -> decode -> timestamp -> sequence/dedup -> persist -> derive -> events -> live.

One ``IngestSession`` exists per connected gateway (or in-process demo/replay source). Every
source reaches the platform through ``handle_batch`` / ``handle_control``, so simulated,
replayed and hardware data take exactly the same path from this point on.
"""
from __future__ import annotations

import asyncio
import logging
import math
import time
from collections import deque
from dataclasses import dataclass, field

import numpy as np
from mesp_protocol import (
    FrameError,
    FrameType,
    decode_ecg,
    decode_imu,
    decode_ppg,
    decode_text,
    get_profile,
    parse_frame,
    parse_text_line,
)
from mesp_protocol.decode import PayloadError

from .. import models
from .dsp import EcgAnalyzer, ImuAnalyzer, PpgAnalyzer
from .events import CRITICAL, INFO, WARNING, EventEngine, EventOut, instant

log = logging.getLogger("mesp.ingest")


def clean(x):
    """JSON-safe: NaN/inf -> None, numpy scalars -> python."""
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [clean(v) for v in x]
    if isinstance(x, np.generic):
        x = x.item()
    if isinstance(x, float) and not math.isfinite(x):
        return None
    return x


# --------------------------------------------------------------------------- time base
@dataclass
class StreamClock:
    """Reconstructs per-sample timestamps. The link carries no device time, so:

    * the first batch is anchored at ``rx_time - n/fs`` (samples were acquired before sending);
    * later batches continue contiguously at the nominal rate;
    * a slow correction (``alpha``) follows the host clock to absorb crystal drift;
    * if the expected and observed start differ by more than ``tolerance`` and the data is
      late, a gap is declared (lost data / disconnect) and the clock re-anchors forward;
      data arriving early by more than ``tolerance`` is counted as skew, never moved backwards.
    """
    fs: float
    tolerance: float = 0.35
    alpha: float = 0.005
    next_t: float | None = None
    gaps: int = 0
    skew_events: int = 0

    def assign(self, n: int, rx_time: float) -> tuple[float, float | None]:
        est = rx_time - n / self.fs
        gap = None
        if self.next_t is None:
            self.next_t = est
        else:
            err = est - self.next_t
            if err > self.tolerance:
                gap = err
                self.gaps += 1
                self.next_t = est
            elif err < -self.tolerance:
                self.skew_events += 1
            else:
                self.next_t += self.alpha * err
        t0 = self.next_t
        self.next_t += n / self.fs
        return t0, gap


class StreamBuffer:
    """Timestamped segments awaiting the 1 s processing slice."""

    def __init__(self, fs: float, channels: int):
        self.fs, self.channels = fs, channels
        self.segs: deque[tuple[float, np.ndarray]] = deque()

    def add(self, t0: float, arr: np.ndarray) -> None:
        if arr.size:
            self.segs.append((t0, arr.reshape(-1, self.channels) if self.channels > 1 else arr))

    @property
    def end_time(self) -> float | None:
        if not self.segs:
            return None
        t0, a = self.segs[-1]
        return t0 + len(a) / self.fs

    def pop_before(self, t_end: float) -> list[tuple[float, np.ndarray]]:
        """Remove and return samples with timestamp < t_end, merged into contiguous runs."""
        out: list[tuple[float, np.ndarray]] = []
        while self.segs:
            t0, a = self.segs[0]
            if t0 >= t_end:
                break
            k = min(len(a), int(math.ceil((t_end - t0) * self.fs - 1e-9)))
            take, rest = a[:k], a[k:]
            self.segs.popleft()
            if len(rest):
                self.segs.appendleft((t0 + k / self.fs, rest))
            if out and abs(out[-1][0] + len(out[-1][1]) / self.fs - t0) < 0.5 / self.fs:
                out[-1] = (out[-1][0], np.concatenate([out[-1][1], take]))
            else:
                out.append((t0, take))
        return out


class Decimator:
    """Block-mean (IMU) or phase-carrying pick (pre-filtered ECG) decimation for live display."""

    def __init__(self, factor: int, mode: str = "pick"):
        self.factor, self.mode = max(1, factor), mode
        self.carry: np.ndarray | None = None
        self.phase = 0

    def __call__(self, x: np.ndarray) -> np.ndarray:
        if self.factor == 1:
            return x
        if self.mode == "pick":
            idx = np.arange(self.phase, len(x), self.factor)
            self.phase = (idx[-1] + self.factor - len(x)) if idx.size else self.phase - len(x)
            return x[idx]
        x = x if self.carry is None else np.concatenate([self.carry, x])
        n = (len(x) // self.factor) * self.factor
        self.carry = x[n:]
        return x[:n].reshape(-1, self.factor, *x.shape[1:]).mean(axis=1)


# --------------------------------------------------------------------------- session
@dataclass
class LinkWindow:
    frames: deque = field(default_factory=lambda: deque(maxlen=10))
    lost: deque = field(default_factory=lambda: deque(maxlen=10))
    crc: deque = field(default_factory=lambda: deque(maxlen=10))

    def push(self, frames: int, lost: int, crc: int) -> None:
        self.frames.append(frames)
        self.lost.append(lost)
        self.crc.append(crc)

    def ratios(self) -> tuple[float | None, float | None]:
        f, lo, c = sum(self.frames), sum(self.lost), sum(self.crc)
        total = f + lo + c
        if total < 50:
            return None, None
        return lo / total, c / total


class IngestSession:
    def __init__(self, ctx, device: models.Device, source: str, synthetic: bool, realtime: bool = True):
        self.ctx = ctx
        self.device_id = device.id
        self.device_name = device.name
        self.profile = get_profile(device.profile_id)
        self.source = source
        self.synthetic = synthetic or device.simulated
        self.realtime = realtime     # False for accelerated simulation / replays: latency not measurable
        p = self.profile
        self.clocks = {"ecg": StreamClock(p.ecg_hz), "ppg": StreamClock(p.ppg_fifo_hz), "imu": StreamClock(p.imu_hz)}
        self.buffers = {"ecg": StreamBuffer(p.ecg_hz, 1), "ppg": StreamBuffer(p.ppg_fifo_hz, 2),
                        "imu": StreamBuffer(p.imu_hz, 7)}
        self.ecg = EcgAnalyzer(p.ecg_hz)
        self.ppg = PpgAnalyzer(p.ppg_fifo_hz)
        self.imu = ImuAnalyzer(p.imu_hz, p.accel_lsb_per_g)
        live = ctx.settings
        self.dec_ecg = Decimator(int(round(p.ecg_hz / live.live_ecg_hz)), "pick")
        self.dec_imu = Decimator(int(round(p.imu_hz / live.live_imu_hz)), "mean")
        self.events = EventEngine()
        self.link_window = LinkWindow()
        self.session_id: str | None = None
        self.stats = {"frames_ok": 0, "crc_errors": 0, "frame_errors": 0, "lost_frames": 0, "duplicates": 0,
                      "bytes": 0, "gateway_crc_errors": 0, "clock_gaps": 0, "clock_skew": 0,
                      "samples": {"ecg": 0, "ppg": 0, "imu": 0}, "latency_ms_p50": None, "latency_ms_p95": None,
                      "device_reported": None}
        self._last_seq: int | None = None
        self._recent: deque[tuple[int, int]] = deque(maxlen=16)
        self._win = {"frames": 0, "lost": 0, "crc": 0}
        self._gw_crc_last = 0
        self.next_boundary: float | None = None
        self.link_state = "connecting"
        self._down_since: float | None = None
        self.battery_soc: float | None = None
        self.skin_temp_c: float | None = None
        self.firmware: str | None = None
        self.latest_vitals: dict | None = None
        self._latency: deque[float] = deque(maxlen=2000)
        self._last_data_wall = time.monotonic()
        self._lock = asyncio.Lock()
        self._flusher: asyncio.Task | None = None
        self.started_at = time.time()

    # ------------------------------------------------------------------ lifecycle
    async def start(self) -> str:
        async with self.ctx.db.session() as s:
            row = models.Session(device_id=self.device_id, source=self.source, synthetic=self.synthetic,
                                 profile_id=self.profile.id, protocol_version=self.profile.protocol_version,
                                 stats={})
            s.add(row)
            dev = await s.get(models.Device, self.device_id)
            if dev:
                dev.last_seen = time.time()
            await s.commit()
            self.session_id = row.id
        self._flusher = asyncio.create_task(self._idle_flush())
        self.ctx.publish(self.device_id, {"type": "session", "state": "started", "session_id": self.session_id,
                                          "synthetic": self.synthetic, "source": self.source,
                                          "profile": self.profile.to_dict()})
        return self.session_id

    async def close(self, reason: str = "gateway disconnected", expected: bool = False) -> None:
        """End the session. ``expected`` (operator stop, shutdown) suppresses the disconnect event."""
        if self._flusher:
            self._flusher.cancel()
        async with self._lock:
            await self._process_until(math.inf)
            if self.link_state not in ("disconnected",):
                if expected:
                    self.link_state = "disconnected"
                    self.ctx.publish(self.device_id, {"type": "link", "state": "disconnected", "reason": reason,
                                                      "at": time.time()})
                else:
                    await self._link_change("disconnected", reason)
            await self._save_stats(ended=True)
        self.ctx.publish(self.device_id, {"type": "session", "state": "ended", "session_id": self.session_id})

    async def _save_stats(self, ended: bool = False) -> None:
        async with self.ctx.db.session() as s:
            row = await s.get(models.Session, self.session_id)
            if row:
                row.stats = clean(dict(self.stats))
                row.firmware = self.firmware
                if ended:
                    row.ended_at = time.time()
            dev = await s.get(models.Device, self.device_id)
            if dev:
                dev.last_seen = time.time()
                if self.firmware:
                    dev.firmware = self.firmware
            await s.commit()

    # ------------------------------------------------------------------ control messages
    async def handle_control(self, msg: dict) -> None:
        kind = msg.get("type")
        if kind == "link":
            await self._link_change(str(msg.get("to")), str(msg.get("reason", "")))
        elif kind == "status":
            df = msg.get("deframer") or {}
            crc = int(df.get("crc_errors", 0))
            delta = max(0, crc - self._gw_crc_last)
            self._gw_crc_last = crc
            self.stats["gateway_crc_errors"] += delta
            self.stats["crc_errors"] += delta
            self._win["crc"] += delta
            self.stats["gateway"] = {k: msg.get(k) for k in ("source", "link_state", "frames_forwarded")} | {"deframer": df}

    async def _link_change(self, state: str, reason: str) -> None:
        prev, self.link_state = self.link_state, state
        if state == prev:
            return
        now = time.time()
        self.ctx.publish(self.device_id, {"type": "link", "state": state, "reason": reason, "at": now})
        if state in ("disconnected", "stale") and prev in ("streaming", "connected"):
            self._down_since = now
            await self._emit([instant("device_disconnected", WARNING, "Device disconnected" if state == "disconnected"
                                      else "Data stream stalled", f"Link {state}: {reason or 'no reason given'}.",
                                      None, t=now)])
        elif state == "streaming" and self._down_since is not None:
            outage = now - self._down_since
            self._down_since = None
            await self._emit([instant("device_reconnected", INFO, "Device reconnected",
                                      f"Data resumed after {outage:.1f} s.", None, t=now, outage_s=round(outage, 1))])

    # ------------------------------------------------------------------ data
    async def handle_batch(self, items: list[tuple[float, bytes]]) -> None:
        recv = time.time()
        async with self._lock:
            live: dict[str, list] = {"ecg": [], "ppg": [], "imu": []}
            for rx_time, raw in items:
                self.stats["bytes"] += len(raw)
                try:
                    f = parse_frame(raw, rx_time=rx_time)
                except FrameError as e:
                    key = "crc_errors" if str(e) == "crc" else "frame_errors"
                    self.stats[key] += 1
                    self._win["crc"] += 1
                    continue
                if not self._sequence_ok(f.seq, f.crc):
                    continue
                self.stats["frames_ok"] += 1
                self._win["frames"] += 1
                if self.realtime:
                    self._latency.append((recv - rx_time) * 1000)
                try:
                    self._route(f, rx_time, live)
                except PayloadError:
                    self.stats["frame_errors"] += 1
            self._last_data_wall = time.monotonic()
            self._publish_live(live)
            # process every complete 1 s slice (a 0.2 s allowance lets slower streams catch up)
            ends = [b.end_time for b in self.buffers.values() if b.end_time is not None]
            if ends:
                await self._process_until(max(ends) - 0.2)

    def _sequence_ok(self, seq: int, crc: int) -> bool:
        if (seq, crc) in self._recent:
            self.stats["duplicates"] += 1
            return False
        if self._last_seq is not None:
            gap = (seq - self._last_seq - 1) & 0xFF
            if gap:
                self.stats["lost_frames"] += gap     # lower bound: whole 256-frame wraps are invisible
                self._win["lost"] += gap
        self._last_seq = seq
        self._recent.append((seq, crc))
        return True

    def _route(self, f, rx_time: float, live: dict) -> None:
        t = f.type
        if t == FrameType.ECG_RAW:
            x = np.asarray(decode_ecg(f.payload), dtype=np.float64)
            self._add("ecg", x, rx_time, live)
        elif t == FrameType.PPG_RAW:
            red, ir = decode_ppg(f.payload)
            self._add("ppg", np.column_stack([red, ir]).astype(np.float64), rx_time, live)
        elif t == FrameType.IMU_RAW:
            self._add("imu", np.asarray(decode_imu(f.payload), dtype=np.float64), rx_time, live)
        elif t in (FrameType.TEXT, FrameType.STATUS):
            self._text(decode_text(f.payload))

    def _add(self, stream: str, arr: np.ndarray, rx_time: float, live: dict) -> None:
        n = len(arr)
        if n == 0:
            return
        t0, gap = self.clocks[stream].assign(n, rx_time)
        self.stats["clock_gaps"] = sum(c.gaps for c in self.clocks.values())
        self.stats["clock_skew"] = sum(c.skew_events for c in self.clocks.values())
        self.stats["samples"][stream] += n
        self.buffers[stream].add(t0, arr)
        live[stream].append((t0, arr, gap))

    def _text(self, text: str) -> None:
        p = parse_text_line(text)
        f = p["fields"]
        if p["kind"] == "boot":
            self.firmware = f"MESP_lab ({text})"
            rate = f.get("ppg")
            if isinstance(rate, (int, float)) and abs(rate - self.profile.ppg_fifo_hz) > 0.5:
                asyncio.get_running_loop().create_task(self._emit([instant(
                    "profile_mismatch", WARNING, "Firmware configuration differs from device profile",
                    f"Device reports PPG {rate} sps but profile '{self.profile.id}' expects "
                    f"{self.profile.ppg_fifo_hz:g} sps. Timestamps and SpO2 will be wrong until the profile is fixed.",
                    "ppg")]))
        elif p["kind"] == "stats":
            self.stats["device_reported"] = f
        elif p["kind"] == "batt" and "soc" in f:
            self.battery_soc = float(f["soc"])
        elif p["kind"] == "temp" and "skin_mc" in f:
            self.skin_temp_c = float(f["skin_mc"]) / 1000.0

    def _publish_live(self, live: dict) -> None:
        p = self.profile
        for t0, arr, gap in live["ecg"]:
            y = self.ecg.display(arr)
            phase = self.dec_ecg.phase
            yd = self.dec_ecg(y)
            self.ctx.publish(self.device_id, {"type": "samples", "stream": "ecg",
                                              "t0": t0 + phase / p.ecg_hz, "fs": p.ecg_hz / self.dec_ecg.factor,
                                              "gap": gap is not None, "values": np.round(yd, 1).tolist()})
        for t0, arr, gap in live["ppg"]:
            pleth = self.ppg.display(arr[:, 1])
            self.ctx.publish(self.device_id, {"type": "samples", "stream": "ppg", "t0": t0, "fs": p.ppg_fifo_hz,
                                              "gap": gap is not None, "red": arr[:, 0].astype(int).tolist(),
                                              "ir": arr[:, 1].astype(int).tolist(),
                                              "pleth": np.round(pleth, 1).tolist()})
        for t0, arr, gap in live["imu"]:
            carry = 0 if self.dec_imu.carry is None else len(self.dec_imu.carry)
            d = self.dec_imu(arr)
            if not len(d):
                continue
            acc = d[:, 0:3] / p.accel_lsb_per_g
            gyr = d[:, 4:7] / p.gyro_lsb_per_dps
            self.ctx.publish(self.device_id, {"type": "samples", "stream": "imu", "t0": t0 - carry / p.imu_hz,
                                              "fs": p.imu_hz / self.dec_imu.factor, "gap": gap is not None,
                                              "accel": np.round(acc, 4).tolist(), "gyro": np.round(gyr, 2).tolist(),
                                              "mag": np.round(np.linalg.norm(acc, axis=1), 4).tolist()})

    # ------------------------------------------------------------------ 1 s slices
    async def _process_until(self, t_limit: float) -> None:
        starts = [b.segs[0][0] for b in self.buffers.values() if b.segs]
        if not starts:
            return
        if self.next_boundary is None:
            self.next_boundary = math.floor(min(starts)) + 1.0
        while self.next_boundary <= t_limit:
            await self._process_slice(self.next_boundary)
            self.next_boundary += 1.0
            starts = [b.segs[0][0] for b in self.buffers.values() if b.segs]
            if not starts:
                break
            # jump over long gaps (disconnects) instead of emitting empty seconds
            first = min(starts)
            if first > self.next_boundary + 1.0:
                self.next_boundary = math.floor(first) + 1.0
        if t_limit == math.inf:
            await self._process_slice(self.next_boundary, final=True)

    async def _process_slice(self, t_end: float, final: bool = False) -> None:
        chunks: list[models.SampleChunk] = []
        got: dict[str, list] = {}
        for name, buf in self.buffers.items():
            runs = buf.pop_before(t_end if not final else math.inf)
            got[name] = runs
            for t0, a in runs:
                a2 = a.reshape(len(a), -1)
                chunks.append(models.SampleChunk(session_id=self.session_id, stream=name, t_start=float(t0),
                                                 sample_rate=buf.fs, n=len(a2), channels=a2.shape[1],
                                                 data=a2.astype("<f4").tobytes()))
        if not chunks and final:
            return
        for t0, a in got["ecg"]:
            self.ecg.push(a, t0 + len(a) / self.profile.ecg_hz)
        for t0, a in got["imu"]:
            self.imu.push(a, t0 + len(a) / self.profile.imu_hz)
        for _t0, a in got["ppg"]:
            self.ppg.push(a[:, 0], a[:, 1])
        have_ecg, have_imu, have_ppg = bool(got["ecg"]), bool(got["imu"]), bool(got["ppg"])
        er = self.ecg.analyze() if have_ecg else None
        ir = self.imu.analyze() if have_imu else None
        pr = self.ppg.analyze(ir.motion_g if ir else None) if have_ppg else None
        self.link_window.push(self._win["frames"], self._win["lost"], self._win["crc"])
        self._win = {"frames": 0, "lost": 0, "crc": 0}
        loss_ratio, crc_ratio = self.link_window.ratios()
        v = clean({
            "t": t_end, "hr_ecg": er.hr if er else None, "rr_ms": er.rr_ms if er else None,
            "rr_irregularity": er.irregularity if er else None, "ecg_quality": er.quality if er else None,
            "hr_ppg": pr.hr if pr else None, "spo2": pr.spo2 if pr else None,
            "ppg_quality": pr.quality if pr else None, "perfusion_index": pr.perfusion_index if pr else None,
            "motion_g": ir.motion_g if ir else None, "activity": ir.activity if ir else None,
            "roll_deg": ir.roll_deg if ir else None, "pitch_deg": ir.pitch_deg if ir else None,
            "imu_temp_c": ir.temp_c if ir else None, "battery_soc": self.battery_soc, "skin_temp_c": self.skin_temp_c,
        })
        flags = {"ecg_lead_off": er.lead_off if er else None, "rhythm_irregular": er.irregular if er else None,
                 "loss_ratio": loss_ratio, "crc_ratio": crc_ratio}
        self.latest_vitals = v | {"ecg_lead_off": flags["ecg_lead_off"]}
        lat = sorted(self._latency)
        if lat:
            self.stats["latency_ms_p50"] = round(lat[len(lat) // 2], 1)
            self.stats["latency_ms_p95"] = round(lat[int(len(lat) * 0.95) - 1 if len(lat) > 1 else 0], 1)
        evs = self.events.step(t_end, v | flags)
        if ir:
            for fall in ir.falls:
                evs.append(EventOut(fall["t"], CRITICAL, "fall_suspected", "Fall suspected",
                                    f"Free fall {fall['freefall_ms']} ms, impact {fall['peak_g']:.1f} g"
                                    f"{' (sensor saturated)' if fall['saturated'] else ''}, then stillness with "
                                    f"{fall['orientation_change_deg']} deg orientation change. Heuristic, unvalidated.",
                                    "imu", clean(fall)))
        async with self.ctx.db.session() as s:
            s.add_all(chunks)
            if any(v[k] is not None for k in ("hr_ecg", "hr_ppg", "spo2", "motion_g", "battery_soc")):
                s.add(models.Vital(session_id=self.session_id, **{k: v[k] for k in v}))
            await s.commit()
        self.ctx.publish(self.device_id, {"type": "vitals", "session_id": self.session_id, "synthetic": self.synthetic,
                                          **self.latest_vitals, "link": {"loss_ratio": loss_ratio, "crc_ratio": crc_ratio},
                                          "stats": clean(self.public_stats())})
        if evs:
            await self._emit(evs)
        if int(t_end) % 5 == 0:
            await self._save_stats()

    async def _emit(self, evs: list[EventOut]) -> None:
        rows = []
        async with self.ctx.db.session() as s:
            for e in evs:
                row = models.Event(device_id=self.device_id, session_id=self.session_id, t=e.t, severity=e.severity,
                                   code=e.code, title=e.title, detail=e.detail, stream=e.stream,
                                   data=clean(e.data), synthetic=self.synthetic)
                s.add(row)
                rows.append(row)
            await s.commit()
        for r in rows:
            log.info("event %s %s %s", r.severity, r.code, r.detail)
            self.ctx.publish(self.device_id, {"type": "event", "event": event_dict(r)})

    async def _idle_flush(self) -> None:
        """If data stops (disconnect), finish the pending slice after 2 s instead of waiting forever."""
        try:
            while True:
                await asyncio.sleep(1.0)
                if time.monotonic() - self._last_data_wall > 2.0:
                    async with self._lock:
                        ends = [b.end_time for b in self.buffers.values() if b.end_time is not None]
                        if ends:
                            await self._process_until(max(ends) + 1.0)
        except asyncio.CancelledError:
            pass

    def public_stats(self) -> dict:
        s = self.stats
        return {k: s.get(k) for k in ("frames_ok", "crc_errors", "lost_frames", "duplicates", "frame_errors",
                                      "bytes", "clock_gaps", "latency_ms_p50", "latency_ms_p95", "samples")}

    def status(self) -> dict:
        return clean({"device_id": self.device_id, "session_id": self.session_id, "link_state": self.link_state,
                      "source": self.source, "synthetic": self.synthetic, "started_at": self.started_at,
                      "profile": self.profile.to_dict(), "firmware": self.firmware, "stats": self.public_stats(),
                      "gateway": self.stats.get("gateway"), "device_reported": self.stats.get("device_reported"),
                      "vitals": self.latest_vitals})


def event_dict(r: models.Event) -> dict:
    return clean({"id": r.id, "device_id": r.device_id, "session_id": r.session_id, "t": r.t, "severity": r.severity,
                  "code": r.code, "title": r.title, "detail": r.detail, "stream": r.stream, "data": r.data or {},
                  "synthetic": r.synthetic, "acknowledged_by": r.acknowledged_by,
                  "acknowledged_at": r.acknowledged_at, "ack_note": r.ack_note})
