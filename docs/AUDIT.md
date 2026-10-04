# Final audit checklist (v1.0.0)

| Area | Check | Status |
|---|---|---|
| Protocol | Format taken from firmware source, verified against host-compiled firmware output | ✅ 9 vectors, Python + TS, CI regenerates |
| Protocol | Versioned adapter (`protocol_version`, device profile, firmware string from `boot:`) | ✅ profile mismatch raises an event |
| Pipeline | decode → CRC → schema → timestamp → sequence → dedup → persist → derive → events → WebSocket | ✅ `pipeline/ingest.py` |
| Pipeline | Same code path for hardware, replay and simulator | ✅ byte-level sources → Gateway → IngestSession |
| Reliability | Reconnect with backoff, heartbeat, link state machine, stale detection, graceful shutdown | ✅ gateway + live client |
| Demo | 10 deterministic scenarios, labelled DEMO MODE — SYNTHETIC DATA | ✅ each asserts its events |
| UI | LIVE / STALE / DISCONNECTED / LOADING / ERROR / NO DATA | ✅ `freshness()` + unit tests |
| UI | ECG ring buffer, rAF, decimation, pause, zoom, pan, fullscreen, gaps | ✅ `Waveform.tsx` |
| UI | Events: severities, acknowledgement, click-through to sensor timeline | ✅ E2E covered |
| UI | Pairing flow, device page (packets, loss, CRC) | ✅ |
| UI | Designed loading/empty/error states | ✅ `StateView`, skeletons |
| A11y | WCAG 2 A/AA (axe) light + dark; keyboard; reduced motion; responsive to 390 px | ✅ no serious/critical violations on scanned pages |
| Security | No committed secrets; hashed keys; bcrypt; roles; rate limit; audit; headers | ✅ see threat model; known gaps listed |
| Honesty | No fabricated measurements; unmeasured items say "Not yet measured"; no diagnosis wording; disclaimer verbatim | ✅ landing, console, exports, docs |
| Honesty | Unimplemented hardware shown as Not available | ✅ battery, skin temperature, display |
| Data | Export CSV/JSON with provenance and synthetic label | ✅ audit-logged |
| Ops | `/health`, `/ready`, `/metrics`; retention job; migrations with drift check | ✅ |
| Tests | 122 automated tests; clean-clone run green (Python on SQLite + PostgreSQL, JS, integration) | ✅ |
| Deploy | Dockerfiles + compose validated (`docker compose config`) | ⚠️ images not built in authoring sandbox (Docker Hub blocked); CI job builds and smoke-tests |
| Deploy | Public hosted instance | ❌ not deployed |
| Validation | Accuracy vs reference devices, fall sensitivity, BLE range/throughput, battery life | ❌ Not yet measured |
