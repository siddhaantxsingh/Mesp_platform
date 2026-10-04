# Live WebSocket v1 (API → browser)

`wss://<host>/api/v1/live/ws`. The token is sent **in the first message** (not the URL), so it never appears in access logs.

```
→ {"type":"auth","token":"<JWT>"}             within 5 s, else close 4401
← {"v":1,"type":"hello","user":…,"role":…,"devices_online":[…]}
→ {"type":"subscribe","device_id":"<id>"}     ("*" = all devices)
← {"v":1,"type":"subscribed","status":{…}}
← {"v":1,"type":"ping"}   → {"type":"pong"}   every 15 s; 45 s without pong → close 4408
```

| Server message | Content |
|---|---|
| `samples` / `ecg` | `t0`, `fs` (250 Hz), `gap`, `values[]`: 0.5–40 Hz + mains-notch filtered, causal, decimated from 1 kHz |
| `samples` / `ppg` | `t0`, `fs` (25 Hz), `red[]`, `ir[]` (raw codes), `pleth[]` (band-passed, inverted IR) |
| `samples` / `imu` | `t0`, `fs` (50 Hz), `accel[][3]` g, `gyro[][3]` °/s, `mag[]` |
| `vitals` | 1 Hz derived values + link ratios + session stats |
| `event`, `event_ack` | event objects |
| `link` | link state changes |
| `session` | `started` / `ended` |

`gap: true` means the timestamp reconstruction detected missing data before this block; clients must break the line, not interpolate. Slow clients have their oldest queued messages dropped (counted in `/metrics`); ingest is never blocked by a browser.

Client behaviour (`apps/web/src/lib/live/client.ts`): reconnect with exponential backoff and jitter (0.5 s → 15 s), re-subscribe after `hello`, close on 40 s of silence, stop on 4401.
