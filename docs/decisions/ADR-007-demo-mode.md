# ADR-007: Demo mode is a byte-exact device simulator on the real pipeline

**Status:** accepted

**Context.** The platform must be demonstrable without hardware, but a demo that bypasses the pipeline would prove nothing and could hide bugs.

**Decision.** The simulator synthesises signals and **frames them exactly as the firmware does** (same batching pattern, shared 8-bit sequence counter, CRC, `boot`/`stats` text lines), then applies link faults (loss, bit flips, disconnects) on the "radio". Scenarios are deterministic (seeded). Demo mode runs this through the real `Gateway` and `IngestSession`. Everything synthetic is flagged from the source (`hello.synthetic`) and labelled "DEMO MODE — SYNTHETIC DATA" / "SIMULATED DATA" in the UI, events and exports.

**Consequences.** All ten scenarios double as end-to-end tests: each asserts the events it should raise, and `normal` asserts none. The simulator's SpO₂ encoding uses the same empirical line as the decoder, so SpO₂ tests are circular **by design**: they test plumbing, not accuracy (stated wherever SpO₂ appears).
