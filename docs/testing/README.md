# Testing

| Layer | What | Command | Count |
|---|---|---|---|
| Firmware conformance | regenerate golden frames from the vendored `nrf_link.c`; CI fails if they change | `make vectors` | 9 vectors |
| Protocol (Python) | CRC, every vector, encoder round-trip, chunking, resync, false sync, fuzz | `pytest packages/protocol/python/tests` | 35 |
| Protocol (TypeScript) | same vectors | `npm -w packages/protocol/ts test` | 7 |
| Simulator | 10 scenarios valid, determinism, firmware batching/rates, loss/corruption/disconnect accounting, fall saturation, SpO₂ encoding | `pytest simulator/tests` | 19 |
| Replay | format round-trip, truncation, real-time pacing, speed, seek, loop | `pytest replay/tests` | 4 |
| Gateway | ingest codec, link state machine, backoff, only-valid-frames forwarding, simulator source with disconnects | `pytest services/gateway/tests` | 9 |
| API | auth, rate limit, RBAC, key handling, end-to-end ingest, every scenario raises its expected event, normal raises none, exact loss counting, server-side CRC rejection, ack flow, live WS, demo, exports, cascade delete — on **SQLite and PostgreSQL** | `cd apps/api && pytest` | 25 |
| Integration | real uvicorn process + real `mesp-gateway` process over WebSocket (sim and replay), graceful `bye` | `pytest tests/integration` | 2 |
| Web unit | ring buffer, live client state machine, freshness mapping, components | `npm -w apps/web test` | 11 |
| E2E | landing, frame anatomy, demo dashboard draws, keyboard controls, scenario → event → ack → timeline, export labelling, axe WCAG 2 A/AA, mobile overflow & menu | `npm -w apps/web run e2e` | 10 |
| Load | ingest throughput and concurrent devices | `python tests/load/ingest_load.py` | see [load-results.md](load-results.md) |

All physiological expectations in tests are against **simulated data**. They prove the pipeline computes what it was designed to compute on known inputs; they say nothing about accuracy on real people.
