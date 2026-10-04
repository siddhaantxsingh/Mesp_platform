# Resume material — MESP Health Monitoring Platform

All numbers below come from this repository's tests and load runs (see `docs/testing/`). Data in tests and demos is simulated. Do not claim clinical accuracy.

## One-line project entry

**MESP Health Monitoring Platform** — Python (FastAPI, asyncio, NumPy/SciPy), PostgreSQL, React/TypeScript, BLE · *github.com/siddhaantxsingh/mesp-platform*

## Bullet options

### For SWE / backend roles
- Built a real-time ingest platform for a BLE wrist-worn ECG/PPG/IMU monitor: gateway → FastAPI pipeline → PostgreSQL → WebSocket console. One process sustains **~6,400 frames/s** and **16 concurrent devices in real time with p95 ingest latency ≤ 336 ms** on 2 vCPUs.
- Derived the wire protocol from the STM32 firmware source and **compiled the firmware's own framing code on a host to generate golden test vectors**. Python and TypeScript decoders match it byte for byte, and CI fails on any drift.
- Designed loss-aware streaming: CRC re-validation, 8-bit sequence-gap loss accounting (exact against injected loss in tests), duplicate suppression, and per-sample timestamp reconstruction for a protocol with no device timestamps.
- Cut raw-sample writes from ~2,000 rows/s to 3 rows/s per device by storing 1-second float32 chunks. Range queries use min/max-envelope decimation so ECG peaks survive zoom-out (ADR-documented trade-off vs TimescaleDB).
- Wrote **122 automated tests**: protocol conformance, deterministic scenario tests, API tests on SQLite *and* PostgreSQL, cross-process gateway↔API integration, Playwright E2E with axe accessibility checks. CI includes migration-drift checks and Docker smoke tests.

### For frontend roles
- Built a React/TypeScript monitoring console with a custom **canvas waveform renderer** over Float32 ring buffers kept outside React state: requestAnimationFrame, per-pixel min/max decimation, gap breaks, pause/zoom/pan/fullscreen, keyboard control, reduced-motion support.
- Designed an original light/dark design system and a scroll-driven landing page. **Zero serious/critical axe WCAG 2 A/AA violations** across key pages in both themes. Responsive to 390 px.

### For embedded / electronics roles
- Brought up the software side of an STM32G431 + AD8232 + MAX30102 + MPU-6886 + nRF52840 wearable: BLE (Nordic UART Service) and UART gateways, deframing with false-sync resistance, and device profiles mapping firmware presets (sample rates, full-scale ranges) to physical units.
- Implemented signal processing: Pan-Tompkins-style R-peak detection, beat-interval irregularity, ratio-of-ratios SpO₂ estimate with motion gating, and an IMU fall heuristic that handles accelerometer saturation.
- Built a byte-exact firmware simulator (10 deterministic scenarios incl. link loss, bit errors and BLE disconnects) so the full pipeline runs without hardware.

### For ML / data roles
- Built the data foundation for physiological ML: timestamped, loss-annotated multi-sensor recordings (1 kHz ECG/IMU, 25 Hz PPG) with raw byte-stream capture/replay, quality labels per second, and CSV/JSON export with provenance and synthetic-data labelling.

## Interview talking points
1. **Why compile the firmware on a host?** Documentation left two details ambiguous: CRC byte order, and that one sequence counter is shared by all frame types. Tests against real bytes removed the guesswork.
2. **Timestamps without timestamps:** nominal-rate spacing anchored to receive time, slow drift correction, gap detection at 0.35 s, never moving time backwards (ADR-005).
3. **Why withhold SpO₂ during exercise:** the simulator showed wrist PPG locking onto arm-swing cadence (~150 bpm). With no motion-artefact cancellation, showing nothing is more correct than showing a confident wrong number.
4. **Scaling limit and fix:** in-process live hub plus single-threaded DSP saturates near 32 devices on 2 vCPU. Next steps are DSP workers and Redis/NATS fan-out (ADR-003).
5. **What isn't proven:** accuracy against a reference device, fall-detection sensitivity/specificity, BLE range. All are listed as "Not yet measured".
