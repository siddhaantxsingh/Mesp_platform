# Load test results

**Environment:** cloud sandbox, 2 vCPU (x86_64, Linux 6.18), Python 3.13, PostgreSQL 16 on the same machine, load generator also on the same machine, API single uvicorn worker with the demo scenario also running. All data SIMULATED (`normal` scenario, default profile: ~257 frames/s per device).

| Test | Result |
|---|---|
| Max ingest, 1 device, 60 s of data pushed as fast as accepted | 15 436 frames in 2.42 s → **~6 400 frames/s**, 24.8× real time, 0 lost |
| 8 devices at real-time pace, 30 s | all 61 744 frames accounted for; ingest latency p50 (median over devices) **31.9 ms**, worst p95 **176.5 ms** |
| 16 devices at real-time pace, 30 s | all frames accounted for; p50 **41.3 ms**, worst p95 **336 ms** |
| 32 devices at real-time pace, 30 s | all frames accounted for, but **saturated**: p50 5.6 s, p95 14.8 s (queues growing) |

"Ingest latency" = API processing time minus gateway receive time for each frame. It excludes the BLE air interface and firmware buffering, which are **not yet measured**.

Interpretation: on this 2-vCPU box one API process sustains roughly 16 devices in real time with sub-second p95; the bottleneck is single-threaded Python DSP + per-second inserts. Scale-out options are in ADR-003. Reproduce:

```bash
MESP_ADMIN_EMAIL=… MESP_ADMIN_PASSWORD=… python tests/load/ingest_load.py max --seconds 60
MESP_ADMIN_EMAIL=… MESP_ADMIN_PASSWORD=… python tests/load/ingest_load.py concurrent --devices 16 --seconds 30
```
