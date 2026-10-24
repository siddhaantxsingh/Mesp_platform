"""Writes a firmware-identical byte stream for the device-link E2E test.

Usage: python make_stream.py OUT.bin [seconds]
Output = what the nRF bridge forwards: simulated 'normal' firmware frames, plus one on-device
fall EVENT and one AFib-screen EVENT (same text formats as MESP_lab main.c).
"""
import sys

from mesp_protocol import Deframer, FrameType, encode_event, encode_frame
from mesp_protocol.decode import EVENT_FALL, EVENT_STROKE_RISK
from mesp_simulator.device import SimulatedDevice
from mesp_simulator.scenarios import get_scenario

out, seconds = sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 20
dev = SimulatedDevice(get_scenario("normal"), seed=7, loop=True)
data = bytearray()
for i, e in enumerate(dev.generate(seconds)):
    data += e.data
    if i == 300:   # ~1 s in
        data += encode_frame(FrameType.EVENT, 200, encode_event(EVENT_FALL, 91,
            "EVENT:FALL t=5012 ms impact=3.41 g freefall=310 ms still=2100 ms dOri=78 deg conf=91%"))
        data += encode_frame(FrameType.EVENT, 201, encode_event(EVENT_STROKE_RISK, 74,
            "EVENT:STROKE_RISK t=5200 ms AFib pattern suspected (score 74, 40 RR, mean 690 ms, RMSSD 142 ms, "
            "pNN50 61%, H 0.93, TPR 0.71) - screening only, not a stroke diagnosis"))
# one shared sequence counter for every frame type, exactly like nrf_link.c (nrf_seq++)
frames = Deframer().feed(bytes(data))
data = b"".join(encode_frame(f.type, i & 0xFF, f.payload) for i, f in enumerate(frames))
open(out, "wb").write(data)
print(len(data))
