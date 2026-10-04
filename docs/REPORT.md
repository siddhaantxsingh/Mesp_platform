# MESP Health Monitoring Platform — Technical Report

*Wrist-worn multi-parameter digital health monitor with BLE connectivity*
Siddhant Singh · v1.0.0 · October 2026

> This system is an engineering/research prototype for physiological monitoring and visualization. It is not a medical device and does not provide a medical diagnosis. Measurements and alerts should not be used as a substitute for professional medical evaluation.

---

## 1. Abstract

MESP is a wrist-worn monitor that acquires single-lead ECG (AD8232), red/infrared photoplethysmography (MAX30102) and 6-axis motion (MPU-6886) on an STM32G431 and forwards them over Bluetooth LE through an nRF52840 bridge. This report describes the software platform built on top of the existing firmware: a protocol package derived from and verified against the firmware source, an edge gateway, an ingest pipeline with timestamp reconstruction, loss accounting and persistence, signal processing and an event engine, a real-time web console, and a byte-exact simulator that drives the same pipeline for demonstration and testing. One API process on 2 vCPU ingests about 6 400 frames/s and serves 16 simulated devices in real time with a p95 ingest latency at or below 336 ms. Clinical accuracy has **not** been evaluated.

## 2. Introduction

Wearable prototypes often stop at "data on a serial monitor". The gap between that and a usable system is mostly software: getting bytes off a radio reliably, knowing when data is missing or corrupt, putting samples on a time axis, storing them sensibly, and showing them to a person without overstating what they mean. The goal of this project was to close that gap for the MESP lab hardware with production engineering practices: tests, versioned protocols, security, documentation, while keeping every claim traceable to code or a measurement.

## 3. Objectives and scope

**In scope:** link protocol handling, BLE/serial gateway, ingest and storage, derived physiological *estimates*, events, a live and historical web console, demo/simulation, security basics, tests, CI, deployment.
**Out of scope:** firmware changes (the firmware was treated as given), clinical validation, regulatory work, mobile apps, cloud hosting.

## 4. Requirements

| ID | Requirement | Realisation |
|---|---|---|
| R1 | Never assume the packet format | protocol read from `nrf_link.c`; host-compiled conformance vectors |
| R2 | Detect corruption, loss, duplicates, disconnects | CRC at gateway and API; 8-bit sequence tracking; link state machine |
| R3 | Time-align samples without device timestamps | `StreamClock` per stream (§11) |
| R4 | Same path for hardware and simulation | byte-level simulator + shared Gateway/IngestSession |
| R5 | Real-time display ≤ 1 s behind | 50 ms gateway batches, 250 Hz ECG display; median ingest latency 32–41 ms at 8–16 devices |
| R6 | Honest UI | six freshness states; values withheld with reasons; "Not available" for missing hardware support |
| R7 | Clearly label synthetic data | `synthetic` flag end to end; banner, badges, export headers and file names |
| R8 | Security & audit | bcrypt, JWT roles, hashed device keys, rate limiting, audit log |
| R9 | Accessible, responsive UI | WCAG 2 A/AA axe checks in light and dark, keyboard control, reduced motion, mobile layout |

## 5. Hardware overview

| Block | Part | As used by the firmware |
|---|---|---|
| MCU | STM32G431KB (Cortex-M4F, 170 MHz) | DMA/interrupt-driven acquisition |
| ECG | AD8232 | PA0 → ADC2, 12-bit, TIM2-triggered at 1 kHz, circular DMA |
| PPG | MAX30102 | I²C1 400 kHz, SpO₂ mode, 100 sps with 4× averaging → 25 Hz FIFO, 18-bit |
| IMU | MPU-6886 | 1 kHz FIFO, low-noise profile ±4 g / ±500 °/s |
| Radio | nRF52840 (Seeed XIAO) | UART ↔ BLE Nordic UART Service bridge |
| Planned | MAX30205, MAX17048, SSD1306 | **no firmware drivers yet** |

## 6. Firmware and acquisition (as found)

Sensor data lands in single-producer/single-consumer rings (PPG 512, IMU 256, ECG 2048 entries). The main loop pops batches, runs the on-device filter hooks, and calls `Nrf_SendPPG/IMU/ECG`, which frame each batch into a 4 kB DMA TX ring for USART1 at 1 Mbaud with hardware flow control. A `boot:` line is sent once and a `stats` line every second. The platform relies only on what goes over the wire; the on-device HR/SpO₂ filter outputs are printed to the debug console but **not transmitted**, so all derived values are recomputed on the server.

## 7. Link protocol

Frames: `AA 55 | version | type | seq | len(LE16) | payload | CRC-16/CCITT-FALSE (LE)`; five types (PPG, IMU, STATUS, TEXT, ECG); payload ≤ 1008 B; big-endian sample fields. The full specification is in `docs/protocol/link-protocol-v1.md`.

**Verification method.** `firmware-harness/` vendors `nrf_link.c` verbatim, stubs the HAL, calls the real send functions and captures the bytes that would go to the UART. Nine vectors cover each type, the maximum payload and the sequence wrap. Python and TypeScript decoders must reproduce them exactly, and CI regenerates them on every push. This settled two details documentation alone would have left ambiguous: the CRC is stored little-endian, and the sequence counter is shared across all frame types.

**Deframing** handles arbitrary BLE fragmentation and is resistant to false sync: an `AA 55` inside a payload can never swallow following frames, because failures skip one byte, and a plausible-looking incomplete header is abandoned if a complete valid frame already follows it.

## 8. System architecture

Wristband → BLE bridge → **gateway** (byte stream → frames) → **API** (validation, decode, timing, storage, analysis, events) → **browser** (live WebSocket + REST). See `docs/architecture/overview.md` for the diagram. Every source (BLE, serial, recording, simulator) enters as bytes at the gateway. Demo mode runs the gateway in-process but calls the same session entry points.

## 9. Gateway

Sources implement one async interface yielding `data`, `up` and `down` events: `BleSource` (bleak; scans for "MESP-Health" or the NUS service, subscribes to TX notifications), `SerialSource`, `ReplaySource`, `SimulatorSource`. A shared `LinkStateMachine` (disconnected → connecting → connected → streaming ↔ stale) with legal-transition checks reports changes upstream; source failures restart with equal-jitter exponential backoff (0.5 s to 30 s). The `WebSocketUplink` keeps a bounded drop-oldest backlog during API outages and reconnects with its own backoff. A graceful stop sends `bye` so the API does not raise a disconnect alarm. `--record` writes the raw stream to `.mesprec`.

## 10. Ingest pipeline

For each frame: strict re-parse and CRC check → sequence/duplicate check → decode with the device profile → timestamping → buffering. Display-filtered, decimated samples are published per batch, about every 50 ms. Every complete second of device time is a **slice**: persisted as one chunk per stream, then analysed. Slices advance on data time, not wall time, so replays at 8× produce the same per-second results as live data. An idle timer completes the last slice when data stops.

## 11. Timestamping and sequencing

Without device time, each stream's samples are placed at exact nominal spacing, anchored to host receive time and slowly corrected toward it. Lateness above 0.35 s declares a gap; early data is never moved backwards. Lost frames are counted from sequence gaps (a lower bound across outages longer than 256 frames). Duplicates are recognised by `(seq, CRC)` within a 16-frame window. In tests with injected loss, the counted loss equals the injected loss exactly.

## 12. Signal processing

| Output | Method | Guard rails |
|---|---|---|
| ECG display | causal 0.5–40 Hz Butterworth + 50 Hz notch, decimated to 250 Hz | amplitude shown in volts at the ADC; mV not claimed (module gain unknown) |
| R-peaks, HR, RR | 5–18 Hz band-pass, derivative², 120 ms moving integration, adaptive threshold, refinement to the band-passed maximum, de-duplicated across 10 s windows | HR withheld if quality is poor |
| Irregularity | RMSSD / mean RR over the last 30 beats, plus the fraction of successive changes > 15 % | worded as a pattern flag, never a diagnosis |
| ECG quality / lead-off | band vs >45 Hz energy ratio; >20 % of samples near the rails = lead-off | |
| Pulse rate, PI | 0.5–5 Hz band-pass of IR, peak intervals, coefficient-of-variation quality grade | withheld when motion > 0.15 g (no motion-artefact cancellation, so the PPG locks onto arm-swing cadence otherwise; observed in the exercise scenario) |
| SpO₂ estimate | ratio of ratios with the firmware's placeholder line 110 − 25 R | **uncalibrated**; withheld under motion or low perfusion |
| Activity, orientation | std of \|a\| per second; roll/pitch from mean gravity | |
| Fall (heuristic) | free fall < 0.4 g for ≥ 120 ms → impact ≥ 2.5 g or ADC saturation within 1 s → stillness and > 40° orientation change 1.5–3.5 s later | sensitivity/specificity **not yet measured** |

All thresholds were tuned on simulated data only.

## 13. Event engine

Sustained-condition rules (fire after N seconds true, clear after M seconds false) prevent alarm flapping: high/very high/low HR, low/very low SpO₂ estimate, lead-off, poor ECG quality, irregular RR pattern, battery low/critical, packet loss > 2 %, CRC errors > 1 % (10 s windows). Falls and link changes are instantaneous events. Each event stores severity, wording, a data snapshot, the stream to open, and acknowledgement (who, when, note), and is published live. Every scenario test asserts its expected events; the `normal` scenario asserts that none fire.

## 14. Storage

PostgreSQL with Alembic migrations. Raw samples are stored as **one row per stream per second** (float32 blob, `t_start`, rate, shape), so 3 inserts per device per second instead of about 2 000. 1 Hz `vitals`, `events`, `sessions`, `devices`, `users` and `audit_log` are normal rows. TimescaleDB was evaluated and deferred (ADR-004). A retention job deletes raw chunks after a configurable age. Range reads return min/max envelopes so peaks survive decimation.

## 15. REST API

27 endpoints (OpenAPI in `docs/api/openapi.json`): auth, users, devices (keys shown once, rotation), sessions, samples, vitals, analytics, events and acknowledgement, export, demo control, audit, health/readiness/metrics. Pydantic validation, consistent error bodies, no internal details on 500.

## 16. Real-time streaming

Live WebSocket v1: token in the first message, explicit subscribe, server ping/client pong, versioned messages (`samples`, `vitals`, `event`, `link`, `session`). Per-client bounded queues drop the oldest messages so a slow browser never blocks ingest. The browser client reconnects with jittered backoff, re-subscribes, and treats 40 s of silence as a dead connection.

## 17. Frontend and user experience

React + TypeScript + Tailwind with an original design system (tokens in `packages/ui`, light and dark). Live waveforms use a custom canvas renderer over `Float32Array` ring buffers outside React state: per-pixel min/max decimation, NaN gap breaks, eased auto-scale, a time base interpolated between batches, pause/zoom/pan/fullscreen and keyboard control. Vitals tiles show quality, dim when stale, and say why a value is missing. Events link to the exact second on the sensor timeline. The pairing wizard registers a device, shows the key once with the matching gateway command, and waits for first data. The landing page tells the system's story from signal to screen, including an interactive breakdown of a real firmware frame and an explicit "not yet measured" list. Accessibility: axe WCAG 2 A/AA scans show no serious or critical violations on key pages in either theme; landmarks, skip link, live regions for critical events, reduced-motion support.

## 18. Simulator, replay and demo mode

Ten seeded scenarios synthesise PQRST ECG with heart-rate trajectories and optional irregular RR, pulsatile red/IR PPG with a target SpO₂ ratio, and IMU motion (walking cadence, free fall, saturating impact, posture change). The simulator then frames them **exactly as the firmware does** and applies link faults on the "radio". Recordings (`.mesprec`) store raw bytes with a `synthetic` flag that survives replay. SpO₂ round trips are circular by construction and test plumbing only.

## 19. Security and privacy

bcrypt passwords with a constant-time path for unknown emails, login rate limiting, HS256 JWT with three roles, demo tokens restricted from hardware/key actions, SHA-256-hashed per-device ingest keys, security headers and CSP, no secret defaults (production refuses to start without a JWT secret), audit logging, raw-data retention, cascade deletion. Known gaps: no TLS in the compose file (proxy expected), no token revocation, in-process rate limiting, an unencrypted BLE link (no bonding in the bridge firmware). Details: `docs/security/threat-model.md`.

## 20. Testing and verification

122 automated tests: protocol (Python 35, TypeScript 7), simulator 19, replay 4, gateway 9, API 25 (run on both SQLite and PostgreSQL), cross-process integration 2, web unit 11, Playwright E2E 10 (with axe). The CI workflow regenerates firmware vectors, lints, runs everything above, checks that migrations apply with no model drift, and builds and smoke-tests the Docker images.

## 21. Results and limitations

**Measured (simulated data, 2 vCPU sandbox):** max ingest ~6 400 frames/s per process (24.8× one device's real-time rate); 8 devices p50 31.9 ms / worst p95 176.5 ms; 16 devices p50 41.3 ms / worst p95 336 ms; saturation at 32 devices. In the scenario suite, ECG-derived HR tracks the simulated trajectory, irregular rhythm separates clearly (irregularity ≈ 0.35–0.42 vs ≈ 0.05 normal), the fall is detected once per occurrence, and lead-off, low SpO₂ estimate, loss, corruption and battery events fire as expected.

**Limitations:** no evaluation on real recordings or against reference devices; thresholds tuned on synthetic data; SpO₂ uncalibrated; no PPG motion-artefact cancellation; approximate cross-stream alignment without device time; single-instance live hub; Docker images not built in the authoring environment; no hosted deployment.

## 22. Future work and conclusion

Next steps, in order of value: (1) record real sessions with the hardware and a reference pulse oximeter/ECG, then report HR/SpO₂ error with Bland–Altman analysis; (2) add a device tick to the firmware `stats` line for exact time alignment; (3) MAX17048 and MAX30205 drivers using the documented status lines; (4) LE Secure Connections bonding on the bridge; (5) accelerometer-referenced motion-artefact cancellation for PPG; (6) move DSP to worker processes and the live hub to Redis/NATS for scale-out; (7) labelled fall data to measure the heuristic.

The platform turns the MESP firmware's raw byte stream into a system that can be trusted to say what it knows and what it doesn't. Every frame is validated, every loss counted, every synthetic sample labelled, and every number in this report is either measured or marked as not yet measured.
