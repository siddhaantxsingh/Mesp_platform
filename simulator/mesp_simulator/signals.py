"""Synthetic physiological signal generators (SIMULATED DATA, not physiological models
validated against any dataset). Produced in raw sensor units for the default device profile."""
from __future__ import annotations

import numpy as np

ECG_MID = 2048            # AD8232 output is biased to mid-supply -> mid-scale on a 12-bit ADC
ECG_R_CODES = 620         # R-wave amplitude in ADC codes (about 0.5 V at the ADC)

# PQRST as a sum of Gaussians: (centre as fraction of RR after R, width s, amplitude rel. to R)
_WAVES = ((-0.20, 0.025, 0.12), (-0.035, 0.010, -0.14), (0.0, 0.011, 1.0),
          (0.035, 0.010, -0.22), (0.30, 0.060, 0.30))


class BeatClock:
    """Beat times from a heart-rate trajectory with optional variability / irregularity."""

    def __init__(self, rng: np.random.Generator):
        self.rng = rng
        self.next_beat = 0.35
        self.beats: list[float] = []

    def advance(self, t_end: float, hr_bpm: float, hrv: float = 0.03, irregular: bool = False) -> None:
        while self.next_beat < t_end + 2.0:
            self.beats.append(self.next_beat)
            rr = 60.0 / max(hr_bpm, 20.0)
            if irregular:
                rr *= self.rng.uniform(0.55, 1.45)       # irregularly irregular RR pattern
            else:
                rr *= 1.0 + hrv * self.rng.standard_normal()
            self.next_beat += max(rr, 0.25)
        cutoff = t_end - 4.0
        while len(self.beats) > 2 and self.beats[1] < cutoff:
            self.beats.pop(0)


def ecg(t: np.ndarray, beats: list[float], rr: float, rng: np.random.Generator,
        noise: float = 6.0, mains: float = 4.0, wander: float = 25.0, lead_off: np.ndarray | None = None) -> np.ndarray:
    y = np.zeros_like(t)
    for b in beats:
        if b < t[0] - 1.0 or b > t[-1] + 1.0:
            continue
        for c, s, a in _WAVES:
            y += a * np.exp(-0.5 * ((t - (b + c * rr)) / s) ** 2)
    code = ECG_MID + ECG_R_CODES * y
    code += wander * np.sin(2 * np.pi * 0.25 * t) + mains * np.sin(2 * np.pi * 50.0 * t)
    code += noise * rng.standard_normal(t.size)
    if lead_off is not None and lead_off.any():
        # leads off: AD8232 output drifts to a rail with large noise
        code = np.where(lead_off, 4000 + 60 * rng.standard_normal(t.size), code)
    return np.clip(np.rint(code), 0, 4095).astype(np.int64)


def ppg_pulse(phase: np.ndarray) -> np.ndarray:
    """Normalised pulse shape over one beat (systolic peak + dicrotic wave), 0..1."""
    return (np.exp(-0.5 * ((phase - 0.18) / 0.07) ** 2) + 0.35 * np.exp(-0.5 * ((phase - 0.45) / 0.09) ** 2))


def ppg(t: np.ndarray, beats: list[float], spo2: float, rng: np.random.Generator,
        perfusion: float = 0.012, motion: np.ndarray | None = None, ptt: float = 0.22) -> tuple[np.ndarray, np.ndarray]:
    """Red/IR 18-bit codes. Red AC/DC is set from the target SpO2 with the same
    empirical line the firmware uses (SpO2 = 110 - 25 R), so a decoder using that line
    should recover the target: this tests the pipeline, not clinical accuracy."""
    bt = np.asarray(beats)
    idx = np.searchsorted(bt, t - ptt) - 1
    idx = np.clip(idx, 0, len(bt) - 2)
    start, end = bt[idx], bt[idx + 1]
    phase = np.clip((t - ptt - start) / np.maximum(end - start, 0.25), 0, 1.5)
    shape = ppg_pulse(phase)
    dc_ir, dc_red = 118000.0, 96000.0
    r = (110.0 - spo2) / 25.0
    ac_ir = perfusion * dc_ir
    ac_red = r * perfusion * dc_red
    resp = 1.0 + 0.004 * np.sin(2 * np.pi * 0.22 * t)
    ir = dc_ir * resp - ac_ir * shape          # absorption rises in systole -> signal dips
    red = dc_red * resp - ac_red * shape
    ir += 40 * rng.standard_normal(t.size)
    red += 40 * rng.standard_normal(t.size)
    if motion is not None:
        ir += motion * 0.04 * dc_ir
        red += motion * 0.04 * dc_red
    return (np.clip(np.rint(red), 0, 262143).astype(np.int64), np.clip(np.rint(ir), 0, 262143).astype(np.int64))


def imu(t: np.ndarray, rng: np.random.Generator, activity: float = 0.0, cadence_hz: float = 2.6,
        gravity_axis: np.ndarray | None = None, accel_lsb: float = 8192.0, gyro_lsb: float = 65.5,
        events: list[tuple[float, float, str]] | None = None) -> np.ndarray:
    """Returns int16 records (n, 7): ax, ay, az, temp, gx, gy, gz (raw codes)."""
    n = t.size
    g = np.zeros((n, 3))
    if gravity_axis is None:
        g[:, 2] = 1.0
    else:
        g[:] = gravity_axis
    a = g.copy()
    w = np.zeros((n, 3))
    if activity > 0:
        ph = 2 * np.pi * cadence_hz * t
        a[:, 0] += activity * 0.9 * np.sin(ph)
        a[:, 1] += activity * 0.4 * np.sin(2 * ph + 0.6)
        a[:, 2] += activity * 0.6 * np.abs(np.sin(ph))
        w[:, 0] += activity * 160 * np.cos(ph)
        w[:, 1] += activity * 70 * np.sin(ph + 1.1)
        w[:, 2] += activity * 40 * np.sin(2 * ph)
    for t0, t1, kind in events or []:
        m = (t >= t0) & (t < t1)
        if kind == "freefall":
            a[m] = 0.08 * g[m]
            w[m] += np.array([220.0, -140.0, 90.0])
        elif kind == "impact":
            a[m] = g[m] + np.array([3.2, -2.4, 5.5])     # exceeds +/-4 g: saturates like the real part
            w[m] += np.array([-400.0, 300.0, -250.0])
    a += 0.004 * rng.standard_normal((n, 3))
    w += 0.15 * rng.standard_normal((n, 3))
    out = np.empty((n, 7), dtype=np.int64)
    out[:, 0:3] = np.rint(a * accel_lsb)
    out[:, 3] = int(round((31.0 - 25.0) * 326.8))   # MPU die temperature ~31 degC (not skin temperature)
    out[:, 4:7] = np.rint(w * gyro_lsb)
    return np.clip(out, -32768, 32767)
