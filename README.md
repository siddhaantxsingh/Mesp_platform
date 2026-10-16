<div align="center">

# 🫀 MESP Health Monitoring Platform

### From wearable sensor bytes to a real-time physiological monitoring console

**Three sensors. One wrist. Every byte accounted for.**

<br/>

![STM32](https://img.shields.io/badge/STM32G431-Cortex--M4-03234B?style=for-the-badge&logo=stmicroelectronics&logoColor=white)
![BLE](https://img.shields.io/badge/BLE-nRF52840-0082FC?style=for-the-badge&logo=bluetooth&logoColor=white)
![Python](https://img.shields.io/badge/Python-asyncio_·_NumPy_·_SciPy-3776AB?style=for-the-badge&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-336791?style=for-the-badge&logo=postgresql&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-2E7D32?style=for-the-badge)

![Tests](https://img.shields.io/badge/automated_tests-122_passing-2E7D32?style=flat-square)
![Vectors](https://img.shields.io/badge/firmware_golden_vectors-byte--exact-6A1B9A?style=flat-square)
![Ingest](https://img.shields.io/badge/max_ingest-~6%2C400_frames%2Fs-1565C0?style=flat-square)
![Devices](https://img.shields.io/badge/16_devices_real--time-p95_≤_336_ms-00838F?style=flat-square)
![Storage](https://img.shields.io/badge/DB_writes-2%2C000→3_rows%2Fs%2Fdevice-E65100?style=flat-square)
![A11y](https://img.shields.io/badge/WCAG_2_A%2FAA-0_serious_violations-2E7D32?style=flat-square)

<br/>

<img src="docs/images/live.png" alt="MESP live monitoring console with ECG, PPG and motion waveforms" width="95%"/>

<sub><a href="#-system-architecture">Architecture</a> · <a href="#-protocol-engineering">Protocol</a> · <a href="#-the-timestamp-problem">Timestamps</a> · <a href="#-signal-processing">DSP</a> · <a href="#-performance">Performance</a> · <a href="#-correctness--testing">Testing</a> · <a href="#-security--privacy">Security</a> · <a href="#-quick-start">Quick start</a></sub>

</div>

> [!WARNING]
> **Engineering / research prototype — not a medical device.** MESP does not provide medical diagnosis. Physiological values and alerts are not clinically validated and must not replace professional medical evaluation. Synthetic data is labelled as such everywhere — UI, sessions, events and exports.

---

## ⚡ TL;DR

MESP is the software platform behind a **wrist-worn multi-parameter health monitor**: an STM32G431 sampling **ECG** (AD8232), **PPG** (MAX30102) and **6-axis motion** (MPU-6886), streaming framed bytes over an **nRF52840 BLE bridge**.

This repository takes that raw byte stream all the way to a real-time monitoring console — and the interesting engineering is **everything required to make the dashboard trustworthy about the data it receives**:

- 🧬 **Protocol derived from firmware, not docs** — the firmware's own `nrf_link.c` is compiled on a host to produce golden byte vectors; Python and TypeScript decoders must match byte-for-byte.
- 🛡️ **Loss-aware streaming** — CRC, false-sync-resistant deframing, sequence-gap loss accounting (exact against injected loss), duplicate suppression.
- ⏱️ **Timestamps for a protocol that has none** — per-stream clock reconstruction with drift correction and gap detection.
- 🧠 **Server-side DSP** — Pan-Tompkins-style R-peaks, RR irregularity, motion-gated SpO₂ estimate, fall heuristic.
- 💾 **1-second Float32 chunks** — ~2,000 raw samples/s per device become **3 rows/s**.
- ⚡ **Canvas waveforms** over Float32 ring buffers kept *outside* React state.
- 🧪 **Byte-exact simulator** with 10 deterministic scenarios — hardware, recordings and simulation all use **one code path**.

---

## 🖥️ Product

<p align="center">
<img src="docs/images/landing.png" width="48%" alt="MESP landing page"/>
<img src="docs/images/events.png" width="48%" alt="MESP events console"/>
</p>
<p align="center">
<img src="docs/images/history_event.png" width="48%" alt="History timeline with event click-through"/>
<img src="docs/images/demo.png" width="48%" alt="Demo mode with scenarios"/>
</p>

| Monitoring | Data & history | Operations |
|---|---|---|
| Real-time ECG, PPG/pleth, accelerometer and gyroscope | Zoomable historical sensor timelines with min/max envelopes | Device pairing with per-device ingest keys |
| Heart-rate and pulse-rate estimates | Event click-through to the exact time window | Packet-loss and CRC telemetry per device |
| Uncalibrated, motion-gated SpO₂ estimate | Session analytics: ECG vs PPG HR, SpO₂ distribution, activity / quality | Sessions and scenarios |
| ECG quality and lead-off state | CSV / JSON export with provenance + synthetic label | Event acknowledgement with audit log |
| Activity, orientation, heuristic fall events | Configurable raw-data retention | Responsive light/dark UI, mobile navigation |

---

## 🧭 System architecture

```mermaid
flowchart LR
    subgraph HW["⌚ Wristband (MESP_lab firmware)"]
        direction TB
        SENS["🫀 AD8232 ECG · 1 kHz<br/>🩸 MAX30102 PPG · 25 Hz<br/>🧭 MPU-6886 IMU · 1 kHz"]:::hw
        MCU["🔲 STM32G431<br/>DMA · framing · CRC"]:::hw
        NRF["📶 nRF52840<br/>BLE UART bridge"]:::ble
        SENS --> MCU -- "UART 1 Mbaud<br/>RTS/CTS" --> NRF
    end

    GW["📡 mesp-gateway<br/>BLE · serial · replay · simulator<br/>deframe · link state · backoff"]:::gw

    subgraph API["⚙️ FastAPI ingest pipeline"]
        direction TB
        P1["🔍 CRC + schema"]:::api --> P2["🔢 sequence · loss · dedup"]:::api --> P3["⏱️ timestamp reconstruction"]:::api --> P4["📐 device-profile decode"]:::api --> P5["🧠 DSP"]:::dsp --> P6["🚨 event engine"]:::ev
    end

    DB[("🐘 PostgreSQL<br/>1 s Float32 chunks")]:::db
    UI["🖥️ React console<br/>canvas waveforms"]:::ui

    NRF -- "BLE NUS" --> GW -- "WebSocket<br/>raw frames" --> API
    P4 --> DB
    P6 --> DB
    API -- "live WebSocket" --> UI
    DB -- "REST history" --> UI

    classDef hw fill:#03234B,stroke:#011428,color:#fff
    classDef ble fill:#0082FC,stroke:#005BB5,color:#fff
    classDef gw fill:#6A1B9A,stroke:#4A148C,color:#fff
    classDef api fill:#009688,stroke:#00695C,color:#fff
    classDef dsp fill:#E65100,stroke:#BF360C,color:#fff
    classDef ev fill:#C62828,stroke:#B71C1C,color:#fff
    classDef db fill:#336791,stroke:#1E3F5A,color:#fff
    classDef ui fill:#20232A,stroke:#61DAFB,color:#61DAFB
    style HW fill:transparent,stroke:#03234B,stroke-dasharray:5 5
    style API fill:transparent,stroke:#009688,stroke-dasharray:5 5
```

### One code path for hardware and simulation

> **Rule:** hardware, recordings and simulation must enter the *same* downstream pipeline.

```mermaid
flowchart LR
    BLE["📶 Real BLE"]:::src --> BYTES
    SER["🔌 USB / serial"]:::src --> BYTES
    REP["📼 .mesprec replay"]:::src --> BYTES
    SIM["🧪 Byte-exact simulator"]:::src --> BYTES
    BYTES["🔢 Raw byte stream"]:::bytes --> GW["📡 Same gateway"]:::same --> ING["⚙️ Same ingest"]:::same --> DSP["🧠 Same DSP + events"]:::same --> WEB["🖥️ Same console"]:::same

    classDef src fill:#37474F,stroke:#263238,color:#fff
    classDef bytes fill:#F9A825,stroke:#F57F17,color:#000
    classDef same fill:#2E7D32,stroke:#1B5E20,color:#fff
```

The demo is not a separate fake application. The simulator produces firmware-compatible frames that exercise the same gateway, ingest, storage, analysis, event and WebSocket paths as the real wristband.

---

## 🧬 Protocol engineering

The wire protocol was **read from the firmware source** (`nrf_link.c` in MESP_lab) and verified byte-for-byte — not guessed from documentation.

```mermaid
flowchart LR
    M["AA 55<br/>magic · 2 B"]:::magic --> V["version<br/>1 B"]:::hdr --> T["type<br/>1 B"]:::hdr --> S["seq<br/>u8 · 1 B<br/>shared by all types"]:::hdr --> L["length<br/>LE16 · ≤ 1008"]:::hdr --> PL["payload<br/>n B"]:::pay --> C["CRC-16/CCITT-FALSE<br/>LE · over bytes 2…6+n"]:::crc

    classDef magic fill:#C62828,stroke:#B71C1C,color:#fff
    classDef hdr fill:#1565C0,stroke:#0D47A1,color:#fff
    classDef pay fill:#2E7D32,stroke:#1B5E20,color:#fff
    classDef crc fill:#6A1B9A,stroke:#4A148C,color:#fff
```

| Type | Value | Payload | Firmware batching |
|---|---|---|---|
| `PPG_RAW` | `0x01` | n × 6 B: red(3) ir(3), 18-bit big-endian | ~1 sample/frame at 25 Hz |
| `IMU_RAW` | `0x02` | n × 14 B: ax ay az temp gx gy gz, int16 BE | ~5 records/frame |
| `STATUS` | `0x03` | ASCII | not emitted by current firmware |
| `TEXT` | `0x04` | ASCII | `boot:` line once, `stats …` every 1 s |
| `ECG_RAW` | `0x05` | n × 2 B: 12-bit ADC, uint16 BE | 32 samples/frame (DMA half-buffer) |

The wire carries **no timestamps, sample rates, full-scale ranges or device ID** — these come from a pinned **device profile**, and a profile mismatch detected from the `boot:` line raises an event.

### 🔬 Firmware-derived golden vectors

```mermaid
flowchart LR
    F["📄 Firmware nrf_link.c<br/>(copied verbatim)"]:::fw --> H["🛠️ Host build<br/>packages/firmware-harness"]:::h --> V["🎯 9 golden byte vectors"]:::v
    V --> PY["🐍 Python decoder · 35 tests"]:::py
    V --> TS["🟦 TypeScript decoder · 7 tests"]:::ts
    PY --> OK["✅ byte-for-byte conformance"]:::ok
    TS --> OK

    classDef fw fill:#03234B,stroke:#011428,color:#fff
    classDef h fill:#455A64,stroke:#263238,color:#fff
    classDef v fill:#6A1B9A,stroke:#4A148C,color:#fff
    classDef py fill:#3776AB,stroke:#1E4E7A,color:#fff
    classDef ts fill:#3178C6,stroke:#1E4E8C,color:#fff
    classDef ok fill:#2E7D32,stroke:#1B5E20,color:#fff
```

Compiling the real firmware framing code resolved two details the documentation left ambiguous: **CRC byte order**, and that **one sequence counter is shared across all frame types**.

---

## 🛡️ Loss, corruption and duplicate handling

> A wearable stream cannot assume *"if bytes arrived, the data is correct."*

```mermaid
flowchart LR
    A["📥 Byte stream<br/>(split across 64 B BLE reads)"]:::in --> B["🔎 Deframe / resync<br/>skip 1 byte on false sync"]:::st --> C{"CRC ok?"}:::chk
    C -- "no" --> CE["crc_errors++"]:::bad
    C -- "yes" --> D["🔢 Sequence tracking<br/>u8 gaps → exact loss count"]:::st --> E{"Duplicate?"}:::chk
    E -- "yes" --> DU["dropped"]:::bad
    E -- "no" --> F["📐 Profile decode"]:::st --> G["⏱️ StreamClock"]:::st --> H["✅ Accepted samples"]:::ok

    classDef in fill:#37474F,stroke:#263238,color:#fff
    classDef st fill:#1565C0,stroke:#0D47A1,color:#fff
    classDef chk fill:#F9A825,stroke:#F57F17,color:#000
    classDef bad fill:#C62828,stroke:#B71C1C,color:#fff
    classDef ok fill:#2E7D32,stroke:#1B5E20,color:#fff
```

- On a CRC mismatch the deframer skips **one byte**, never the claimed length — so an embedded `AA 55` can't swallow the frames that follow.
- Tracked per device: CRC failures, sequence gaps, duplicates, timestamp gaps, disconnects, stale streams and ingest latency.
- Injected packet loss in the simulator is **counted exactly** from sequence gaps (tested).

---

## ⏱️ The timestamp problem

> **How do you put a 1 kHz stream on a stable timeline when the device sends no timestamps and packets arrive over an unreliable link?**

Each stream (`ecg`, `ppg`, `imu`) gets its own `StreamClock`:

```mermaid
flowchart TB
    R["📨 Batch of n samples arrives<br/>at host time rx"]:::in --> FIRST{"First batch?"}:::chk
    FIRST -- "yes" --> AN["⚓ Anchor at rx − n/fs<br/>(samples were acquired before sending)"]:::st
    FIRST -- "no" --> LATE{"Later than expected<br/>by > 0.35 s?"}:::chk
    LATE -- "yes" --> GAP["✂️ Declare gap · re-anchor forward<br/>waveform breaks (gap: true)"]:::bad
    LATE -- "no" --> EARLY{"Earlier by > 0.35 s?"}:::chk
    EARLY -- "yes" --> SK["Count skew · never move time backwards"]:::warn
    EARLY -- "no" --> CONT["➡️ Continue at exact nominal spacing<br/>drift: next_t += 0.005 · (observed − expected)"]:::ok
    AN --> OUT["🕒 Timestamped samples"]:::out
    GAP --> OUT
    SK --> OUT
    CONT --> OUT

    classDef in fill:#37474F,stroke:#263238,color:#fff
    classDef chk fill:#F9A825,stroke:#F57F17,color:#000
    classDef st fill:#1565C0,stroke:#0D47A1,color:#fff
    classDef bad fill:#C62828,stroke:#B71C1C,color:#fff
    classDef warn fill:#E65100,stroke:#BF360C,color:#fff
    classDef ok fill:#2E7D32,stroke:#1B5E20,color:#fff
    classDef out fill:#6A1B9A,stroke:#4A148C,color:#fff
```

Sample spacing is exact at the nominal rate, crystal drift between the STM32 and the host is absorbed slowly without jitter, stored data never overlaps, and sequence gaps stay separate from timestamp gaps. The documented limit: absolute time is only as good as BLE delivery latency, which is **not yet measured** ([ADR-005](docs/decisions/ADR-005-timestamps.md), [timestamps.md](docs/architecture/timestamps.md)).

---

## 🧠 Signal processing

MESP **recomputes derived values server-side** instead of trusting untransmitted firmware debug output.

```mermaid
flowchart TB
    subgraph ECG["🫀 ECG · 1 kHz"]
        direction LR
        E1["0.5–40 Hz Butterworth"]:::ecg --> E2["50 Hz notch"]:::ecg --> E3["Pan-Tompkins:<br/>derivative · square ·<br/>integrate · adaptive threshold"]:::ecg --> E4["R-peaks → RR<br/>HR · irregularity"]:::ecgo
    end
    subgraph PPG["🩸 PPG · red / IR"]
        direction LR
        P1["0.5–5 Hz filter"]:::ppg --> P2["pulse peaks → pulse rate"]:::ppgo
        P3["AC / DC → ratio of ratios"]:::ppg --> P4{"motion or low<br/>perfusion?"}:::gate
        P4 -- "no" --> P5["SpO₂ estimate<br/>(uncalibrated)"]:::ppgo
        P4 -- "yes" --> P6["withheld"]:::hold
    end
    subgraph IMU["🧭 IMU · 1 kHz"]
        direction LR
        I1["free fall"]:::imu --> I2["impact / saturation"]:::imu --> I3["stillness"]:::imu --> I4["orientation change"]:::imu --> I5["fall event<br/>(heuristic)"]:::imuo
    end
    ECG ~~~ PPG ~~~ IMU

    classDef ecg fill:#2E7D32,stroke:#1B5E20,color:#fff
    classDef ecgo fill:#1B5E20,stroke:#0D3311,color:#fff
    classDef ppg fill:#6A1B9A,stroke:#4A148C,color:#fff
    classDef ppgo fill:#4A148C,stroke:#2A0B50,color:#fff
    classDef gate fill:#F9A825,stroke:#F57F17,color:#000
    classDef hold fill:#78909C,stroke:#455A64,color:#fff
    classDef imu fill:#E65100,stroke:#BF360C,color:#fff
    classDef imuo fill:#BF360C,stroke:#8C2700,color:#fff
    style ECG fill:transparent,stroke:#2E7D32,stroke-dasharray:5 5
    style PPG fill:transparent,stroke:#6A1B9A,stroke-dasharray:5 5
    style IMU fill:transparent,stroke:#E65100,stroke-dasharray:5 5
```

- **ECG:** waveform, R-peaks, HR, RR intervals, beat-interval irregularity, quality and a lead-off heuristic. **HR is withheld when signal quality is insufficient.**
- **PPG:** in the exercise scenario, wrist PPG locks onto arm-swing cadence (~150 bpm). Without motion-artefact cancellation, a confident SpO₂ number would be more misleading than none — so **under motion or low perfusion the estimate is withheld**.
- **IMU:** acceleration magnitude, activity level, orientation, die temperature and a fall heuristic that handles accelerometer saturation. Explicitly **not clinically validated**.

### 🚨 Event engine — signal processing is separate from event policy

```mermaid
flowchart LR
    S["📈 Derived signals"]:::s --> R["📏 Rules<br/>HR · SpO₂ · lead-off · quality · irregular RR<br/>packet loss · CRC · falls · link"]:::r --> H["⏳ Hysteresis / persistence<br/>no alarm flapping"]:::h --> E["🚨 Event<br/>severity · snapshot · wording"]:::e
    E --> A["✅ Acknowledgement"]:::a
    E --> WS["⚡ Live WebSocket"]:::w
    E --> TL["📍 Timeline marker<br/>click-through to the exact window"]:::t

    classDef s fill:#1565C0,stroke:#0D47A1,color:#fff
    classDef r fill:#37474F,stroke:#263238,color:#fff
    classDef h fill:#F9A825,stroke:#F57F17,color:#000
    classDef e fill:#C62828,stroke:#B71C1C,color:#fff
    classDef a fill:#2E7D32,stroke:#1B5E20,color:#fff
    classDef w fill:#00838F,stroke:#006064,color:#fff
    classDef t fill:#6A1B9A,stroke:#4A148C,color:#fff
```

---

## 🧪 Byte-exact simulator, replay and gateway

The simulator is not random JSON pretending to be a device — it emits **firmware-compatible framed bytes** with the firmware's batching and rates. **Ten deterministic scenarios**, each of which asserts the events it should raise (and `normal` asserts none):

| 🟢 Physiology | 🟠 Sensor & device | 🔴 Link faults |
|---|---|---|
| `normal` · `exercise` · `irregular rhythm` · `low SpO₂` · `fall` | `poor ECG contact` · `low battery` | `BLE disconnect` · `packet corruption` · `packet loss` |

Recordings use the `.mesprec` format and replay at any speed, with seek and loop — **determinism + reproducibility + hardware-independent development**.

The **gateway** normalises `BleSource`, `SerialSource`, `ReplaySource` and `SimulatorSource` behind one async interface, forwards only valid frames, and tracks link state:

```mermaid
stateDiagram-v2
    direction LR
    [*] --> DISCONNECTED
    DISCONNECTED --> CONNECTING: equal-jitter<br/>exponential backoff
    CONNECTING --> CONNECTED
    CONNECTING --> DISCONNECTED: failed
    CONNECTED --> STREAMING: valid frames
    CONNECTED --> STALE: no valid frame
    CONNECTED --> DISCONNECTED
    STREAMING --> STALE: no valid frame<br/>for stale_after s
    STALE --> STREAMING: data resumes
    STREAMING --> DISCONNECTED: link lost
    STALE --> DISCONNECTED: timeout

    classDef off fill:#C62828,stroke:#B71C1C,color:#fff
    classDef mid fill:#F9A825,stroke:#F57F17,color:#000
    classDef on fill:#2E7D32,stroke:#1B5E20,color:#fff
    classDef stale fill:#E65100,stroke:#BF360C,color:#fff
    class DISCONNECTED off
    class CONNECTING,CONNECTED mid
    class STREAMING on
    class STALE stale
```

During API outages the WebSocket uplink keeps a **bounded drop-oldest backlog**, and a graceful shutdown sends `bye` so normal disconnects aren't mistaken for failures.

---

## 💾 Storage design

Raw physiological streams are **not** stored as one row per sample. Each stream is sliced into 1-second Float32 chunks:

```mermaid
%%{init: {"themeVariables": {"xyChart": {"plotColorPalette": "#E65100"}}}}%%
xychart-beta
    title "Raw-sample database writes per device per second"
    x-axis ["One row per sample", "1 s Float32 chunk per stream"]
    y-axis "rows / s" 0 --> 2200
    bar [2000, 3]
```

- ~2,000 raw samples/s/device → **3 rows/s** for the three primary streams — chosen deliberately instead of adding TimescaleDB ([ADR-004](docs/decisions/ADR-004-storage.md)).
- Range queries return **min/max envelopes**, so ECG peaks stay visible when zoomed out.
- Configurable retention; deleting a device cascades through sessions, samples, vitals and events.

## ⚡ Live console

```mermaid
flowchart LR
    WS["⚡ Live WebSocket"]:::a --> C["🔌 Live client<br/>state machine"]:::b --> RB["🧮 Float32 ring buffers<br/>(outside React state)"]:::c --> RAF["🎞️ requestAnimationFrame"]:::d --> DEC["📉 Per-pixel min/max<br/>decimation"]:::e --> CAN["🖼️ Canvas"]:::f

    classDef a fill:#00838F,stroke:#006064,color:#fff
    classDef b fill:#1565C0,stroke:#0D47A1,color:#fff
    classDef c fill:#6A1B9A,stroke:#4A148C,color:#fff
    classDef d fill:#E65100,stroke:#BF360C,color:#fff
    classDef e fill:#F9A825,stroke:#F57F17,color:#000
    classDef f fill:#2E7D32,stroke:#1B5E20,color:#fff
```

250 Hz ECG display with gap breaks, pause, zoom, pan, fullscreen and keyboard control. The UI models **six explicit data states** — `LIVE` · `STALE` · `DISCONNECTED` · `LOADING` · `ERROR` · `NO DATA` — so stale numbers are never shown as if they were current.

**Accessibility:** axe WCAG 2 A/AA checks in E2E, light + dark themes — **zero serious/critical violations** on the scanned pages; keyboard controls, reduced-motion support, responsive down to 390 px.

---

## 📈 Performance

Load tests on a **2-vCPU** x86_64 box: Python 3.13, PostgreSQL 16 and the load generator on the same machine, single API worker, synthetic `normal` scenario (~257 frames/s per device). Details: [`docs/testing/load-results.md`](docs/testing/load-results.md).

| Test | Result |
|---|---|
| **Max ingest** — 1 device pushes 60 s of data as fast as accepted | 15,436 frames in 2.42 s → **~6,400 frames/s**, 24.8× real time, **0 lost** |
| **8 devices**, real-time pace, 30 s | all 61,744 frames accounted for · p50 **31.9 ms** · worst p95 **176.5 ms** |
| **16 devices**, real-time pace, 30 s | all frames accounted for · p50 **41.3 ms** · worst p95 **336 ms** |
| **32 devices**, real-time pace, 30 s | all frames accounted for, but **saturated** · p50 5.6 s · p95 14.8 s |

```mermaid
%%{init: {"themeVariables": {"xyChart": {"plotColorPalette": "#1565C0, #C62828"}}}}%%
xychart-beta
    title "Ingest latency at real-time pace (ms) — 32 devices saturates"
    x-axis ["8 devices", "16 devices"]
    y-axis "ms" 0 --> 400
    bar [176.5, 336]
    line [31.9, 41.3]
```

<sub>🟦 bars = worst p95 · 🟥 line = p50</sub>

**Takeaway:** one API process sustains **~16 devices in real time with sub-second p95** on 2 vCPUs. The measured bottleneck is single-threaded Python DSP + per-second PostgreSQL inserts; the scale-out path (DSP workers, Redis/NATS fan-out) is in [ADR-003](docs/decisions/ADR-003-in-process-live-hub.md). Ingest latency excludes the BLE air interface, which is not yet measured.

---

## 🧪 Correctness & testing

**122 automated tests** — and they deliberately **cross process and language boundaries**.

```mermaid
pie showData
    title 122 automated tests by layer
    "Protocol · Python" : 35
    "API (SQLite + PostgreSQL)" : 25
    "Simulator" : 19
    "Web unit" : 11
    "Browser E2E" : 10
    "Gateway" : 9
    "Protocol · TypeScript" : 7
    "Replay" : 4
    "Cross-process integration" : 2
```

| Layer | What it proves | Count |
|---|---|---|
| Firmware conformance | Golden frames regenerated from the vendored `nrf_link.c` | 9 vectors |
| Protocol (Python) | CRC, every vector, encoder round-trip, chunking, resync, false sync, fuzz | 35 |
| Protocol (TypeScript) | Same vectors | 7 |
| Simulator | 10 scenarios valid, determinism, firmware batching/rates, loss/corruption/disconnect accounting | 19 |
| Replay | Format round-trip, truncation, real-time pacing, speed, seek, loop | 4 |
| Gateway | Ingest codec, link state machine, backoff, only-valid-frames forwarding | 9 |
| API | Auth, rate limit, RBAC, keys, end-to-end ingest, **every scenario raises its expected event**, exact loss counting, ack flow, live WS, exports, cascade delete — on **SQLite and PostgreSQL** | 25 |
| Integration | **Real uvicorn process + real `mesp-gateway` process** over WebSocket (sim and replay), graceful `bye` | 2 |
| Web unit | Ring buffer, live-client state machine, freshness mapping, components | 11 |
| Browser E2E | Demo draws, keyboard controls, scenario → event → ack → timeline, export labelling, **axe WCAG 2 A/AA**, mobile layout | 10 |

> All physiological expectations are tested against **simulated data**: they prove the pipeline computes what it was designed to compute on known inputs — not accuracy on real people.

---

## 🔐 Security & privacy

Physiological recordings become sensitive health data once they belong to real people, so they are treated as security assets alongside device keys, credentials, the JWT secret and the audit trail.

| Area | Controls |
|---|---|
| 🔑 Accounts | bcrypt hashing · IP + email sliding-window rate limits · short-lived HS256 JWTs in `sessionStorage` · server-side RBAC |
| 📟 Devices | Random 256-bit per-device ingest keys, stored only as SHA-256 hashes |
| ⚡ WebSocket | Token sent in a message, never in the URL · bounded live queues |
| 🧱 Input | Strict frame parsing · server-side CRC re-validation · Pydantic validation · upload size limits |
| 🌐 HTTP | Generic 500s · security headers · CSP in nginx |
| 📜 Accountability | Audit log (logins, user and device changes, key rotation, deletions, exports) · synthetic-data provenance through exports |
| 🕶️ Privacy | No names, dates of birth or identity fields required · configurable raw-data retention · cascading deletes |

**Documented gaps** ([threat model](docs/security/threat-model.md)): TLS terminates at a reverse proxy; no refresh tokens or server-side revocation; in-process rate limiting; no application-level encryption at rest; BLE uses an open Nordic UART Service without bonding.

---

## 🚀 Quick start

**Local development** (Python ≥ 3.11, Node.js; SQLite is enough for the demo):

```bash
make install
make dev-api      # API in demo mode on :8000 (SQLite)
make dev-web      # console on :5173 (proxies /api to :8000)
```

Open `http://localhost:5173` and choose **Explore the demo**.

**Docker** (PostgreSQL + API + nginx-served web):

```bash
cp .env.example .env     # set POSTGRES_PASSWORD, MESP_JWT_SECRET, MESP_ADMIN_EMAIL, MESP_ADMIN_PASSWORD
docker compose up --build -d
# → http://localhost:8080
```

**Real hardware** — set `NRF_LINK_ENABLED 1` in the MESP_lab firmware, flash the STM32 and the XIAO nRF52840 bridge, then:

```bash
mesp-gateway --source ble --ble-name MESP-Health \
  --api ws://<api-host>:8000/api/v1/ingest/ws --record session.mesprec

mesp-gateway --source serial --port /dev/ttyUSB0 --baud 1000000   # without the BLE bridge
mesp-gateway --source replay --file session.mesprec                # replay a recording
```

<details>
<summary><b>🧰 All developer commands</b></summary>

```bash
make install      # install everything
make vectors      # regenerate firmware conformance vectors
make lint
make test-py      # protocol · simulator · replay · gateway · API · integration
make test-web     # frontend unit tests
make test         # lint + test-py + test-web
make e2e          # Playwright browser E2E
make up / down    # docker compose
make load         # load test
```

</details>

**Deployment model:** static React frontend on Vercel + FastAPI on a container host (Render) with PostgreSQL — the API needs long-lived WebSockets and a background demo simulator, so it can't be serverless. Configs: `vercel.json`, `render.yaml`. No public instance has been deployed. Full guide: [`docs/deployment/README.md`](docs/deployment/README.md).

---

## 🗂️ Repository layout

```text
Mesp_platform/
├── apps/
│   ├── api/                    # FastAPI: ingest pipeline · DSP · events · REST · WebSocket
│   └── web/                    # React + TypeScript monitoring console
├── services/gateway/           # BLE / serial / replay / simulator gateway
├── packages/
│   ├── protocol/               # Python + TypeScript wire protocol + golden vectors
│   ├── firmware-harness/       # host build of the firmware's nrf_link.c
│   ├── types/                  # shared TypeScript types
│   └── ui/                     # design tokens
├── simulator/                  # byte-exact device simulator (10 scenarios)
├── replay/                     # .mesprec record / replay
├── database/                   # Alembic migrations
├── docker/                     # Dockerfiles + nginx
├── tests/                      # integration/ (real processes) · load/
└── docs/                       # architecture · protocol · decisions · security · testing · deployment · REPORT
```

## 📚 Documentation & decisions

| Topic | Doc | | ADR | Decision |
|---|---|---|---|---|
| Architecture | [overview](docs/architecture/overview.md) | | [001](docs/decisions/ADR-001-monorepo.md) | Monorepo |
| Timestamps | [timestamps](docs/architecture/timestamps.md) | | [002](docs/decisions/ADR-002-gateway-forwards-raw-frames.md) | Gateway forwards raw frames |
| Link protocol | [link-protocol-v1](docs/protocol/link-protocol-v1.md) | | [003](docs/decisions/ADR-003-in-process-live-hub.md) | In-process live hub |
| Ingest protocol | [ingest-protocol-v1](docs/protocol/ingest-protocol-v1.md) | | [004](docs/decisions/ADR-004-storage.md) | PostgreSQL chunk storage |
| Live WebSocket | [live-websocket-v1](docs/protocol/live-websocket-v1.md) | | [005](docs/decisions/ADR-005-timestamps.md) | Timestamp reconstruction |
| REST API | [api](docs/api/README.md) · [openapi.json](docs/api/openapi.json) | | [006](docs/decisions/ADR-006-rendering.md) | Canvas waveform rendering |
| Threat model | [threat-model](docs/security/threat-model.md) | | [007](docs/decisions/ADR-007-demo-mode.md) | Demo mode |
| Technical report | [REPORT](docs/REPORT.md) | | [008](docs/decisions/ADR-008-auth.md) | Authentication |

---

## 📋 Verified vs. not yet proven

| ✅ Verified | ⏳ Not yet measured / implemented |
|---|---|
| Firmware framing vectors match byte-for-byte | Clinical HR and SpO₂ accuracy |
| Python + TypeScript protocol conformance | Fall-detection sensitivity / specificity |
| 122 automated tests, Python on SQLite **and** PostgreSQL | BLE range and air-interface latency |
| Exact injected-loss accounting | Throughput under real RF conditions |
| Real-process gateway ↔ API integration | Battery gauge, skin temperature (not in firmware) |
| ~6,400 frames/s max ingest; 16 devices real time at p95 ≤ 336 ms | Public hosted instance |
| WCAG 2 A/AA automated checks, both themes | Multi-replica live hub |
| Synthetic-data provenance through exports | |

---

<div align="center">

### From a sensor pin to a browser pixel.

**If the system cannot explain where a number came from, when it was measured, whether data was lost, and whether it is synthetic — it should not pretend the number is trustworthy.**

<sub>MIT © Siddhant Singh · Not a medical device</sub>

</div>
