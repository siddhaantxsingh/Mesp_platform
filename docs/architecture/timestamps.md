# Timestamp reconstruction

The firmware sends no timestamps. Each stream (`ecg`, `ppg`, `imu`) gets a `StreamClock`:

- **Anchor:** first batch at `rx_time − n/fs` (the samples were acquired before the frame was sent).
- **Continue:** next batch starts where the previous ended (`n/fs` later), so sample spacing is exact at the nominal rate.
- **Drift:** `next_t += 0.005 · (observed − expected)` per batch, so the clock follows the host clock (absorbing crystal drift between STM32 and host) without jitter.
- **Gap:** if data arrives more than 0.35 s later than expected, a gap is declared, the clock re-anchors forward and the waveform breaks (`gap: true`).
- **Early data** (more than 0.35 s ahead) is counted as skew; the clock never moves backwards, so stored data never overlaps.

Limits (documented, not hidden): absolute time is only as good as BLE delivery latency, which is **not yet measured**; the inter-stream alignment (ECG vs PPG) is therefore approximate. A firmware change that adds a device tick to `TEXT stats` lines (or a v2 header field) would remove this limitation.
