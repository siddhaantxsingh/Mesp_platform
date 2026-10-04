"""Simulated device: synthesises signals and frames them exactly as the firmware main loop does.

Firmware batching reproduced (mesp_lab main.c, default config):
  * IMU 1 kHz FIFO polled every 5 ms  -> IMU_RAW frames of ~5 records
  * ECG 1 kHz, DMA half/full = 32 samples -> ECG_RAW frames of 32 samples
  * PPG 25 Hz FIFO, polled every 5 ms -> PPG_RAW frames of 1 sample
  * TEXT "boot: ..." once, then "stats ..." every second
  * one uint8 sequence counter shared by all frames
Link faults (loss, corruption, disconnect) are applied after framing, on the "radio".
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from mesp_protocol import FrameType, encode_ecg, encode_frame, encode_imu, encode_ppg, get_profile

from . import signals
from .scenarios import Scenario, gravity_at

TICK = 0.005
BLOCK = 1.0


@dataclass
class Emission:
    t: float               # scenario time the bytes leave the radio (s)
    data: bytes
    connected: bool = True


@dataclass
class SimulatedDevice:
    scenario: Scenario
    seed: int = 1234
    profile_id: str | None = None
    loop: bool = True
    _t: float = 0.0
    _seq: int = 0
    _booted: bool = False
    stats: dict = field(default_factory=lambda: {"frames": 0, "dropped": 0, "corrupted": 0, "suppressed": 0})

    def __post_init__(self) -> None:
        self.profile = get_profile(self.profile_id)
        self.rng = np.random.default_rng(self.seed)
        self.link_rng = np.random.default_rng(self.seed + 1)
        self.clock = signals.BeatClock(self.rng)
        self._ecg_pending: list[int] = []
        self._ppg_carry = 0.0

    # ------------------------------------------------------------------ framing
    def _frame(self, ftype: int, payload: bytes) -> bytes:
        raw = encode_frame(ftype, self._seq, payload)
        self._seq = (self._seq + 1) & 0xFF
        return raw

    def connected_at(self, t: float) -> bool:
        st = t % self.scenario.duration_s if self.loop else t
        return not any(a <= st < b for a, b in self.scenario.disconnects)

    def _radio(self, t: float, raw: bytes, out: list[Emission]) -> None:
        self.stats["frames"] += 1
        if not self.connected_at(t):
            self.stats["suppressed"] += 1
            return
        if self.scenario.loss_rate and self.link_rng.random() < self.scenario.loss_rate:
            self.stats["dropped"] += 1
            return
        if self.scenario.corrupt_rate and self.link_rng.random() < self.scenario.corrupt_rate:
            b = bytearray(raw)
            pos = int(self.link_rng.integers(2, len(b)))
            b[pos] ^= 1 << int(self.link_rng.integers(0, 8))
            raw = bytes(b)
            self.stats["corrupted"] += 1
        out.append(Emission(t, raw))

    # ------------------------------------------------------------------ signals
    def _block(self, t0: float) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        s, p = self.scenario, self.profile
        st0 = t0 % s.duration_s if self.loop else t0
        mid = st0 + BLOCK / 2
        hr = s.hr(mid)
        self.clock.advance(t0 + BLOCK, hr, irregular=s.irregular)
        n_fast = int(round(BLOCK * p.ecg_hz))
        t_fast = t0 + np.arange(n_fast) / p.ecg_hz
        st_fast = (t_fast % s.duration_s) if self.loop else t_fast
        lead_off = np.zeros(n_fast, dtype=bool)
        for a, b in s.lead_off:
            lead_off |= (st_fast >= a) & (st_fast < b)
        noise = s.ecg_noise * (1 + 2.0 * s.activity(mid))
        ecg = signals.ecg(t_fast, self.clock.beats, 60.0 / hr, self.rng, noise=noise, lead_off=lead_off)

        events = [(t0 - st0 + a, t0 - st0 + b, k) for a, b, k in s.imu_events]
        imu = signals.imu(t_fast, self.rng, activity=s.activity(mid), gravity_axis=gravity_at(s, st_fast),
                          accel_lsb=p.accel_lsb_per_g, gyro_lsb=p.gyro_lsb_per_dps, events=events)

        # PPG samples at the FIFO rate, carrying fractional phase across blocks
        n_ppg_f = BLOCK * p.ppg_fifo_hz + self._ppg_carry
        n_ppg = int(n_ppg_f)
        self._ppg_carry = n_ppg_f - n_ppg
        t_ppg = t0 + (np.arange(n_ppg) + (1 - self._ppg_carry)) / p.ppg_fifo_hz
        motion = s.ppg_motion * s.activity(mid) * np.sin(2 * np.pi * 2.6 * t_ppg) if s.ppg_motion else None
        red, ir = signals.ppg(t_ppg, self.clock.beats, s.spo2(mid), self.rng, motion=motion)
        return ecg, imu, t_ppg, red, ir

    # ------------------------------------------------------------------ public
    def generate(self, seconds: float) -> list[Emission]:
        """Advance the device by ``seconds`` (rounded to whole blocks) and return radio output."""
        out: list[Emission] = []
        s, p = self.scenario, self.profile
        n_blocks = max(1, int(round(seconds / BLOCK)))
        for _ in range(n_blocks):
            if not self.loop and self._t >= s.duration_s:
                break
            t0 = self._t
            if not self._booted:
                self._radio(t0, self._frame(FrameType.TEXT, f"boot: ppg={int(p.ppg_fifo_hz)}sps imu=1kHz".encode()), out)
                self._booted = True
            ecg, imu, t_ppg, red, ir = self._block(t0)
            ticks = int(round(BLOCK / TICK))
            per_tick = int(round(TICK * p.imu_hz))
            ppg_i = 0
            for k in range(ticks):
                tk = t0 + (k + 1) * TICK
                # IMU drain
                rec = imu[k * per_tick:(k + 1) * per_tick]
                self._radio(tk, self._frame(FrameType.IMU_RAW, encode_imu([tuple(int(v) for v in r) for r in rec])), out)
                # ECG DMA half-buffer
                self._ecg_pending.extend(int(v) for v in ecg[k * per_tick:(k + 1) * per_tick])
                while len(self._ecg_pending) >= 32:
                    chunk, self._ecg_pending = self._ecg_pending[:32], self._ecg_pending[32:]
                    self._radio(tk, self._frame(FrameType.ECG_RAW, encode_ecg(chunk)), out)
                # PPG FIFO drain
                j = ppg_i
                while j < len(t_ppg) and t_ppg[j] <= tk:
                    j += 1
                if j > ppg_i:
                    self._radio(tk, self._frame(FrameType.PPG_RAW, encode_ppg([int(v) for v in red[ppg_i:j]],
                                                                               [int(v) for v in ir[ppg_i:j]])), out)
                    ppg_i = j
            tend = t0 + BLOCK
            self._radio(tend, self._frame(FrameType.TEXT, f"stats ppg={len(t_ppg)} imu={int(p.imu_hz)} "
                                                           f"ecg={int(p.ecg_hz)} ovf=0 drop=0".encode()), out)
            if s.battery is not None:
                st = (tend % s.duration_s) if self.loop else tend
                soc = s.battery(st)
                mv = int(3300 + 9.0 * soc)
                self._radio(tend, self._frame(FrameType.STATUS, f"batt soc={soc:.0f} mv={mv}".encode()), out)
            self._t = tend
        return out

    @property
    def time(self) -> float:
        return self._t


def chunk_for_ble(data: bytes, mtu_payload: int = 244) -> list[bytes]:
    """Split a byte stream into Nordic UART Service notification-sized pieces."""
    return [data[i:i + mtu_payload] for i in range(0, len(data), mtu_payload)]
