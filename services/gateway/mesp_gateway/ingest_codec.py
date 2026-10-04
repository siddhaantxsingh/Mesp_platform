"""Gateway -> API ingest message format (ingest protocol v1).

Binary WebSocket message:
    uint8  version (=1)
    uint16 count                         (little-endian)
    count x { float64 rx_time (epoch s) | uint16 n | n bytes: one complete link frame incl. magic+CRC }

The gateway forwards link frames *unmodified*; the API re-checks the CRC and does all
decoding, so the server never trusts the gateway's parsing. Text messages are JSON control /
status objects ({"type": "hello" | "status" | "link", ...}).
"""
from __future__ import annotations

import struct

INGEST_VERSION = 1
_HDR = struct.Struct("<BH")
_ITEM = struct.Struct("<dH")
MAX_BATCH = 4096


class IngestDecodeError(ValueError):
    pass


def encode_batch(items: list[tuple[float, bytes]]) -> bytes:
    if len(items) > MAX_BATCH:
        raise ValueError("batch too large")
    parts = [_HDR.pack(INGEST_VERSION, len(items))]
    for t, raw in items:
        parts.append(_ITEM.pack(t, len(raw)))
        parts.append(raw)
    return b"".join(parts)


def decode_batch(msg: bytes) -> list[tuple[float, bytes]]:
    if len(msg) < _HDR.size:
        raise IngestDecodeError("short message")
    ver, count = _HDR.unpack_from(msg, 0)
    if ver != INGEST_VERSION:
        raise IngestDecodeError(f"unsupported ingest version {ver}")
    if count > MAX_BATCH:
        raise IngestDecodeError("batch too large")
    pos, out = _HDR.size, []
    for _ in range(count):
        if pos + _ITEM.size > len(msg):
            raise IngestDecodeError("truncated item header")
        t, n = _ITEM.unpack_from(msg, pos)
        pos += _ITEM.size
        if pos + n > len(msg) or n > 1017:
            raise IngestDecodeError("bad item length")
        out.append((t, msg[pos:pos + n]))
        pos += n
    if pos != len(msg):
        raise IngestDecodeError("trailing bytes")
    return out
