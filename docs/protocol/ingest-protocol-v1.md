# Ingest protocol v1 (gateway → API)

`wss://<api>/api/v1/ingest/ws`, header `X-Device-Key: <key>` (keys are created in the console, shown once, stored as SHA-256).

## Text messages (JSON)

| `type` | Direction | Purpose |
|---|---|---|
| `hello` | → | first message: `source`, `synthetic`, `realtime`, `ingest_version`, `gateway_version`. Opens a session. |
| `welcome` | ← | `session_id`, `device_id` |
| `link` | → | link state change: `from`, `to` (`connecting/connected/streaming/stale/disconnected`), `reason` |
| `status` | → | 1 Hz: link state, deframer stats (CRC errors etc.), frames forwarded |
| `flush` / `flushed` | → / ← | barrier: reply sent after everything before it was processed |
| `bye` | → | deliberate shutdown: the API ends the session without raising `device_disconnected` |

## Binary messages (batches)

```
uint8   version = 1
uint16  count                (little-endian, ≤ 4096)
count × { float64 rx_time | uint16 n | n bytes: one complete link frame (magic … CRC) }
```

The gateway sends frames **unmodified**; the API re-verifies every CRC and does all decoding, so it never trusts the gateway's parsing. `rx_time` is the gateway receive time (epoch seconds). For accelerated simulation or replays, `hello.realtime=false` and `rx_time` is recording time; latency is then not measured.

Close codes: `4401` bad key, `4409` device already streaming, `4400` binary before `hello`.
