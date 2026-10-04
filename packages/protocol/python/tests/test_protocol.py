"""Protocol conformance: every expectation here comes from bytes produced by the firmware's
own nrf_link.c (packages/protocol/vectors/firmware_vectors.json, see firmware-harness/)."""
import json
import os
import random

import pytest
from mesp_protocol import (
    Deframer,
    FrameType,
    crc16_ccitt_false,
    decode_ecg,
    decode_imu,
    decode_ppg,
    decode_text,
    encode_ecg,
    encode_frame,
    encode_imu,
    encode_ppg,
    get_profile,
    parse_text_line,
)
from mesp_protocol.crc import crc16_bitwise
from mesp_protocol.decode import PayloadError

VEC = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "vectors", "firmware_vectors.json")))
V = {v["name"]: bytes.fromhex(v["hex"]) for v in VEC["vectors"]}


def one(raw):
    d = Deframer()
    frames = d.feed(raw)
    assert len(frames) == 1 and d.stats.crc_errors == 0
    return frames[0]


def test_crc_check_value():
    # CRC-16/CCITT-FALSE catalogue check value
    assert crc16_ccitt_false(b"123456789") == 0x29B1
    assert crc16_bitwise(b"123456789") == 0x29B1


@pytest.mark.parametrize("name", list(V))
def test_table_crc_matches_firmware_loop(name):
    raw = V[name]
    assert crc16_ccitt_false(raw[2:-2]) == crc16_bitwise(raw[2:-2]) == raw[-2] | (raw[-1] << 8)


def test_ppg_vector():
    f = one(V["ppg_4"])
    assert (f.version, f.type, f.seq) == (1, FrameType.PPG_RAW, 0)
    red, ir = decode_ppg(f.payload)
    assert red == [0x3FFFF, 123456, 0, 100000]
    assert ir == [1, 234567, 0x2ABCD, 200000]


def test_imu_vector():
    f = one(V["imu_2"])
    assert f.type == FrameType.IMU_RAW and f.seq == 1
    assert decode_imu(f.payload) == [(8192, -8192, 0, -1234, 655, -655, 32767), (-32768, 1, -1, 0, 0, 1, -2)]


def test_ecg_vectors():
    f = one(V["ecg_6"])
    assert f.seq == 2 and decode_ecg(f.payload) == [0, 2048, 4095, 1, 0x0ABC, 3000]
    f = one(V["ecg_max"])
    assert len(f.payload) == 1008
    assert decode_ecg(f.payload) == [(i * 37) & 0xFFF for i in range(504)]


def test_text_vectors():
    f = one(V["text_boot"])
    assert decode_text(f.payload) == "boot: ppg=25sps imu=1kHz"
    p = parse_text_line(decode_text(f.payload))
    assert p["kind"] == "boot" and p["fields"] == {"ppg": 25, "imu": 1000}
    p = parse_text_line(decode_text(one(V["text_stats"]).payload))
    assert p["kind"] == "stats" and p["fields"]["ecg"] == 1000 and p["fields"]["drop"] == 0
    f = one(V["status_empty"])
    assert f.type == FrameType.STATUS and f.payload == b""


def test_sequence_wraps():
    assert one(V["seq_255"]).seq == 255
    assert one(V["seq_wrap_0"]).seq == 0


@pytest.mark.parametrize("name", list(V))
def test_encoder_reproduces_firmware_bytes(name):
    f = one(V[name])
    assert encode_frame(f.type, f.seq, f.payload, f.version) == V[name]


def test_payload_encoders_roundtrip_firmware():
    red, ir = decode_ppg(one(V["ppg_4"]).payload)
    assert encode_ppg(red, ir) == one(V["ppg_4"]).payload
    assert encode_imu(decode_imu(one(V["imu_2"]).payload)) == one(V["imu_2"]).payload
    assert encode_ecg(decode_ecg(one(V["ecg_6"]).payload)) == one(V["ecg_6"]).payload


def test_stream_any_chunking():
    stream = b"".join(V.values())
    rng = random.Random(7)
    for _ in range(50):
        d, got, i = Deframer(), [], 0
        while i < len(stream):
            n = rng.randint(1, 247)  # BLE notification sizes
            got += d.feed(stream[i:i + n])
            i += n
        assert [f.to_bytes() for f in got] == list(V.values())
        assert d.stats.crc_errors == 0 and d.stats.bytes_discarded == 0


def test_resync_after_garbage_and_corruption():
    bad = bytearray(V["ecg_6"]); bad[10] ^= 0xFF
    stream = b"\x00\x13\xAA\x55\x01" + V["ppg_4"] + bytes(bad) + b"\xAA" + V["imu_2"]
    d = Deframer()
    frames = d.feed(stream)
    assert [f.type for f in frames] == [FrameType.PPG_RAW, FrameType.IMU_RAW]
    assert d.stats.crc_errors >= 1


def test_false_magic_inside_payload_does_not_eat_next_frame():
    # payload that contains AA 55 followed by a huge length field
    payload = encode_ecg([0xAA55, 0x01FF, 0xFFFF, 7])
    stream = encode_frame(FrameType.ECG_RAW, 9, payload) + V["imu_2"]
    frames = Deframer().feed(stream[3:])  # start mid-frame: the AA55 inside is seen first
    assert frames[-1].type == FrameType.IMU_RAW


def test_unsupported_version_counted_not_returned():
    raw = encode_frame(FrameType.TEXT, 1, b"hi", version=2)
    d = Deframer()
    assert d.feed(raw) == [] and d.stats.unsupported_version == 1


def test_bad_payload_sizes():
    with pytest.raises(PayloadError):
        decode_imu(b"\x00" * 13)
    with pytest.raises(PayloadError):
        decode_ppg(b"\x00" * 7)
    with pytest.raises(ValueError):
        encode_frame(1, 0, b"\x00" * 1009)


def test_fuzz_never_raises():
    rng = random.Random(1)
    d = Deframer()
    for _ in range(300):
        d.feed(bytes(rng.getrandbits(8) for _ in range(rng.randint(0, 400))))
    assert d.pending_bytes <= 1017


def test_profile_default_matches_firmware_defaults():
    p = get_profile(None)
    assert p.ppg_fifo_hz == 25 and p.imu_hz == 1000 and p.ecg_hz == 1000
    assert p.has_battery is False and p.has_skin_temp is False


def test_plausible_false_header_does_not_stall_stream():
    # AA 55 01 05 xx | len=0x0300 looks like a real ECG header claiming 768 B
    fake = b"\xAA\x55\x01\x05\x00\x00\x03"
    d = Deframer()
    frames = d.feed(fake + V["ppg_4"] + V["imu_2"])
    assert [f.type for f in frames] == [FrameType.PPG_RAW, FrameType.IMU_RAW]


def test_waits_for_genuinely_incomplete_frame():
    d = Deframer()
    raw = V["ecg_max"]
    assert d.feed(raw[:500]) == []
    assert len(d.feed(raw[500:])) == 1


def test_parse_frame_strict():
    from mesp_protocol import FrameError, parse_frame
    f = parse_frame(V["ppg_4"])
    assert f.seq == 0 and len(f.payload) == 24
    bad = bytearray(V["ppg_4"]); bad[8] ^= 4
    for b in (bytes(bad), V["ppg_4"][:-1], b"\x00" + V["ppg_4"][1:]):
        with pytest.raises(FrameError):
            parse_frame(b)
