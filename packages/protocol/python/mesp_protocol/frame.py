"""Link framing (firmware link protocol v1).

    offset  field
    0..1    magic 0xAA 0x55
    2       version (1)
    3       type
    4       sequence (uint8, one counter shared by all frame types, wraps 255 -> 0)
    5..6    payload length, little-endian (<= 1008)
    7..n    payload
    n+1..2  CRC-16/CCITT-FALSE over bytes [2 .. n], little-endian

Source: firmware ``Nrf_SendFrame()``. The link carries no device timestamp; time is
reconstructed downstream from nominal sample rates and host receive time.
"""
from __future__ import annotations

import enum
from dataclasses import dataclass, field

from .crc import crc16_ccitt_false

MAGIC = b"\xAA\x55"
HEADER_LEN = 7
TRAILER_LEN = 2
MAX_PAYLOAD = 1008  # firmware limit (nRF UARTE RXD.MAXCNT is 1023)
MAX_FRAME = HEADER_LEN + MAX_PAYLOAD + TRAILER_LEN


class FrameType(enum.IntEnum):
    PPG_RAW = 0x01
    IMU_RAW = 0x02
    STATUS = 0x03
    TEXT = 0x04
    ECG_RAW = 0x05


@dataclass(frozen=True, slots=True)
class Frame:
    version: int
    type: int
    seq: int
    payload: bytes
    crc: int
    rx_time: float | None = None  # host receive time (epoch seconds), set by the transport

    @property
    def type_name(self) -> str:
        try:
            return FrameType(self.type).name
        except ValueError:
            return f"UNKNOWN_0x{self.type:02X}"

    def to_bytes(self) -> bytes:
        return encode_frame(self.type, self.seq, self.payload, self.version)


def encode_frame(ftype: int, seq: int, payload: bytes, version: int = 1) -> bytes:
    if len(payload) > MAX_PAYLOAD:
        raise ValueError(f"payload {len(payload)} B exceeds {MAX_PAYLOAD} B")
    body = bytes((version & 0xFF, ftype & 0xFF, seq & 0xFF, len(payload) & 0xFF, len(payload) >> 8)) + payload
    crc = crc16_ccitt_false(body)
    return MAGIC + body + bytes((crc & 0xFF, crc >> 8))


_KNOWN_TYPES = frozenset(int(t) for t in FrameType)


@dataclass(slots=True)
class DeframerStats:
    bytes_in: int = 0
    frames_ok: int = 0
    crc_errors: int = 0
    length_errors: int = 0
    unsupported_version: int = 0
    bytes_discarded: int = 0  # bytes skipped while hunting for a valid frame

    def as_dict(self) -> dict[str, int]:
        return {k: getattr(self, k) for k in self.__slots__}  # type: ignore[attr-defined]


@dataclass
class Deframer:
    """Incremental byte-stream -> Frame parser with resynchronisation.

    Feed arbitrary chunks (UART reads, BLE notifications of any MTU). On a CRC or length
    failure it skips one byte past the false magic and rescans, so a 0xAA 0x55 pair that
    happens to sit inside a payload can never swallow the following good frames. Headers with
    an unknown version/type byte are treated as false magic unless the whole frame passes CRC
    (then it is counted in ``unsupported_version`` and dropped).
    """

    supported_versions: frozenset[int] = frozenset({1})
    stats: DeframerStats = field(default_factory=DeframerStats)
    _buf: bytearray = field(default_factory=bytearray)

    def feed(self, data: bytes, rx_time: float | None = None) -> list[Frame]:
        self.stats.bytes_in += len(data)
        buf = self._buf
        buf.extend(data)
        out: list[Frame] = []
        while True:
            idx = buf.find(MAGIC)
            if idx < 0:
                keep = 1 if buf[-1:] == b"\xAA" else 0
                self.stats.bytes_discarded += len(buf) - keep
                del buf[: len(buf) - keep]
                break
            if idx:
                self.stats.bytes_discarded += idx
                del buf[:idx]
            if len(buf) < HEADER_LEN:
                break
            length = buf[5] | (buf[6] << 8)
            plausible = buf[2] in self.supported_versions and buf[3] in _KNOWN_TYPES
            if length > MAX_PAYLOAD:
                self._skip(length_error=True)
                continue
            total = HEADER_LEN + length + TRAILER_LEN
            if len(buf) < total:
                # Incomplete. A header that is not even plausible is a false magic: skip it.
                # A plausible one is waited for, unless a complete valid frame already starts
                # later in the buffer (then this "frame" would have to contain it: false magic).
                if not plausible or self._valid_frame_after(1):
                    self._skip()
                    continue
                break
            body = bytes(buf[2: HEADER_LEN + length])
            rx_crc = buf[HEADER_LEN + length] | (buf[HEADER_LEN + length + 1] << 8)
            if crc16_ccitt_false(body) != rx_crc:
                self.stats.crc_errors += 1
                self._skip()
                continue
            del buf[:total]
            if not plausible:
                self.stats.unsupported_version += 1  # CRC-valid frame of a version/type we don't speak
                continue
            self.stats.frames_ok += 1
            out.append(Frame(body[0], body[1], body[2], body[5:], rx_crc, rx_time))
        return out

    def _skip(self, length_error: bool = False) -> None:
        if length_error:
            self.stats.length_errors += 1
        self.stats.bytes_discarded += 1
        del self._buf[:1]

    def _valid_frame_after(self, start: int) -> bool:
        buf = self._buf
        i = buf.find(MAGIC, start)
        while i >= 0:
            if len(buf) - i >= HEADER_LEN:
                length = buf[i + 5] | (buf[i + 6] << 8)
                end = i + HEADER_LEN + length + TRAILER_LEN
                if length <= MAX_PAYLOAD and end <= len(buf):
                    crc = buf[end - 2] | (buf[end - 1] << 8)
                    if crc16_ccitt_false(buf[i + 2: end - 2]) == crc:
                        return True
            i = buf.find(MAGIC, i + 1)
        return False

    @property
    def pending_bytes(self) -> int:
        return len(self._buf)


class FrameError(ValueError):
    pass


def parse_frame(raw: bytes, supported_versions: frozenset[int] = frozenset({1}), rx_time: float | None = None) -> Frame:
    """Strictly parse exactly one complete frame (no resync). Raises FrameError with a reason."""
    if len(raw) < HEADER_LEN + TRAILER_LEN or raw[:2] != MAGIC:
        raise FrameError("bad magic or too short")
    length = raw[5] | (raw[6] << 8)
    if length > MAX_PAYLOAD or len(raw) != HEADER_LEN + length + TRAILER_LEN:
        raise FrameError("length mismatch")
    rx_crc = raw[-2] | (raw[-1] << 8)
    if crc16_ccitt_false(raw[2:-2]) != rx_crc:
        raise FrameError("crc")
    if raw[2] not in supported_versions:
        raise FrameError("unsupported version")
    return Frame(raw[2], raw[3], raw[4], bytes(raw[7:-2]), rx_crc, rx_time)
