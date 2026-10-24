# Changelog

## Unreleased

- Website can connect the wristband itself: **Connect by Bluetooth** (Web Bluetooth, Nordic UART "MESP-Health") or **Connect by USB cable** plugged into the XIAO nRF52840 (Web Serial, skips Bluetooth). New endpoint `/api/v1/ingest/browser/ws` (signed-in operator, same pipeline as the gateway). Bluetooth auto-reconnects; data is buffered while the internet drops; Disconnect is not raised as an alarm.
- Firmware sync with MESP_lab main: new `EVENT` frame (0x06) for on-device fall and AFib-pattern screening, decoded in Python and TypeScript and shown as wristband alerts. Harness and vectors updated to the new `nrf_link.c`.
- Fix: the live and ingest WebSockets no longer log an error when a page closes before signing in.

## 1.0.0 — 2026-10-05

First release.

- Link protocol v1 taken from the firmware (`nrf_link.c`), with host-compiled conformance vectors; Python and TypeScript decoders.
- Byte-exact device simulator with 10 deterministic scenarios; `.mesprec` record/replay.
- Gateway: BLE (Nordic UART Service), serial, replay and simulator sources; link state machine; reconnect with backoff; graceful `bye`.
- API: ingest pipeline (CRC re-check, sequence/duplicate tracking, timestamp reconstruction, 1 s chunk storage), DSP (R-peaks, pulse, SpO₂ estimate, motion, fall heuristic), event rules with hysteresis, REST + live WebSocket v1, JWT auth with roles, hashed device keys, audit log, CSV/JSON export, retention job, `/health` `/ready` `/metrics`.
- Web: landing page; live console with canvas waveforms; history with zoomable timelines and event click-through; sessions, events (acknowledgement), devices (pairing wizard), scenarios, settings; light/dark; reduced motion; WCAG 2 AA checks with axe.
- PostgreSQL migrations (Alembic), Docker images, Compose, GitHub Actions CI.
