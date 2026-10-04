# Security and privacy

## Assets
Physiological recordings (sensitive health data when real), device ingest keys, user credentials, the JWT signing secret, the audit trail.

## Controls implemented

| Threat | Control | Where |
|---|---|---|
| Credential stuffing / brute force | bcrypt (cost 12); sliding-window rate limit per IP+email (10/min); constant-time path for unknown emails | `security.py`, `routes/core.py` |
| Token theft | short-lived HS256 JWT (8 h default, 4 h for demo); stored in `sessionStorage`, not `localStorage`; live WS sends the token in a message, never the URL | `lib/auth.ts`, `routes/ws.py` |
| Rogue devices | per-device random 256-bit ingest key, stored as SHA-256, shown once, rotatable; one stream per device | `security.py`, `routes/ws.py` |
| Privilege escalation | roles viewer < operator < admin enforced server-side; admins cannot demote or disable themselves; demo tokens cannot register hardware, manage keys or acknowledge real events | `deps.py`, `routes/core.py` |
| Malformed input | strict frame parsing with CRC; ingest batch decoder with bounds checks; Pydantic models on REST; upload size cap (64 MB) | `mesp_protocol`, `ingest_codec.py` |
| Information leakage | generic 500 handler (no stack traces); `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Cache-Control: no-store`; CSP in nginx | `main.py`, `docker/nginx.conf` |
| Secrets in the repo | no secret has a default; production refuses to start without `MESP_JWT_SECRET`; `.env` ignored; `.env.example` holds placeholders only | `config.py`, `.gitignore` |
| Repudiation | audit log of logins (incl. failures), demo logins, exports, device create/rotate/delete, user changes, acknowledgements, scenario start/stop | `AuditLog` |
| Slow-consumer DoS on ingest | browsers get bounded queues (drop-oldest); ingest never blocks on them | `live.py` |
| Synthetic data mistaken for real | `synthetic` flag carried from the source through sessions, events and exports; banner, badges and file names say SIMULATED DATA | everywhere |

## Known gaps (not implemented)
- TLS termination is expected at a reverse proxy; the compose file serves HTTP on localhost only.
- No refresh tokens or server-side token revocation (logout is client-side; tokens expire).
- Rate limiting is in-process (per API instance).
- Data at rest is not encrypted by the application (use encrypted volumes).
- BLE link: the bridge uses an open Nordic UART Service with no pairing/bonding. Anyone in range can read the stream. Enabling LE Secure Connections bonding on the nRF52840 is a firmware task.
- No automated dependency scanning beyond CI builds.

## Privacy
- The platform stores no names, dates of birth or identifiers beyond the device name you choose.
- Raw samples are deleted after `MESP_RAW_RETENTION_DAYS` (default 14); derived vitals and events are kept until the session or device is deleted.
- Deleting a device deletes all its sessions, samples, vitals and events.
- Never load real health data into a demo-mode deployment that is reachable by others.
