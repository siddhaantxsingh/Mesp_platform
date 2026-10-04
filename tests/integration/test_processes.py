"""Cross-process integration: real uvicorn API + real mesp-gateway CLI over a real WebSocket.

    MESP_IT_DATABASE_URL=postgresql+asyncpg://... pytest tests/integration   (defaults to SQLite)
"""
import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

ADMIN = ("it-admin@example.com", "integration-pass-123")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def call(base, method, path, body=None, token=None):
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read() or b"null")


@pytest.fixture(scope="module")
def api(tmp_path_factory):
    port = free_port()
    db = os.getenv("MESP_IT_DATABASE_URL") or f"sqlite+aiosqlite:///{tmp_path_factory.mktemp('it')}/it.db"
    env = dict(os.environ, MESP_DATABASE_URL=db, MESP_JWT_SECRET="it-secret-" + "y" * 40, MESP_DEMO_MODE="false",
               MESP_ADMIN_EMAIL=ADMIN[0], MESP_ADMIN_PASSWORD=ADMIN[1], MESP_ENV="test")
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "mesp_api.main:app", "--port", str(port)], env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            if call(base, "GET", "/ready")["status"] == "ready":
                break
        except Exception:
            time.sleep(0.2)
    tok = call(base, "POST", "/api/v1/auth/login", {"email": ADMIN[0], "password": ADMIN[1]})["access_token"]
    yield base, port, tok
    proc.send_signal(signal.SIGINT)
    proc.wait(10)


def gateway(port, key, *args, seconds=None):
    p = subprocess.Popen([sys.executable, "-m", "mesp_gateway.cli", "--api", f"ws://127.0.0.1:{port}/api/v1/ingest/ws",
                          "--device-key", key, *args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if seconds:
        time.sleep(seconds)
        p.send_signal(signal.SIGTERM)
    out, _ = p.communicate(timeout=60)
    return p.returncode, out.decode()


def wait_session(base, tok, dev_id, timeout=20):
    t = time.time()
    while time.time() - t < timeout:
        items = call(base, "GET", f"/api/v1/sessions?device_id={dev_id}", token=tok)["items"]
        if items and items[0]["ended_at"]:
            return items[0]
        time.sleep(0.3)
    raise AssertionError("no closed session")


def test_simulator_gateway_process_to_api(api):
    base, port, tok = api
    dev = call(base, "POST", "/api/v1/devices", {"name": "IT sim"}, tok)
    rc, out = gateway(port, dev["ingest_key"], "--source", "sim", "--scenario", "normal", "--speed", "3", seconds=8)
    s = wait_session(base, tok, dev["id"])
    assert s["synthetic"] and s["stats"]["frames_ok"] > 3000, (s, out[-2000:])
    assert s["stats"]["crc_errors"] == 0 and s["stats"]["lost_frames"] == 0
    ev = call(base, "GET", f"/api/v1/events?session_id={s['id']}", token=tok)["items"]
    assert [e for e in ev if e["code"] == "device_disconnected"] == []   # graceful "bye"
    v = call(base, "GET", f"/api/v1/sessions/{s['id']}/vitals", token=tok)["items"]
    assert any(x["hr_ecg"] for x in v)


def test_replay_gateway_process_to_api(api, tmp_path):
    base, port, tok = api
    rec = tmp_path / "loss.mesprec"
    subprocess.run([sys.executable, "-m", "mesp_simulator.cli", "--scenario", "packet_loss", "--seconds", "12",
                    "--out", str(rec)], check=True, capture_output=True)
    dev = call(base, "POST", "/api/v1/devices", {"name": "IT replay"}, tok)
    rc, out = gateway(port, dev["ingest_key"], "--source", "replay", "--file", str(rec), "--speed", "6", "--once",
                      seconds=6)
    s = wait_session(base, tok, dev["id"])
    assert s["synthetic"], "synthetic flag must survive record -> replay"
    assert s["stats"]["lost_frames"] > 50 and s["stats"]["frames_ok"] > 2000, out[-2000:]
