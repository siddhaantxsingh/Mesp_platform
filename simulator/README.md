# mesp-sim

Deterministic device simulator. Output is the **byte stream the STM32 firmware would send** (framing, batching, sequence counter, CRC, `boot`/`stats` lines). All output is SIMULATED DATA.

```bash
mesp-sim --list
mesp-sim --scenario irregular --seconds 60 --out irregular.mesprec   # recording for replay
mesp-sim --scenario normal --seconds 5 > raw.bin                     # raw bytes
```

Scenarios: normal, exercise, poor_ecg, poor_spo2, fall, irregular, ble_disconnect, low_battery (uses the *proposed* `batt` status line), corruption, packet_loss.
