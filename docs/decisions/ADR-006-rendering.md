# ADR-006: Canvas + ring buffers for live waveforms, ECharts for history

**Status:** accepted

**Context.** Live ECG arrives at 250 points/s per trace after decimation, plus PPG and 4-channel IMU, and must scroll smoothly on laptops and phones. History views need zoom, tooltips and event markers over thousands of points.

**Decision.** Live: a custom `<canvas>` renderer reading `Float32Array` ring buffers kept **outside React state**, drawn in `requestAnimationFrame` with per-pixel min/max decimation, NaN gap breaks, eased auto-scaling and a time base interpolated between batches. React only re-renders at about 1 Hz (vitals). History: tree-shaken ECharts (line, bar, dataZoom, markLine), lazy-loaded, over server-side min/max envelopes.

**Consequences.** Live views stay at about 60 fps without per-sample React work. Reduced-motion users get batch-step updates instead of smooth scrolling. Charting-library features (tooltips etc.) are not available on the live canvas; they're available in History.
