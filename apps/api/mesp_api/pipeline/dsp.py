"""Signal processing for derived values. Engineering estimates, not validated measurements.

Every threshold here was tuned on the platform's own SIMULATED DATA and is NOT validated on
real recordings or against a reference device. Values are reported with a quality grade and
are withheld (None) when the signal does not support them.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

import numpy as np
from scipy import signal as sps

ECG_LEAD_OFF_HI, ECG_LEAD_OFF_LO = 3900, 100


@dataclass
class EcgResult:
    lead_off: bool
    quality: str | None          # good | fair | poor | None
    hr: float | None
    rr_ms: float | None
    irregularity: float | None   # normalised successive-RR variability (0 = perfectly regular)
    irregular: bool
    peaks: list[float]


class EcgAnalyzer:
    """Pan-Tompkins-style R-peak detection on a sliding window, de-duplicated across windows."""

    def __init__(self, fs: float, window_s: float = 10.0, mains_hz: float = 50.0):
        self.fs = fs
        self.buf: deque[float] = deque(maxlen=int(window_s * fs))
        self.t_end = 0.0
        self.sos_bp = sps.butter(3, [5.0, 18.0], btype="band", fs=fs, output="sos")     # QRS energy band
        self.sos_disp = sps.butter(2, [0.5, 40.0], btype="band", fs=fs, output="sos")   # display band
        b, a = sps.iirnotch(mains_hz, 10.0, fs)
        self.sos_notch = sps.tf2sos(b, a)
        self._zi_disp = None
        self._zi_notch = None
        self.peaks: deque[float] = deque(maxlen=80)

    def display(self, x: np.ndarray) -> np.ndarray:
        """Causal 0.5-40 Hz + mains notch, state carried between calls (for live streaming)."""
        x = np.asarray(x, float) - 2048.0
        if self._zi_disp is None:
            self._zi_disp = sps.sosfilt_zi(self.sos_disp) * x[0]
            self._zi_notch = sps.sosfilt_zi(self.sos_notch) * 0.0
        y, self._zi_disp = sps.sosfilt(self.sos_disp, x, zi=self._zi_disp)
        y, self._zi_notch = sps.sosfilt(self.sos_notch, y, zi=self._zi_notch)
        return y

    def push(self, x: np.ndarray, t_end: float) -> None:
        self.buf.extend(np.asarray(x, float))
        self.t_end = t_end

    def analyze(self) -> EcgResult:
        x = np.asarray(self.buf)
        n_last = int(self.fs)
        last = x[-n_last:] if x.size else x
        lead_off = bool(last.size and np.mean((last > ECG_LEAD_OFF_HI) | (last < ECG_LEAD_OFF_LO)) > 0.2)
        if x.size < 3 * self.fs or lead_off:
            return EcgResult(lead_off, "poor" if lead_off else None, None, None, None, False, [])
        # only analyse samples from after the most recent lead-off stretch
        bad = np.where((x > ECG_LEAD_OFF_HI) | (x < ECG_LEAD_OFF_LO))[0]
        if bad.size:
            x = x[bad[-1] + int(0.5 * self.fs):]
            if x.size < 3 * self.fs:
                return EcgResult(False, "poor", None, None, None, False, [])
        t0 = self.t_end - x.size / self.fs
        y = sps.sosfiltfilt(self.sos_bp, x)
        e = np.convolve(np.gradient(y) ** 2, np.ones(int(0.12 * self.fs)) / (0.12 * self.fs), mode="same")
        thr = 0.30 * np.percentile(e, 99)
        cand, _ = sps.find_peaks(e, height=thr, distance=int(0.25 * self.fs))
        # refine each candidate to the band-passed R maximum (+/- 60 ms)
        w = int(0.06 * self.fs)
        times = []
        for c in cand:
            lo, hi = max(0, c - w), min(y.size, c + w)
            k = lo + int(np.argmax(np.abs(y[lo:hi])))
            times.append(t0 + k / self.fs)
        for tp in times:
            if not self.peaks or tp - self.peaks[-1] > 0.25:
                if self.peaks and tp < self.peaks[-1]:
                    continue
                self.peaks.append(tp)
            elif abs(tp - self.peaks[-1]) <= 0.25:
                pass  # same beat seen again in the overlapping window
        recent = np.array([p for p in self.peaks if p > self.t_end - 8.0])
        hr = rr = irr = None
        irregular = False
        quality = self._quality(x, y, recent)
        if recent.size >= 4 and quality != "poor":
            rrs = np.diff(recent)
            rrs = rrs[(rrs > 0.27) & (rrs < 2.0)]
            if rrs.size >= 3:
                rr = float(np.median(rrs) * 1000)
                hr = 60000.0 / rr
        allp = np.array(self.peaks)
        if allp.size >= 16 and quality != "poor":
            rr_all = np.diff(allp[-31:])
            rr_all = rr_all[(rr_all > 0.27) & (rr_all < 2.0)]
            if rr_all.size >= 15:
                irr = float(np.sqrt(np.mean(np.diff(rr_all) ** 2)) / np.mean(rr_all))   # RMSSD / mean RR
                frac_big = float(np.mean(np.abs(np.diff(rr_all)) / rr_all[:-1] > 0.15))
                irregular = irr > 0.12 and frac_big > 0.35
        return EcgResult(False, quality, hr, rr, irr, irregular, times)

    def _quality(self, x: np.ndarray, y: np.ndarray, recent: np.ndarray) -> str:
        disp = sps.sosfiltfilt(self.sos_disp, x - x.mean())
        hf = sps.sosfiltfilt(sps.butter(2, 45.0, btype="high", fs=self.fs, output="sos"), x - x.mean())
        snr = np.std(disp) / max(np.std(hf), 1e-9)
        if recent.size < 3:
            return "poor"
        if snr > 4.0:
            return "good"
        return "fair" if snr > 1.6 else "poor"


@dataclass
class PpgResult:
    hr: float | None
    spo2: float | None
    perfusion_index: float | None
    quality: str | None


class PpgAnalyzer:
    """HR from IR pulse peaks; SpO2 from the ratio of ratios.

    SpO2 uses the firmware's placeholder line SpO2 = 110 - 25 R (filters.c). It is an
    UNCALIBRATED estimate: a device-specific calibration against a reference oximeter is
    required before the number means anything clinically.
    """

    def __init__(self, fs: float, window_s: float = 8.0):
        self.fs = fs
        self.red: deque[float] = deque(maxlen=int(window_s * fs))
        self.ir: deque[float] = deque(maxlen=int(window_s * fs))
        lo, hi = 0.5, min(5.0, fs * 0.45)
        self.sos = sps.butter(3, [lo, hi], btype="band", fs=fs, output="sos")
        self._zi = None

    def push(self, red: np.ndarray, ir: np.ndarray) -> None:
        self.red.extend(np.asarray(red, float))
        self.ir.extend(np.asarray(ir, float))

    def display(self, ir: np.ndarray) -> np.ndarray:
        x = -np.asarray(ir, float)    # invert so systole points up, like a pleth trace
        if x.size == 0:
            return x
        if self._zi is None:
            self._zi = sps.sosfilt_zi(self.sos) * x[0]
        y, self._zi = sps.sosfilt(self.sos, x, zi=self._zi)
        return y

    def analyze(self, motion_g: float | None) -> PpgResult:
        ir, red = np.asarray(self.ir), np.asarray(self.red)
        if ir.size < 4 * self.fs:
            return PpgResult(None, None, None, None)
        dc_ir, dc_red = ir.mean(), red.mean()
        if dc_ir < 5000:   # no finger/wrist contact: photodiode sees almost nothing
            return PpgResult(None, None, None, "poor")
        pad = min(int(self.fs), ir.size // 4)
        ac_ir = sps.sosfiltfilt(self.sos, ir)[pad:-pad]
        ac_red = sps.sosfiltfilt(self.sos, red)[pad:-pad]
        pi = float(np.ptp(ac_ir) / dc_ir * 100)
        z = -ac_ir
        peaks, _ = sps.find_peaks(z, distance=max(1, int(0.33 * self.fs)), prominence=0.3 * np.std(z))
        hr = None
        quality = "poor"
        if peaks.size >= 3:
            ibi = np.diff(peaks) / self.fs
            ibi = ibi[(ibi > 0.3) & (ibi < 2.0)]
            if ibi.size >= 2:
                cv = float(np.std(ibi) / np.mean(ibi))
                hr = 60.0 / float(np.median(ibi))
                quality = "good" if cv < 0.08 else "fair" if cv < 0.2 else "poor"
        moving = motion_g is not None and motion_g > 0.08
        if moving and quality == "good":
            quality = "fair"
        if motion_g is not None and motion_g > 0.15:
            # Vigorous motion: the wrist PPG locks onto the arm-swing cadence instead of the
            # pulse. No motion-artefact cancellation is implemented, so withhold the value.
            quality = "poor"
        spo2 = None
        if quality in ("good", "fair") and not moving and pi > 0.1:
            r = (np.std(ac_red) / dc_red) / (np.std(ac_ir) / dc_ir)
            spo2 = float(np.clip(110.0 - 25.0 * r, 0, 100))
        if quality == "poor":
            hr = None
        return PpgResult(hr, spo2, pi, quality)


@dataclass
class ImuResult:
    motion_g: float
    activity: str
    roll_deg: float
    pitch_deg: float
    temp_c: float
    falls: list[dict] = field(default_factory=list)


class ImuAnalyzer:
    """Activity level, orientation and a heuristic fall detector.

    Fall heuristic (NOT validated; sensitivity/specificity: Not yet measured):
    free fall |a| < 0.4 g for >= 120 ms, then within 1 s an impact |a| >= 2.5 g (or ADC
    saturation), then 1.5-3.5 s after impact low motion (std |a| < 0.1 g) and an orientation
    change of > 40 deg versus before the fall.
    """

    def __init__(self, fs: float, accel_lsb: float, window_s: float = 8.0):
        self.fs, self.lsb = fs, accel_lsb
        self.buf: deque[tuple] = deque(maxlen=int(window_s * fs))
        self.t_end = 0.0
        self.last_fall_t = -1e9

    def push(self, records: np.ndarray, t_end: float) -> None:
        self.buf.extend(map(tuple, records))
        self.t_end = t_end

    def analyze(self) -> ImuResult | None:
        if len(self.buf) < self.fs:
            return None
        r = np.asarray(self.buf, float)
        a = r[:, 0:3] / self.lsb
        mag = np.linalg.norm(a, axis=1)
        last = a[-int(self.fs):]
        lm = mag[-int(self.fs):]
        motion = float(np.std(lm))
        activity = "still" if motion < 0.03 else "light" if motion < 0.15 else "active"
        g = last.mean(axis=0)
        roll = float(np.degrees(np.arctan2(g[1], g[2])))
        pitch = float(np.degrees(np.arctan2(-g[0], np.hypot(g[1], g[2]))))
        temp = float(np.mean(r[-int(self.fs):, 3]) / 326.8 + 25.0)
        return ImuResult(motion, activity, roll, pitch, temp, self._falls(a, mag))

    def _falls(self, a: np.ndarray, mag: np.ndarray) -> list[dict]:
        fs = self.fs
        t0 = self.t_end - mag.size / fs
        sat = np.any(np.abs(a * self.lsb) >= 32767, axis=1)
        low = mag < 0.4
        out = []
        edges = np.diff(np.concatenate(([0], low.astype(int), [0])))
        starts, ends = np.where(edges == 1)[0], np.where(edges == -1)[0]
        for s, e in zip(starts, ends):
            if (e - s) / fs < 0.12:
                continue
            win = slice(e, min(mag.size, e + int(fs)))
            if win.start >= mag.size:
                continue
            hit = np.where((mag[win] >= 2.5) | sat[win])[0]
            if hit.size == 0:
                continue
            k = e + int(hit[0])
            t_imp = t0 + k / fs
            if t_imp - self.last_fall_t < 10:
                continue
            post = slice(k + int(1.5 * fs), k + int(3.5 * fs))
            if post.stop > mag.size:
                continue      # not enough data yet: re-examined on the next update
            pre = slice(max(0, s - int(1.0 * fs)), s)
            if pre.stop - pre.start < fs * 0.3:
                continue
            still = float(np.std(mag[post])) < 0.1
            g_pre, g_post = a[pre].mean(axis=0), a[post].mean(axis=0)
            cosang = np.dot(g_pre, g_post) / (np.linalg.norm(g_pre) * np.linalg.norm(g_post) + 1e-9)
            angle = float(np.degrees(np.arccos(np.clip(cosang, -1, 1))))
            if still and angle > 40:
                self.last_fall_t = t_imp
                out.append({"t": t_imp, "peak_g": float(mag[win].max()), "saturated": bool(sat[win].any()),
                            "freefall_ms": round((e - s) / fs * 1000), "orientation_change_deg": round(angle)})
        return out
