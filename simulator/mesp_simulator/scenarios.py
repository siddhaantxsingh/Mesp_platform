"""The ten deterministic demo scenarios. All output is SIMULATED DATA."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np

Fn = Callable[[float], float]


@dataclass(frozen=True)
class Scenario:
    id: str
    title: str
    description: str
    duration_s: float
    hr: Fn = lambda t: 72.0
    spo2: Fn = lambda t: 98.0
    activity: Fn = lambda t: 0.0
    irregular: bool = False
    lead_off: tuple[tuple[float, float], ...] = ()
    ecg_noise: float = 6.0
    ppg_motion: float = 0.0
    imu_events: tuple[tuple[float, float, str], ...] = ()
    posture_after: tuple[float, tuple[float, float, float]] | None = None   # (t, gravity vector)
    disconnects: tuple[tuple[float, float], ...] = ()
    corrupt_rate: float = 0.0
    loss_rate: float = 0.0
    battery: Fn | None = None          # proposed STATUS extension; None = not emitted (like real firmware)
    expected_events: tuple[str, ...] = field(default_factory=tuple)


def _ramp(t0: float, t1: float, a: float, b: float) -> Fn:
    return lambda t: a if t <= t0 else b if t >= t1 else a + (b - a) * (t - t0) / (t1 - t0)


SCENARIOS: dict[str, Scenario] = {s.id: s for s in [
    Scenario("normal", "Normal resting", "Seated, still. Sinus rhythm ~72 bpm, SpO2 ~98 %, clean contact.", 120),
    Scenario("exercise", "Exercise", "Brisk walk to jog. HR ramps 78 -> 142 bpm, rhythmic wrist motion with PPG motion artefact.",
             150, hr=_ramp(10, 110, 78, 142), activity=_ramp(5, 40, 0.0, 0.9), ppg_motion=0.6, ecg_noise=14,
             expected_events=("hr_high",)),
    Scenario("poor_ecg", "Poor ECG contact", "Electrode contact degrades: rising noise, then two lead-off intervals.",
             120, ecg_noise=40, lead_off=((35, 47), (80, 95)), expected_events=("ecg_lead_off", "ecg_quality_poor")),
    Scenario("poor_spo2", "Low SpO2", "Gradual desaturation from 97 % to 86 % and partial recovery.",
             150, spo2=lambda t: 97 - 11 * min(max((t - 20) / 50, 0), 1) + 5 * min(max((t - 110) / 30, 0), 1),
             hr=_ramp(20, 70, 74, 96), expected_events=("spo2_low",)),
    Scenario("fall", "Fall", "Walking, free-fall ~0.35 s, high-g impact (saturates the +/-4 g range), then lying still.",
             90, activity=lambda t: 0.6 if t < 40 else 0.0, imu_events=((40.0, 40.35, "freefall"), (40.35, 40.45, "impact")),
             posture_after=(40.45, (0.97, 0.05, 0.2)), hr=lambda t: 88 if t < 40 else 104, expected_events=("fall_suspected",)),
    Scenario("irregular", "Irregular rhythm", "Irregularly irregular RR intervals (synthetic pattern resembling AF).",
             120, hr=lambda t: 96, irregular=True, expected_events=("rhythm_irregular",)),
    Scenario("ble_disconnect", "BLE disconnect", "Link drops for 12 s and recovers; firmware keeps counting, so the sequence jumps.",
             90, disconnects=((30, 42),), expected_events=("device_disconnected", "device_reconnected", "packet_loss")),
    Scenario("low_battery", "Low battery", "Battery state of charge falls 18 % -> 4 %. Uses the PROPOSED 'batt' status line "
             "(the current firmware has no MAX17048 driver).", 120, battery=_ramp(0, 120, 18, 4),
             expected_events=("battery_low", "battery_critical")),
    Scenario("corruption", "Packet corruption", "3 % of frames get a flipped bit on the link; the CRC must reject them.",
             90, corrupt_rate=0.03, expected_events=("crc_errors",)),
    Scenario("packet_loss", "Packet loss", "6 % of frames are lost; detected from the 8-bit sequence counter.",
             90, loss_rate=0.06, expected_events=("packet_loss",)),
]}


def get_scenario(sid: str) -> Scenario:
    try:
        return SCENARIOS[sid]
    except KeyError:
        raise KeyError(f"unknown scenario {sid!r}; choose from {', '.join(SCENARIOS)}") from None


def gravity_at(s: Scenario, t: np.ndarray) -> np.ndarray | None:
    if s.posture_after is None:
        return None
    t0, g = s.posture_after
    out = np.zeros((t.size, 3))
    out[:, 2] = 1.0
    out[t >= t0] = g
    return out
