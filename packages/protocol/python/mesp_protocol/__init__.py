"""MESP wire protocol (firmware link v1).

Everything here is derived from the MESP_lab firmware source (``Core/Src/nrf_link.c``)
and verified against bytes produced by that code (see ``firmware-harness/``).
"""
from .crc import crc16_ccitt_false
from .decode import (
    decode_ecg,
    decode_imu,
    decode_ppg,
    decode_text,
    encode_ecg,
    encode_imu,
    encode_ppg,
    parse_text_line,
)
from .frame import (
    HEADER_LEN,
    MAGIC,
    MAX_PAYLOAD,
    TRAILER_LEN,
    Deframer,
    DeframerStats,
    Frame,
    FrameError,
    FrameType,
    encode_frame,
    parse_frame,
)
from .profile import DEFAULT_PROFILE_ID, PROFILES, DeviceProfile, get_profile

__all__ = [
    "crc16_ccitt_false", "MAGIC", "MAX_PAYLOAD", "HEADER_LEN", "TRAILER_LEN", "Frame", "FrameType",
    "Deframer", "DeframerStats", "encode_frame", "parse_frame", "FrameError", "decode_ppg", "decode_imu", "decode_ecg",
    "decode_text", "parse_text_line", "encode_ppg", "encode_imu", "encode_ecg", "DeviceProfile",
    "PROFILES", "get_profile", "DEFAULT_PROFILE_ID",
]
