import json

import pytest
from conftest import ADMIN, login
from helpers import stream_scenario
from mesp_protocol import encode_frame


def make_device(client, admin, name="Wrist #1"):
    r = client.post("/api/v1/devices", json={"name": name}, headers=admin)
    assert r.status_code == 201, r.text
    return r.json()


def test_health_ready_meta(client):
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/ready").json()["database"] == "ok"
    m = client.get("/api/v1/meta").json()
    assert "not a medical device" in m["disclaimer"] and m["protocol_version"] == 1
    assert "mesp_http_requests_total" in client.get("/metrics").text


def test_security_headers(client):
    h = client.get("/health").headers
    assert h["x-content-type-options"] == "nosniff" and h["x-frame-options"] == "DENY"


def test_auth_required_and_bad_login(client):
    assert client.get("/api/v1/devices").status_code == 401
    assert client.get("/api/v1/devices", headers={"Authorization": "Bearer nope"}).status_code == 401
    r = client.post("/api/v1/auth/login", json={"email": ADMIN[0], "password": "wrong-password"})
    assert r.status_code == 401
    r = client.post("/api/v1/auth/login", json={"email": "nobody@x.y", "password": "wrong-password"})
    assert r.status_code == 401


def test_login_rate_limit(settings):
    from fastapi.testclient import TestClient
    from mesp_api.main import create_app
    settings.login_rate_per_minute = 3
    with TestClient(create_app(settings)) as c:
        codes = [c.post("/api/v1/auth/login", json={"email": "a@b.c", "password": "x" * 12}).status_code for _ in range(5)]
    assert codes[:3] == [401, 401, 401] and codes[3:] == [429, 429]


def test_rbac(client, admin):
    r = client.post("/api/v1/users", json={"email": "viewer@example.com", "password": "viewer-pass-123", "role": "viewer"},
                    headers=admin)
    assert r.status_code == 201
    viewer = login(client, "viewer@example.com", "viewer-pass-123")
    assert client.get("/api/v1/devices", headers=viewer).status_code == 200
    assert client.post("/api/v1/devices", json={"name": "x"}, headers=viewer).status_code == 403
    assert client.get("/api/v1/users", headers=viewer).status_code == 403
    assert client.get("/api/v1/audit", headers=viewer).status_code == 403
    demo = {"Authorization": "Bearer " + client.post("/api/v1/auth/demo").json()["access_token"]}
    assert client.post("/api/v1/devices", json={"name": "x"}, headers=demo).status_code == 403


def test_device_key_shown_once_and_hashed(client, admin):
    d = make_device(client, admin)
    assert d["ingest_key"].startswith("mesp_dk_") and d["key_prefix"] == d["ingest_key"][:12]
    listed = client.get("/api/v1/devices", headers=admin).json()
    assert all("ingest_key" not in x for x in listed)
    r = client.post(f"/api/v1/devices/{d['id']}/rotate-key", headers=admin).json()
    assert r["ingest_key"] != d["ingest_key"]


def test_ingest_rejects_bad_key(client):
    with pytest.raises(Exception):
        with client.websocket_connect("/api/v1/ingest/ws", headers={"X-Device-Key": "mesp_dk_wrong"}) as ws:
            ws.receive_text()


def test_end_to_end_normal(client, admin):
    d = make_device(client, admin)
    sid, dev = stream_scenario(client, d["ingest_key"], "normal", 30)
    s = client.get(f"/api/v1/sessions/{sid}", headers=admin).json()
    assert s["synthetic"] is True and s["ended_at"] is not None
    st = s["stats"]
    assert st["frames_ok"] == dev.stats["frames"] and st["lost_frames"] == 0 and st["crc_errors"] == 0
    v = client.get(f"/api/v1/sessions/{sid}/vitals", headers=admin).json()["items"]
    hr = [x["hr_ecg"] for x in v if x["hr_ecg"]]
    sp = [x["spo2"] for x in v if x["spo2"]]
    assert len(v) >= 25 and 66 < sum(hr) / len(hr) < 78 and 95 < sum(sp) / len(sp) < 100
    ecg = client.get(f"/api/v1/sessions/{sid}/samples", params={"stream": "ecg", "max_points": 20000}, headers=admin).json()
    assert ecg["source_samples"] >= 29000 and ecg["channels"][0]["unit"].startswith("V")
    small = client.get(f"/api/v1/sessions/{sid}/samples", params={"stream": "ecg", "max_points": 500}, headers=admin).json()
    assert small["decimated"] and small["points"] <= 520
    # the R-peak maximum survives min/max decimation
    assert abs(max(v for v in small["channels"][0]["values"] if v is not None)
               - max(v for v in ecg["channels"][0]["values"] if v is not None)) < 1e-6
    imu = client.get(f"/api/v1/sessions/{sid}/samples", params={"stream": "imu", "max_points": 1000}, headers=admin).json()
    az = [x for x in imu["channels"][2]["values"] if x is not None]
    assert 0.95 < sum(az) / len(az) < 1.05   # gravity on z, in g
    a = client.get(f"/api/v1/analytics/sessions/{sid}", headers=admin).json()
    assert a["hr_agreement"]["n"] >= 10 and abs(a["hr_agreement"]["mean_diff_bpm"]) < 5


def test_export_labels_synthetic(client, admin):
    d = make_device(client, admin)
    sid, _ = stream_scenario(client, d["ingest_key"], "normal", 12)
    r = client.get(f"/api/v1/sessions/{sid}/export", params={"format": "csv", "stream": "vitals"}, headers=admin)
    assert r.status_code == 200 and r.text.startswith("# SIMULATED DATA") and "not a medical device" in r.text
    assert "_SIMULATED" in r.headers["content-disposition"]
    j = client.get(f"/api/v1/sessions/{sid}/export", params={"format": "json", "stream": "ecg"}, headers=admin).json()
    assert j["meta"]["synthetic"] is True and len(j["rows"]) > 10000 and "ecg_raw" in j["rows"][0]
    audit = client.get("/api/v1/audit", headers=admin).json()
    assert any(x["action"] == "export" for x in audit)


@pytest.mark.parametrize("scenario,seconds,code", [
    ("fall", 50, "fall_suspected"),
    ("poor_spo2", 90, "spo2_low"),
    ("irregular", 60, "rhythm_irregular"),
    ("poor_ecg", 50, "ecg_lead_off"),
    ("packet_loss", 30, "packet_loss"),
    ("corruption", 30, "crc_errors"),
    ("low_battery", 45, "battery_low"),
    ("exercise", 120, "hr_high"),
])
def test_scenarios_raise_expected_events(client, admin, scenario, seconds, code):
    d = make_device(client, admin, name=scenario)
    sid, dev = stream_scenario(client, d["ingest_key"], scenario, seconds)
    ev = client.get("/api/v1/events", params={"session_id": sid}, headers=admin).json()["items"]
    codes = {e["code"] for e in ev}
    assert code in codes, codes
    assert all(e["synthetic"] for e in ev)


def test_normal_raises_no_physiological_events(client, admin):
    d = make_device(client, admin)
    sid, _ = stream_scenario(client, d["ingest_key"], "normal", 60)
    ev = client.get("/api/v1/events", params={"session_id": sid}, headers=admin).json()["items"]
    assert [e["code"] for e in ev] == []


def test_packet_loss_counted_exactly(client, admin):
    d = make_device(client, admin)
    sid, dev = stream_scenario(client, d["ingest_key"], "packet_loss", 20)
    st = client.get(f"/api/v1/sessions/{sid}", headers=admin).json()["stats"]
    assert st["lost_frames"] == dev.stats["dropped"]


def test_corrupted_frames_rejected_server_side(client, admin):
    # bypass the gateway deframer: send a corrupted frame straight to the API
    import time

    from mesp_gateway import encode_batch
    d = make_device(client, admin)
    good = encode_frame(5, 0, b"\x08\x00" * 32)
    bad = bytearray(encode_frame(5, 1, b"\x08\x00" * 32)); bad[12] ^= 1
    with client.websocket_connect("/api/v1/ingest/ws", headers={"X-Device-Key": d["ingest_key"]}) as ws:
        ws.send_text(json.dumps({"type": "hello", "source": "test", "synthetic": True}))
        sid = ws.receive_json()["session_id"]
        ws.send_bytes(encode_batch([(time.time(), good), (time.time(), bytes(bad)), (time.time(), good)]))
        ws.send_bytes(b"\x09garbage")
        ws.send_text(json.dumps({"type": "flush"}))
        ws.receive_json()
    from helpers import wait_closed
    wait_closed(client, sid)
    st = client.get(f"/api/v1/sessions/{sid}", headers=admin).json()["stats"]
    assert st["frames_ok"] == 1 and st["crc_errors"] == 1 and st["duplicates"] == 1


def test_event_ack_flow(client, admin):
    d = make_device(client, admin)
    sid, _ = stream_scenario(client, d["ingest_key"], "fall", 50)
    ev = client.get("/api/v1/events", params={"session_id": sid, "acknowledged": False}, headers=admin).json()
    e = next(x for x in ev["items"] if x["code"] == "fall_suspected")
    assert e["severity"] == "CRITICAL" and e["stream"] == "imu"
    r = client.post(f"/api/v1/events/{e['id']}/ack", json={"note": "checked"}, headers=admin).json()
    assert r["acknowledged_by"] == ADMIN[0] and r["ack_note"] == "checked"
    left = client.get("/api/v1/events", params={"session_id": sid, "acknowledged": False}, headers=admin).json()
    assert all(x["id"] != e["id"] for x in left["items"])


def test_live_websocket(client, admin):
    tok = admin["Authorization"].split()[1]
    with client.websocket_connect("/api/v1/live/ws") as ws:
        ws.send_json({"type": "auth", "token": "bad"})
        with pytest.raises(Exception):
            ws.receive_json()
    d = make_device(client, admin)
    with client.websocket_connect("/api/v1/live/ws") as live:
        live.send_json({"type": "auth", "token": tok})
        assert live.receive_json()["type"] == "hello"
        live.send_json({"type": "subscribe", "device_id": d["id"]})
        assert live.receive_json()["type"] == "subscribed"
        stream_scenario(client, d["ingest_key"], "normal", 6)
        kinds = set()
        for _ in range(400):
            m = live.receive_json()
            kinds.add((m["type"], m.get("stream")))
            if {("samples", "ecg"), ("samples", "ppg"), ("samples", "imu"), ("vitals", None)} <= kinds:
                break
        assert ("samples", "ecg") in kinds and ("vitals", None) in kinds


def test_demo_controls(client, admin):
    sc = client.get("/api/v1/demo/scenarios", headers=admin).json()
    assert len(sc) == 10
    st = client.post("/api/v1/demo/start", json={"scenario": "normal", "speed": 4}, headers=admin).json()
    assert st["running"] and st["label"] == "DEMO MODE — SYNTHETIC DATA"
    devs = client.get("/api/v1/devices", headers=admin).json()
    assert any(x["simulated"] and x["online"] for x in devs)
    assert client.post("/api/v1/demo/stop", headers=admin).json()["running"] is False
    assert client.post("/api/v1/demo/start", json={"scenario": "nope"}, headers=admin).status_code == 422


def test_delete_device_cascades(client, admin):
    d = make_device(client, admin)
    sid, _ = stream_scenario(client, d["ingest_key"], "normal", 5)
    assert client.delete(f"/api/v1/devices/{d['id']}", headers=admin).status_code == 204
    assert client.get(f"/api/v1/sessions/{sid}", headers=admin).status_code == 404


def test_abrupt_gateway_loss_raises_disconnect(client, admin):
    d = make_device(client, admin)
    sid, _ = stream_scenario(client, d["ingest_key"], "normal", 5, graceful=False)
    ev = client.get("/api/v1/events", params={"session_id": sid}, headers=admin).json()["items"]
    assert [e["code"] for e in ev] == ["device_disconnected"]
