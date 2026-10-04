# REST API v1

Full schema: [`openapi.json`](openapi.json) (also served live at `/docs` and `/openapi.json`). Auth: `Authorization: Bearer <JWT>` from `POST /api/v1/auth/login`.

| Area | Endpoints | Role |
|---|---|---|
| System | `GET /health` (liveness), `GET /ready` (DB check, 503 when down), `GET /metrics` (Prometheus text), `GET /api/v1/meta` | public |
| Auth | `POST /auth/login`, `POST /auth/demo` (demo mode only → operator token flagged `demo`), `GET /auth/me` | public / any |
| Users | `GET/POST /users`, `PATCH /users/{id}` | admin |
| Devices | `GET/POST /devices`, `GET/DELETE /devices/{id}`, `POST /devices/{id}/rotate-key` | viewer / operator / admin |
| Sessions | `GET /sessions`, `GET/PATCH/DELETE /sessions/{id}`, `GET /sessions/{id}/vitals`, `GET /sessions/{id}/samples?stream=ecg|ppg|imu&t_from&t_to&max_points` | viewer (+ operator/admin to edit) |
| Export | `GET /sessions/{id}/export?stream=vitals|events|ecg|ppg|imu&format=csv|json` | viewer, audit-logged |
| Events | `GET /events?device_id&session_id&severity&acknowledged`, `POST /events/{id}/ack` | viewer / operator |
| Analytics | `GET /analytics/sessions/{id}`, `GET /analytics/devices/{id}/trend` | viewer |
| Demo | `GET /demo/scenarios`, `GET /demo/status`, `POST /demo/start`, `POST /demo/stop`, `POST /demo/replay` (upload `.mesprec`) | operator |
| Audit | `GET /audit` | admin |

`/samples` returns physical units where the conversion is known (ECG in volts at the ADC with mid-scale removed — the AD8232 module's total gain is not known, so it is **not** reported in mV; IMU in g and °/s; PPG in raw codes). Ranges longer than `max_points` are reduced to a min/max envelope, so peaks are never decimated away; gaps are `null`.

Exports carry the data label (`SIMULATED DATA` or device data), the device profile and the disclaimer; raw exports are limited to 30 min per file.
