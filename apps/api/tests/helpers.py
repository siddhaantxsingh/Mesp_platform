import json
import time

from mesp_gateway import encode_batch
from mesp_simulator import SimulatedDevice, get_scenario


def stream_scenario(client, key, scenario, seconds, synthetic=True, base=None, batch_s=0.05, seed=1234, graceful=True):
    """Push a simulated scenario through the real ingest WebSocket as fast as possible."""
    base = base or (time.time() - seconds - 5)
    dev = SimulatedDevice(get_scenario(scenario), seed=seed, loop=False)
    em = dev.generate(seconds)
    with client.websocket_connect("/api/v1/ingest/ws", headers={"X-Device-Key": key}) as ws:
        ws.send_text(json.dumps({"type": "hello", "source": f"test:{scenario}", "synthetic": synthetic}))
        welcome = ws.receive_json()
        ws.send_text(json.dumps({"type": "link", "from": "connecting", "to": "connected", "reason": "test"}))
        ws.send_text(json.dumps({"type": "link", "from": "connected", "to": "streaming", "reason": "test"}))
        batch, t_batch, was_up = [], None, True
        for e in em:
            up = dev.connected_at(e.t)
            if t_batch is None:
                t_batch = e.t
            if e.t - t_batch >= batch_s and batch:
                ws.send_bytes(encode_batch(batch))
                batch, t_batch = [], e.t
            batch.append((base + e.t, e.data))
            _ = up, was_up
        if batch:
            ws.send_bytes(encode_batch(batch))
        ws.send_text(json.dumps({"type": "status", "deframer": {"crc_errors": 0}}))
        ws.send_text(json.dumps({"type": "flush"}))
        assert ws.receive_json()["type"] == "flushed"
        if graceful:
            ws.send_text(json.dumps({"type": "bye"}))
    wait_closed(client, welcome["session_id"])
    return welcome["session_id"], dev


def wait_closed(client, sid, timeout=20.0):
    from conftest import login
    h = login(client)
    t = time.time()
    while time.time() - t < timeout:
        r = client.get(f"/api/v1/sessions/{sid}", headers=h)
        if r.status_code == 200 and r.json()["ended_at"]:
            return
        time.sleep(0.05)
    raise AssertionError("session did not close")
