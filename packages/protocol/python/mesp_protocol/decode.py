"""Payload decoders/encoders, transcribed from ``Nrf_SendPPG/IMU/ECG`` in the firmware."""
from __future__ import annotations

import re
import struct

PPG_RECORD = 6
IMU_RECORD = 14
ECG_RECORD = 2


class PayloadError(ValueError):
    pass


def _check(payload: bytes, rec: int, kind: str) -> int:
    if len(payload) % rec:
        raise PayloadError(f"{kind} payload {len(payload)} B is not a multiple of {rec}")
    return len(payload) // rec


def decode_ppg(payload: bytes) -> tuple[list[int], list[int]]:
    """n x 6 B -> (red[], ir[]); 18-bit codes, big-endian triplets (top byte masked to 2 bits)."""
    n = _check(payload, PPG_RECORD, "PPG")
    red, ir = [], []
    for i in range(n):
        o = i * 6
        red.append(((payload[o] & 0x03) << 16) | (payload[o + 1] << 8) | payload[o + 2])
        ir.append(((payload[o + 3] & 0x03) << 16) | (payload[o + 4] << 8) | payload[o + 5])
    return red, ir


def decode_imu(payload: bytes) -> list[tuple[int, int, int, int, int, int, int]]:
    """n x 14 B -> [(ax, ay, az, temp, gx, gy, gz)] signed 16-bit big-endian raw codes."""
    n = _check(payload, IMU_RECORD, "IMU")
    return list(struct.iter_unpack(">7h", payload[: n * IMU_RECORD]))


def decode_ecg(payload: bytes) -> list[int]:
    """n x 2 B -> raw 12-bit ADC codes, big-endian."""
    n = _check(payload, ECG_RECORD, "ECG")
    return list(struct.unpack(f">{n}H", payload))


def decode_text(payload: bytes) -> str:
    return payload.decode("ascii", errors="replace").rstrip("\r\n\x00")


_KV = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)=([^\s]+)")


def parse_text_line(text: str) -> dict:
    """Parse TEXT/STATUS lines into ``{"kind": ..., "fields": {...}}``.

    Lines emitted by the current firmware (main.c):
      ``boot: ppg=25sps imu=1kHz``
      ``stats ppg=25 imu=1000 ecg=1000 ovf=0 drop=0``
    Proposed status keys (documented in docs/protocol, NOT emitted by current firmware):
      ``batt soc=82 mv=3912``          (MAX17048 fuel gauge — driver not implemented)
      ``temp skin_mc=36540``           (MAX30205 — driver not implemented)
    Anything else is kept as free text.
    """
    text = text.strip()
    head = text.split(" ", 1)[0].rstrip(":") if text else ""
    fields: dict[str, int | float | str] = {}
    for k, v in _KV.findall(text):
        m = re.fullmatch(r"(-?\d+(?:\.\d+)?)([A-Za-z%]*)", v)
        if m:
            num = float(m.group(1)) if "." in m.group(1) else int(m.group(1))
            unit = m.group(2).lower()
            if unit == "khz":
                num = num * 1000
            fields[k] = num
        else:
            fields[k] = v
    kind = head if head in {"boot", "stats", "batt", "temp"} else "text"
    return {"kind": kind, "fields": fields, "text": text}


# ----------------------------------------------------------------------------- EVENT frames

EVENT_FALL = 0x01
EVENT_STROKE_RISK = 0x02
EVENT_KINDS = {EVENT_FALL: "fall", EVENT_STROKE_RISK: "stroke_risk"}

_NUM = r"(-?\d+(?:\.\d+)?)"
_FALL_FIELDS = {
    "t_ms": rf"\bt={_NUM} ms", "impact_g": rf"\bimpact={_NUM} g", "freefall_ms": rf"\bfreefall={_NUM} ms",
    "still_ms": rf"\bstill={_NUM} ms", "orientation_change_deg": rf"\bdOri={_NUM} deg", "confidence_pct": rf"\bconf={_NUM}%",
}
_STROKE_FIELDS = {
    "t_ms": rf"\bt={_NUM} ms", "score": rf"\bscore {_NUM}", "rr_count": rf"\b{_NUM} RR\b", "mean_rr_ms": rf"\bmean {_NUM} ms",
    "rmssd_ms": rf"\bRMSSD {_NUM} ms", "pnn50_pct": rf"\bpNN50 {_NUM}%", "rr_entropy": rf"\bH {_NUM}",
    "turning_point_ratio": rf"\bTPR {_NUM}",
}


def _num(v: str) -> int | float:
    return float(v) if "." in v else int(v)


def decode_event(payload: bytes) -> dict:
    """EVENT payload, transcribed from ``Nrf_SendEvent`` in Core/Src/nrf_link.c:
    ``[kind u8][score u8][ASCII detail...]``. kind 1 = fall (score = confidence %),
    kind 2 = stroke-risk / AFib-pattern screening (score 0-100). The detail is the
    same line the firmware prints on its console; its numbers are parsed into
    ``fields`` when the text matches the format in main.c (unknown text is kept)."""
    if len(payload) < 2:
        raise PayloadError(f"EVENT payload {len(payload)} B is shorter than 2 B")
    code, score = payload[0], payload[1]
    text = payload[2:].decode("ascii", errors="replace").rstrip("\r\n\x00")
    kind = EVENT_KINDS.get(code, f"unknown_0x{code:02x}")
    pats = _FALL_FIELDS if code == EVENT_FALL else _STROKE_FIELDS if code == EVENT_STROKE_RISK else {}
    fields: dict[str, int | float] = {}
    for name, pat in pats.items():
        m = re.search(pat, text)
        if m:
            fields[name] = _num(m.group(1))
    return {"code": code, "kind": kind, "score": score, "text": text, "fields": fields}


def encode_event(code: int, score: int, text: str = "") -> bytes:
    return bytes((code & 0xFF, score & 0xFF)) + text.encode("ascii", errors="replace")


def encode_ppg(red: list[int], ir: list[int]) -> bytes:
    out = bytearray()
    for r, i in zip(red, ir, strict=True):
        out += bytes(((r >> 16) & 0x03, (r >> 8) & 0xFF, r & 0xFF, (i >> 16) & 0x03, (i >> 8) & 0xFF, i & 0xFF))
    return bytes(out)


def encode_imu(records: list[tuple[int, ...]]) -> bytes:
    return b"".join(struct.pack(">7h", *r) for r in records)


def encode_ecg(samples: list[int]) -> bytes:
    return struct.pack(f">{len(samples)}H", *samples)
