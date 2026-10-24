"""The website's own connection (Connect by Bluetooth / USB cable) -> /api/v1/ingest/browser/ws,
and the wristband's on-device alerts (EVENT frames: fall, AFib-pattern screening)."""
import json
import time

import pytest
from conftest import login
from helpers import wait_closed
from mesp_gateway import encode_batch
from mesp_protocol import EVENT_FALL, EVENT_STROKE_RISK, FrameType, encode_event, encode_frame
from mesp_simulator import SimulatedDevice, get_scenario
from starlette.websockets import WebSocketDisconnect

URL = "/api/v1/ingest/browser/ws"
FALL_TEXT = "EVENT:FALL t=123456 ms impact=3.42 g freefall=310 ms still=2100 ms dOri=78 deg conf=87%"
AFIB_TEXT = ("EVENT:STROKE_RISK t=654321 ms AFib pattern suspected (score 72, 64 RR, mean 812 ms, RMSSD 143 ms, "
             "pNN50 61%, H 3.21, TPR 0.68) - screening only, not a stroke diagnosis")


def make_device(client, admin, name="Wrist #1"):
    r = client.post("/api/v1/devices", json={"name": name}, headers=admin)
    assert r.status_code == 201, r.text
    return r.json()


def token(h):
    return h["Authorization"].split(" ", 1)[1]


def closed_with(client, first: dict | None, code: int):
    with pytest.raises(WebSocketDisconnect) as e:
        with client.websocket_connect(URL) as ws:
            if first is not None:
                ws.send_text(json.dumps(first))
            ws.receive_json()
    assert e.value.code == code


def test_browser_link_requires_signed_in_operator(client, admin):
    d = make_device(client, admin)
    closed_with(client, {"type": "hello"}, 4401)                                      # no auth first
    closed_with(client, {"type": "auth", "token": "nope", "device_id": d["id"]}, 4401)
    demo = client.post("/api/v1/auth/demo").json()["access_token"]
    closed_with(client, {"type": "auth", "token": demo, "device_id": d["id"]}, 4403)    # demo visitors cannot stream
    client.post("/api/v1/users", json={"email": "v@example.com", "password": "viewer-pass-123", "role": "viewer"},
                headers=admin)
    viewer = login(client, "v@example.com", "viewer-pass-123")
    closed_with(client, {"type": "auth", "token": token(viewer), "device_id": d["id"]}, 4403)
    closed_with(client, {"type": "auth", "token": token(admin), "device_id": "missing"}, 4404)


def test_browser_stream_end_to_end_with_device_alerts(client, admin):
    d = make_device(client, admin)
    dev = SimulatedDevice(get_scenario("normal"), seed=7, loop=False)
    frames = dev.generate(12)
    base = time.time() - 20
    with client.websocket_connect(URL) as ws:
        ws.send_text(json.dumps({"type": "auth", "token": token(admin), "device_id": d["id"]}))
        assert ws.receive_json() == {"type": "authenticated", "device_id": d["id"], "device_name": "Wrist #1"}
        ws.send_text(json.dumps({"type": "hello", "source": "browser:bluetooth MESP-Health"}))
        welcome = ws.receive_json()
        assert welcome["type"] == "welcome"
        # a second browser cannot stream the same device at the same time
        with pytest.raises(WebSocketDisconnect) as e:
            with client.websocket_connect(URL) as ws2:
                ws2.send_text(json.dumps({"type": "auth", "token": token(admin), "device_id": d["id"]}))
                ws2.receive_json()
        assert e.value.code == 4409
        batch = [(base + f.t, f.data) for f in frames]
        seq = (frames[-1].data[4] + 1) & 0xFF
        batch.append((base + 6, encode_frame(FrameType.EVENT, seq, encode_event(EVENT_FALL, 87, FALL_TEXT))))
        batch.append((base + 7, encode_frame(FrameType.EVENT, (seq + 1) & 0xFF, encode_event(EVENT_STROKE_RISK, 72, AFIB_TEXT))))
        for i in range(0, len(batch), 200):
            ws.send_bytes(encode_batch(batch[i:i + 200]))
        ws.send_text(json.dumps({"type": "flush"}))
        stats = ws.receive_json()["stats"]
        ws.send_text(json.dumps({"type": "bye"}))
    wait_closed(client, welcome["session_id"])
    assert stats["frames_ok"] == len(batch) and stats["crc_errors"] == 0 and stats["lost_frames"] == 0
    s = client.get(f"/api/v1/sessions/{welcome['session_id']}", headers=admin).json()
    assert s["source"].startswith("browser:bluetooth") and s["synthetic"] is False
    ev = {e["code"]: e for e in client.get("/api/v1/events", params={"session_id": welcome["session_id"]},
                                           headers=admin).json()["items"]}
    fall, afib = ev["device_fall"], ev["device_afib_screen"]
    assert fall["severity"] == "CRITICAL" and "confidence 87%" in fall["detail"]
    assert fall["data"]["impact_g"] == 3.42 and fall["data"]["source"] == "device"
    assert afib["severity"] == "WARNING" and "not a diagnosis" in afib["detail"]
    assert afib["data"]["rr_count"] == 64
    audit = client.get("/api/v1/audit", headers=admin).json()
    audit = audit["items"] if isinstance(audit, dict) else audit
    assert any(a["action"] == "browser_stream_start" and a["target"] == d["id"] for a in audit)


def test_gateway_path_also_raises_device_alerts(client, admin):
    """The command-line gateway (device key) and the website share one pipeline."""
    d = make_device(client, admin)
    with client.websocket_connect("/api/v1/ingest/ws", headers={"X-Device-Key": d["ingest_key"]}) as ws:
        ws.send_text(json.dumps({"type": "hello", "source": "gateway:serial"}))
        sid = ws.receive_json()["session_id"]
        ws.send_bytes(encode_batch([(time.time(), encode_frame(FrameType.EVENT, 0, encode_event(EVENT_FALL, 64, "")))]))
        ws.send_text(json.dumps({"type": "flush"}))
        ws.receive_json()
        ws.send_text(json.dumps({"type": "bye"}))
    wait_closed(client, sid)
    codes = [e["code"] for e in client.get("/api/v1/events", params={"session_id": sid}, headers=admin).json()["items"]]
    assert "device_fall" in codes
