"""Ingest load test against a running API.

    python tests/load/ingest_load.py --api http://127.0.0.1:8000 --email ... --password ... max --seconds 60
    python tests/load/ingest_load.py ... concurrent --devices 8 --seconds 30

max:        one device pushes N seconds of simulated data as fast as the API accepts it;
            reports frames/s and the real-time factor (how many devices' worth of data per core).
concurrent: N devices stream at real-time pace in parallel; reports the per-device ingest
            latency p50/p95 measured by the API and whether every frame was accounted for.
All data is SIMULATED. Results depend on the machine; record CPU/DB details with them.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import platform
import time
import urllib.request

import websockets
from mesp_gateway import encode_batch
from mesp_simulator import SimulatedDevice, get_scenario


def http(api, method, path, body=None, token=None):
    req = urllib.request.Request(api + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"null")


def batches(seconds: float, seed: int, base: float, batch_s=0.05):
    dev = SimulatedDevice(get_scenario("normal"), seed=seed, loop=True)
    em = dev.generate(seconds)
    # each batch is released when its LAST frame would have been received (like the gateway)
    out, cur, t0, t_last = [], [], None, 0.0
    for e in em:
        if t0 is None:
            t0 = e.t
        if e.t - t0 >= batch_s and cur:
            out.append((t_last, encode_batch(cur)))
            cur, t0 = [], e.t
        cur.append((base + e.t, e.data))
        t_last = e.t
    if cur:
        out.append((t_last, encode_batch(cur)))
    return out, len(em)


async def stream(ws_url, key, seconds, seed, paced):
    base = time.time() + 0.2 if paced else time.time() - seconds - 2
    bs, n_frames = batches(seconds, seed, base)
    async with websockets.connect(ws_url, additional_headers={"X-Device-Key": key}, max_size=2 ** 22) as ws:
        await ws.send(json.dumps({"type": "hello", "source": f"load:{seed}", "synthetic": True, "realtime": paced}))
        welcome = json.loads(await ws.recv())
        t_start = time.perf_counter()
        for t_rel, msg in bs:
            if paced:
                delay = (base + t_rel) - time.time()
                if delay > 0:
                    await asyncio.sleep(delay)
            await ws.send(msg)
        await ws.send(json.dumps({"type": "flush"}))
        while True:
            m = json.loads(await ws.recv())
            if m.get("type") == "flushed":
                break
        elapsed = time.perf_counter() - t_start
        await ws.send(json.dumps({"type": "bye"}))
    return welcome["session_id"], n_frames, elapsed


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--email", default=os.getenv("MESP_ADMIN_EMAIL"))
    ap.add_argument("--password", default=os.getenv("MESP_ADMIN_PASSWORD"))
    sub = ap.add_subparsers(dest="mode", required=True)
    m = sub.add_parser("max"); m.add_argument("--seconds", type=float, default=60)
    c = sub.add_parser("concurrent"); c.add_argument("--devices", type=int, default=8); c.add_argument("--seconds", type=float, default=30)
    a = ap.parse_args()
    tok = http(a.api, "POST", "/api/v1/auth/login", {"email": a.email, "password": a.password})["access_token"]
    ws_url = a.api.replace("http", "ws") + "/api/v1/ingest/ws"
    n = 1 if a.mode == "max" else a.devices
    keys = [http(a.api, "POST", "/api/v1/devices", {"name": f"load-{i}-{int(time.time())}"}, tok) for i in range(n)]
    res = await asyncio.gather(*[stream(ws_url, d["ingest_key"], a.seconds, 1000 + i, a.mode == "concurrent") for i, d in enumerate(keys)])
    await asyncio.sleep(1.5)
    report = {"mode": a.mode, "devices": n, "seconds_of_data": a.seconds, "machine": platform.platform(), "cpus": os.cpu_count(), "results": []}
    for (sid, frames, elapsed), d in zip(res, keys):
        st = http(a.api, "GET", f"/api/v1/sessions/{sid}", token=tok)["stats"]
        report["results"].append({"frames_sent": frames, "frames_ok": st.get("frames_ok"), "lost": st.get("lost_frames"),
                                  "elapsed_s": round(elapsed, 2), "frames_per_s": round(frames / elapsed),
                                  "realtime_factor": round(a.seconds / elapsed, 1),
                                  "latency_ms_p50": st.get("latency_ms_p50"), "latency_ms_p95": st.get("latency_ms_p95")})
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
