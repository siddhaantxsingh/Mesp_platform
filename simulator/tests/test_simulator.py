import hashlib
from collections import Counter

import numpy as np
import pytest
from mesp_protocol import Deframer, FrameType, decode_ecg, decode_imu, decode_ppg, decode_text
from mesp_simulator import SCENARIOS, SimulatedDevice, get_scenario


def run(sid, seconds, seed=1234):
    dev = SimulatedDevice(get_scenario(sid), seed=seed, loop=False)
    em = dev.generate(seconds)
    d = Deframer()
    frames = []
    for e in em:
        frames += d.feed(e.data)
    return dev, em, frames, d.stats


def digest(em):
    return hashlib.sha256(b"".join(e.data for e in em)).hexdigest()


def test_ten_scenarios():
    assert len(SCENARIOS) == 10


@pytest.mark.parametrize("sid", list(SCENARIOS))
def test_every_scenario_produces_valid_stream(sid):
    dev, em, frames, st = run(sid, 5)
    assert frames and st.length_errors == 0
    kinds = Counter(f.type for f in frames)
    assert kinds[FrameType.IMU_RAW] > 0 and kinds[FrameType.ECG_RAW] > 0 and kinds[FrameType.PPG_RAW] > 0


def test_deterministic():
    assert digest(run("normal", 3)[1]) == digest(run("normal", 3)[1])
    assert digest(run("normal", 3)[1]) != digest(run("normal", 3, seed=99)[1])


def test_firmware_batching_and_rates():
    dev, em, frames, st = run("normal", 10)
    c = Counter(f.type for f in frames)
    assert c[FrameType.IMU_RAW] == 2000                      # 5 ms drains
    assert sum(len(decode_imu(f.payload)) for f in frames if f.type == FrameType.IMU_RAW) == 10000
    assert sum(len(decode_ecg(f.payload)) for f in frames if f.type == FrameType.ECG_RAW) in range(9984, 10001)
    assert sum(len(decode_ppg(f.payload)[0]) for f in frames if f.type == FrameType.PPG_RAW) == 250
    seqs = [f.seq for f in frames]
    assert all((b - a) & 0xFF == 1 for a, b in zip(seqs, seqs[1:]))  # contiguous, wraps
    texts = [decode_text(f.payload) for f in frames if f.type == FrameType.TEXT]
    assert texts[0] == "boot: ppg=25sps imu=1kHz" and texts[1].startswith("stats ppg=25 imu=1000 ecg=1000")


def test_battery_only_in_low_battery_scenario():
    _, _, frames, _ = run("normal", 3)
    assert not [f for f in frames if f.type == FrameType.STATUS]
    _, _, frames, _ = run("low_battery", 3)
    st = [decode_text(f.payload) for f in frames if f.type == FrameType.STATUS]
    assert st and st[0].startswith("batt soc=")


def test_corruption_is_caught_by_crc():
    dev, em, frames, st = run("corruption", 20)
    assert dev.stats["corrupted"] > 50
    # every corrupted frame is rejected (CRC) or lost; none decodes as good
    assert st.crc_errors + st.length_errors >= dev.stats["corrupted"] * 0.9
    assert len(frames) <= dev.stats["frames"] - dev.stats["corrupted"]


def test_packet_loss_visible_in_sequence():
    dev, em, frames, st = run("packet_loss", 20)
    gaps = sum(((b.seq - a.seq) & 0xFF) - 1 for a, b in zip(frames, frames[1:]))
    assert gaps == dev.stats["dropped"]
    assert 0.04 < dev.stats["dropped"] / dev.stats["frames"] < 0.08


def test_disconnect_suppresses_radio():
    dev, em, frames, st = run("ble_disconnect", 50)
    assert dev.stats["suppressed"] > 0
    ts = [e.t for e in em]
    assert not any(30 < t < 42 for t in ts)


def test_fall_impact_saturates_accel():
    dev, em, frames, st = run("fall", 42)
    recs = np.array([r for f in frames if f.type == FrameType.IMU_RAW for r in decode_imu(f.payload)])
    mag = np.linalg.norm(recs[:, :3] / 8192.0, axis=1)
    assert mag.min() < 0.3          # free fall
    assert recs[:, :3].max() == 32767   # impact clips at +4 g like the real sensor


def test_spo2_encoding_recoverable():
    _, _, frames, _ = run("normal", 20)
    red, ir = [], []
    for f in frames:
        if f.type == FrameType.PPG_RAW:
            r, i = decode_ppg(f.payload)
            red += r; ir += i
    from scipy.signal import butter, sosfiltfilt
    red, ir = np.array(red, float), np.array(ir, float)
    sos = butter(4, [0.5, 5.0], btype="band", fs=25.0, output="sos")
    ac = lambda x: np.std(sosfiltfilt(sos, x)[50:-50])
    R = (ac(red) / red.mean()) / (ac(ir) / ir.mean())
    assert 95 < 110 - 25 * R < 101
