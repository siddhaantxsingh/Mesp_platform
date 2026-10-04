# ADR-005: Reconstruct sample timestamps from nominal rates and host receive time

**Status:** accepted (until the firmware adds a device tick)

**Context.** The firmware frames carry no timestamps; frames arrive in bursts (BLE connection intervals, 64-byte bridge reads).

**Decision.** Per-stream `StreamClock`: anchor at `rx − n/fs`, then advance by exactly `n/fs`, with a slow correction toward the host clock (gain 0.005 per batch). Lateness above 0.35 s declares a gap and re-anchors; early data never moves time backwards. Details in `architecture/timestamps.md`.

**Consequences.** Uniform sample spacing (what the DSP needs), gaps detected and drawn as breaks, robust to bursty delivery. Absolute alignment between streams is approximate (bounded by delivery jitter, not yet measured on hardware). Recommended firmware change: append the HAL tick to the 1 Hz `stats` line, or add it to a v2 header; the profile/adapter mechanism supports either without breaking v1 devices.
