# ADR-004: PostgreSQL with 1-second sample chunks; TimescaleDB evaluated and deferred

**Status:** accepted

**Context.** Each device produces ~2 000 samples/s across streams (1 kHz ECG, 1 kHz IMU with 7 channels, 25 Hz PPG with 2). One row per sample means ~2 000 inserts/s per device and huge indexes.

**Options considered.**
1. Row per sample in a TimescaleDB hypertable: excellent time-bucket queries; needs the extension (not available on all managed Postgres plans), and the row overhead (~24 B header + index) dwarfs a 2-byte ECG sample.
2. **Chunk per stream per second** (`sample_chunks`: `t_start`, `sample_rate`, `n`, `channels`, little-endian float32 blob) in plain PostgreSQL.
3. Object storage (Parquet) plus a metadata DB: best for archives, too much machinery for a lab system.

**Decision.** Option 2 for raw samples, normal rows for 1 Hz `vitals`, `events` and the `audit_log`. Raw retention is configurable (`MESP_RAW_RETENTION_DAYS`).

**Consequences.** 3 inserts per device per second for raw data; range queries read only the chunks they need (index on `session_id, stream, t_start`); min/max-envelope decimation happens in the API. Runs on any PostgreSQL (and SQLite for tests). Losing per-sample SQL is acceptable: nobody queries individual ECG samples in SQL. If cross-session analytics over vitals grows, `vitals` is the natural candidate for a Timescale hypertable (time column `t`), and the schema allows that migration later.
