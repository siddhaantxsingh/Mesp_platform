# Link protocol v1 (STM32 → nRF52840 → gateway)

**Source of truth:** `mesp_lab/Core/Src/nrf_link.c` in the MESP_lab firmware. Everything below was read from that file and is verified byte-for-byte by `firmware-harness/` (the firmware's own C code compiled on a host) and the tests in `packages/protocol/python/tests` and `packages/protocol/ts/src`.

## Transport

| Hop | Medium | Settings (from firmware) |
|---|---|---|
| STM32G431 → nRF52840 | USART1 | 1 Mbaud 8N1, RTS/CTS (`NRF_UART_HWFC=1`) |
| nRF52840 → gateway | BLE, Nordic UART Service | TX characteristic `6e400003-b5a3-f393-e0a9-e50e24dcca9e` (notify), advertised name `MESP-Health` |
| STM32 → PC (bench) | USB-UART adapter on PA9 | `NRF_LINK_ENABLED=1`, `NRF_UART_HWFC=0` |

The BLE bridge (`ble_uart_bridge.ino`) forwards the UART byte stream unchanged, in 64-byte reads, so frames arrive split across arbitrary notification boundaries. The gateway therefore treats every transport as a **byte stream** and deframes it.

## Frame

```
offset  size  field
0       2     magic 0xAA 0x55
2       1     version = 1
3       1     type
4       1     sequence (uint8, one counter for all types, wraps 255 → 0)
5       2     payload length, little-endian, ≤ 1008
7       n     payload
7+n     2     CRC-16/CCITT-FALSE over bytes [2 .. 6+n], little-endian
```

CRC-16/CCITT-FALSE: polynomial 0x1021, init 0xFFFF, no reflection, no final XOR (check value for `"123456789"` = `0x29B1`).

## Types

| Type | Value | Payload | Firmware batching (default config) |
|---|---|---|---|
| `PPG_RAW` | 0x01 | n × 6 B: red(3) ir(3), 18-bit big-endian, top byte masked to 2 bits | FIFO drained every 5 ms → ~1 sample/frame at 25 Hz |
| `IMU_RAW` | 0x02 | n × 14 B: ax ay az temp gx gy gz, int16 big-endian | ≤ 36 records; polled every 5 ms → ~5 records/frame |
| `STATUS` | 0x03 | ASCII text | not emitted by current firmware |
| `TEXT` | 0x04 | ASCII text | `boot: ppg=25sps imu=1kHz` once, `stats ppg=… imu=… ecg=… ovf=… drop=…` every 1 s |
| `ECG_RAW` | 0x05 | n × 2 B: 12-bit ADC code, uint16 big-endian | DMA half-buffer → 32 samples/frame, ≤ 504 |

## What the wire does *not* carry

No device timestamps, no sample rates, no full-scale ranges, no device ID. These come from a **device profile** (`mesp_protocol/profile.py`), pinned to the firmware configuration it describes (`PPG_PRESET_BALANCED`, `IMU_PROFILE_LOWNOISE`, `ECG_SAMPLE_HZ=1000`). A profile mismatch is detected from the `boot:` line and raised as an event.

| Default profile `mesp-lab-main-v1` | Value |
|---|---|
| PPG FIFO rate | 25 Hz (100 sps, 4× averaging), 18-bit |
| IMU | 1 kHz, ±4 g (8192 LSB/g), ±500 °/s (65.5 LSB/°/s), die temp = raw/326.8 + 25 °C |
| ECG | 1 kHz, 12-bit, 3.3 V reference |
| Battery / skin temperature / display | **Not implemented in firmware** |

## Deframer rules

1. Scan for `AA 55`.
2. Length > 1008 → false sync: skip one byte.
3. Header with an unknown version or type and an incomplete body → false sync: skip one byte.
4. Plausible header but incomplete body → wait for more bytes, *unless* a complete CRC-valid frame already starts later in the buffer (then the current header is a false sync).
5. CRC mismatch → count `crc_errors`, skip one byte (never the whole claimed length, so an embedded `AA 55` cannot swallow following frames).
6. CRC-valid frame with an unsupported version → count `unsupported_version`, drop.

## Rates and bandwidth at the default configuration

Derived from the batching above (and reproduced by the simulator): about **257 frames/s** and **18.5 kB/s** of link traffic (200 IMU + ~31 ECG + 25 PPG + 1 TEXT frames per second). Measured BLE throughput on the hardware: **Not yet measured.**

## Proposed extensions (not in the current firmware)

See [status-lines.md](status-lines.md). They use the existing `STATUS` type, so they need no protocol version change.
