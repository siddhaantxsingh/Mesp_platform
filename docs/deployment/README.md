# Deployment

## 1. Local development (no Docker)

```bash
make install                 # Python packages (editable) + npm workspaces
make dev-api                 # API on :8000, SQLite, demo mode
make dev-web                 # console on :5173
```
Open http://localhost:5173 → **Explore the demo**.

## 2. Docker Compose (PostgreSQL)

```bash
cp .env.example .env         # set POSTGRES_PASSWORD, MESP_JWT_SECRET (openssl rand -base64 48), admin credentials
docker compose up --build -d # db + api (runs Alembic migrations) + web
open http://localhost:8080
```

## 3. Real hardware

1. Firmware (MESP_lab): set `NRF_LINK_ENABLED 1` in `app_config.h`; flash the STM32; flash `ble_uart_bridge.ino` to the XIAO nRF52840; wire USART1 + RTS/CTS as in the sketch header.
2. Console → Devices → **Pair device** → choose profile `mesp-lab-main-v1` (or the profile matching your presets) → copy the ingest key.
3. On a machine with Bluetooth:
   ```bash
   pip install -e packages/protocol/python -e replay -e "services/gateway[ble]"
   export MESP_DEVICE_KEY='mesp_dk_…'
   mesp-gateway --source ble --ble-name MESP-Health --api ws://<api-host>:8000/api/v1/ingest/ws --record session.mesprec
   ```
   Bench without the nRF: `--source serial --port /dev/ttyUSB0 --baud 1000000` with `NRF_UART_HWFC 0`.
4. BLE inside Docker needs the host's BlueZ: run the gateway container with `--net=host -v /var/run/dbus:/var/run/dbus`. Running the gateway natively is simpler.

`--record` keeps the raw byte stream; replay it later with `--source replay --file session.mesprec` or upload it on the Scenarios page.

## 4. Vercel (web) + Render (API + PostgreSQL)

Vercel hosts static sites and short-lived serverless functions. The API needs long-lived WebSockets, a background demo simulator and PostgreSQL, so it runs on a container host. The console then talks to it cross-origin.

1. **API on Render:** Render → New → Blueprint → select this repo (`render.yaml`). It creates `mesp-db` (PostgreSQL) and `mesp-api` (Docker). When prompted, set `MESP_ADMIN_EMAIL`, `MESP_ADMIN_PASSWORD` and `MESP_CORS_ORIGINS` (your Vercel URL, e.g. `https://mesp-platform.vercel.app`; plain, comma-separated or JSON list all work; edit it after step 2). Wait until `https://<name>.onrender.com/ready` returns `ready`.
2. **Web on Vercel:** Vercel → Add New → Project → import the repo. Keep **Root Directory** at the repo root (`vercel.json` sets install/build/output). Add the environment variable `VITE_API_URL=https://<name>.onrender.com`. Deploy.
3. Put the exact Vercel URL into `MESP_CORS_ORIGINS` on Render and redeploy the API.
4. Open the Vercel URL → **Explore the demo**.

Notes: Render's free web service sleeps after inactivity (first request takes ~1 min) and its free PostgreSQL expires after a limited period. Use paid plans or Fly.io/Railway for anything persistent. `MESP_DATABASE_URL` accepts `postgres://…` URLs; they are rewritten for asyncpg automatically.

## 5. Production checklist
- [ ] TLS reverse proxy in front of `web` (WebSocket upgrade for `/api/v1/live/ws` and `/api/v1/ingest/ws`).
- [ ] `MESP_ENV=production`, strong `MESP_JWT_SECRET`, `MESP_DEMO_MODE=false` when handling real data.
- [ ] Rotate the bootstrap admin password; create named users.
- [ ] Encrypted volume and backups for `db-data`; set `MESP_RAW_RETENTION_DAYS`.
- [ ] Scrape `/metrics`; alert on `/ready`.
- [ ] Single API replica (the live hub is in-process, see ADR-003).

> Public deployment: **not deployed by the author.** No hosted instance exists; claims about uptime or scale would be fabricated.
