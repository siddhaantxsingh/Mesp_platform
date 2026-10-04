"""Event rules. Thresholds are engineering defaults for a demo/prototype, NOT clinical limits.

Wording deliberately avoids diagnosis: "irregular RR-interval pattern detected", "fall
suspected", "low SpO2 estimate".
"""
from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field

INFO, WARNING, CRITICAL = "INFO", "WARNING", "CRITICAL"


@dataclass
class EventOut:
    t: float
    severity: str
    code: str
    title: str
    detail: str
    stream: str | None
    data: dict = field(default_factory=dict)


@dataclass
class SustainedRule:
    code: str
    severity: str
    title: str
    stream: str | None
    predicate: Callable[[dict], bool | None]     # None = cannot evaluate (missing data)
    detail: Callable[[dict], str]
    sustain_s: float = 10.0
    clear_s: float = 15.0
    _since: float | None = None
    _clear_since: float | None = None
    active: bool = False

    def step(self, t: float, v: dict) -> EventOut | None:
        r = self.predicate(v)
        if r is None:
            return None
        if r:
            self._clear_since = None
            if self._since is None:
                self._since = t
            if not self.active and t - self._since >= self.sustain_s:
                self.active = True
                return EventOut(t, self.severity, self.code, self.title, self.detail(v), self.stream, _snap(v))
        else:
            self._since = None
            if self.active:
                if self._clear_since is None:
                    self._clear_since = t
                if t - self._clear_since >= self.clear_s:
                    self.active = False
        return None


def _snap(v: dict) -> dict:
    keys = ("hr_ecg", "hr_ppg", "spo2", "rr_irregularity", "ecg_quality", "ppg_quality", "motion_g",
            "activity", "battery_soc", "loss_ratio", "crc_ratio")
    return {k: (round(v[k], 3) if isinstance(v.get(k), float) else v.get(k)) for k in keys if v.get(k) is not None}


def _hr(v: dict) -> float | None:
    return v.get("hr_ecg") if v.get("hr_ecg") is not None else v.get("hr_ppg")


def default_rules() -> list[SustainedRule]:
    return [
        SustainedRule("hr_high", WARNING, "High heart rate", "ecg",
                      lambda v: None if _hr(v) is None else _hr(v) > 130,
                      lambda v: f"Heart rate {_hr(v):.0f} bpm above 130 bpm for 10 s (activity: {v.get('activity') or 'unknown'})."),
        SustainedRule("hr_very_high", CRITICAL, "Very high heart rate", "ecg",
                      lambda v: None if _hr(v) is None else _hr(v) > 170,
                      lambda v: f"Heart rate {_hr(v):.0f} bpm above 170 bpm for 10 s."),
        SustainedRule("hr_low", WARNING, "Low heart rate", "ecg",
                      lambda v: None if _hr(v) is None else _hr(v) < 45,
                      lambda v: f"Heart rate {_hr(v):.0f} bpm below 45 bpm for 10 s."),
        SustainedRule("spo2_low", WARNING, "Low SpO2 estimate", "ppg",
                      lambda v: None if v.get("spo2") is None else v["spo2"] < 92,
                      lambda v: f"Uncalibrated SpO2 estimate {v['spo2']:.0f} % below 92 % for 10 s."),
        SustainedRule("spo2_very_low", CRITICAL, "Very low SpO2 estimate", "ppg",
                      lambda v: None if v.get("spo2") is None else v["spo2"] < 88,
                      lambda v: f"Uncalibrated SpO2 estimate {v['spo2']:.0f} % below 88 % for 10 s."),
        SustainedRule("ecg_lead_off", WARNING, "ECG electrodes off", "ecg",
                      lambda v: v.get("ecg_lead_off"),
                      lambda v: "ECG front-end output is at the rail: one or more electrodes have lost contact.",
                      sustain_s=2.0, clear_s=5.0),
        SustainedRule("ecg_quality_poor", INFO, "Poor ECG signal quality", "ecg",
                      lambda v: None if v.get("ecg_quality") is None else v["ecg_quality"] == "poor" and not v.get("ecg_lead_off"),
                      lambda v: "ECG is too noisy for reliable R-peak detection; heart rate from ECG is withheld.",
                      sustain_s=8.0),
        SustainedRule("rhythm_irregular", WARNING, "Irregular RR-interval pattern", "ecg",
                      lambda v: v.get("rhythm_irregular"),
                      lambda v: (f"Beat-to-beat interval variability {v.get('rr_irregularity', 0):.2f} (RMSSD/mean RR) "
                                 "over the last 30 beats. This is a signal pattern flag, not a diagnosis."),
                      sustain_s=15.0, clear_s=30.0),
        SustainedRule("battery_low", WARNING, "Battery low", None,
                      lambda v: None if v.get("battery_soc") is None else v["battery_soc"] < 15,
                      lambda v: f"Battery at {v['battery_soc']:.0f} %.", sustain_s=3.0, clear_s=60.0),
        SustainedRule("battery_critical", CRITICAL, "Battery critical", None,
                      lambda v: None if v.get("battery_soc") is None else v["battery_soc"] < 5,
                      lambda v: f"Battery at {v['battery_soc']:.0f} %: device may shut down.", sustain_s=3.0, clear_s=60.0),
        SustainedRule("packet_loss", WARNING, "Packet loss", None,
                      lambda v: None if v.get("loss_ratio") is None else v["loss_ratio"] > 0.02,
                      lambda v: f"{v['loss_ratio'] * 100:.1f} % of link frames lost (sequence gaps) over 10 s.",
                      sustain_s=3.0, clear_s=20.0),
        SustainedRule("crc_errors", WARNING, "Corrupted packets", None,
                      lambda v: None if v.get("crc_ratio") is None else v["crc_ratio"] > 0.01,
                      lambda v: f"{v['crc_ratio'] * 100:.1f} % of link frames failed the CRC over 10 s.",
                      sustain_s=3.0, clear_s=20.0),
    ]


class EventEngine:
    def __init__(self, rules: list[SustainedRule] | None = None):
        self.rules = rules or default_rules()

    def step(self, t: float, values: dict) -> list[EventOut]:
        return [e for r in self.rules if (e := r.step(t, values)) is not None]


def instant(code: str, severity: str, title: str, detail: str, stream: str | None = None,
            t: float | None = None, **data) -> EventOut:
    return EventOut(t if t is not None else time.time(), severity, code, title, detail, stream, data)
