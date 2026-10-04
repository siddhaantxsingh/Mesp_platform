"""WebSocket endpoints.

/api/v1/ingest/ws  gateway -> API. Auth: ``X-Device-Key`` header. Binary = ingest batch v1,
                   text = JSON control ({"type": "hello" | "status" | "link" | "flush" | "bye"}).
                   "bye" announces a deliberate shutdown (no disconnect event is raised).
                   "flush" is answered with {"type": "flushed"} once all earlier messages are processed.
/api/v1/live/ws    API -> browser, protocol v1:
    client -> {"type": "auth", "token": "<JWT>"}            (must be first, within 5 s)
    client -> {"type": "subscribe", "device_id": "<id>"|"*"}
    client -> {"type": "pong"}
    server -> {"v":1,"type":"hello"|"ping"|"samples"|"vitals"|"event"|"event_ack"|"link"|"session", ...}
The token is sent in a message, not the URL, so it never lands in proxy/access logs.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from mesp_gateway import decode_batch
from mesp_gateway.ingest_codec import IngestDecodeError
from sqlalchemy import select

from .. import models
from ..context import AppContext
from ..deps import principal_from_token
from ..pipeline.ingest import IngestSession
from ..security import hash_key

router = APIRouter(prefix="/api/v1")
log = logging.getLogger("mesp.ws")


@router.websocket("/ingest/ws")
async def ingest_ws(ws: WebSocket) -> None:
    ctx: AppContext = ws.app.state.ctx
    key = ws.headers.get("x-device-key", "")
    device = None
    if key:
        async with ctx.db.session() as s:
            device = (await s.execute(select(models.Device).where(models.Device.key_hash == hash_key(key)))).scalar_one_or_none()
    if device is None:
        await ws.close(code=4401, reason="invalid device key")
        ctx.metrics.inc("ingest_rejected_messages_total")
        return
    if device.id in ctx.ingest:
        await ws.close(code=4409, reason="device already streaming")
        return
    await ws.accept()
    sess: IngestSession | None = None
    pending_ctrl: list[dict] = []
    expected_close = False
    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("text") is not None:
                try:
                    ctrl = json.loads(msg["text"])
                except json.JSONDecodeError:
                    ctx.metrics.inc("ingest_rejected_messages_total")
                    continue
                if ctrl.get("type") == "hello" and sess is None:
                    sess = IngestSession(ctx, device, source=str(ctrl.get("source", "gateway"))[:200],
                                         synthetic=bool(ctrl.get("synthetic")), realtime=bool(ctrl.get("realtime", True)))
                    await sess.start()
                    ctx.ingest[device.id] = sess
                    for c in pending_ctrl:
                        await sess.handle_control(c)
                    await ws.send_json({"type": "welcome", "session_id": sess.session_id, "device_id": device.id})
                elif ctrl.get("type") == "bye":
                    expected_close = True          # graceful gateway shutdown: no disconnect alarm
                elif ctrl.get("type") == "flush":
                    # barrier: everything sent before this has been processed (graceful gateway stop)
                    await ws.send_json({"type": "flushed", "stats": sess.public_stats() if sess else None})
                elif sess is None:
                    pending_ctrl.append(ctrl)
                else:
                    await sess.handle_control(ctrl)
            elif msg.get("bytes") is not None:
                if sess is None:
                    await ws.close(code=4400, reason="send hello first")
                    return
                try:
                    items = decode_batch(msg["bytes"])
                except IngestDecodeError:
                    ctx.metrics.inc("ingest_rejected_messages_total")
                    continue
                ctx.metrics.inc("ingest_batches_total")
                ctx.metrics.inc("ingest_frames_total", len(items))
                await sess.handle_batch(items)
    except WebSocketDisconnect:
        pass
    finally:
        if sess is not None:
            # shielded: the WebSocket task may be cancelled, but the session must be finalised
            await asyncio.shield(_finish(ctx, device.id, sess, expected_close))


async def _finish(ctx: AppContext, device_id: str, sess: IngestSession, expected: bool) -> None:
    try:
        await sess.close("gateway stopped" if expected else "gateway connection closed", expected=expected)
    finally:
        if ctx.ingest.get(device_id) is sess:
            ctx.ingest.pop(device_id, None)


@router.websocket("/live/ws")
async def live_ws(ws: WebSocket) -> None:
    ctx: AppContext = ws.app.state.ctx
    await ws.accept()
    try:
        first = await asyncio.wait_for(ws.receive_json(), timeout=5)
        if first.get("type") != "auth":
            raise ValueError
        principal = principal_from_token(ctx, str(first.get("token", "")))
    except Exception:  # noqa: BLE001 - any failure is an auth failure here
        await ws.close(code=4401, reason="authentication required")
        return
    ctx.metrics.inc("ws_live_connections_total")
    await ws.send_json({"v": 1, "type": "hello", "user": principal.email, "role": principal.role,
                        "server_time": time.time(), "devices_online": list(ctx.ingest)})
    subs: dict[str, asyncio.Queue[str]] = {}
    last_pong = time.monotonic()

    async def reader() -> None:
        nonlocal last_pong
        while True:
            m = await ws.receive_json()
            t = m.get("type")
            if t == "subscribe":
                dev = str(m.get("device_id", ""))[:64]
                if dev and dev not in subs:
                    subs[dev] = ctx.hub.subscribe(dev)
                    live = ctx.ingest.get(dev)
                    await ws.send_json({"v": 1, "type": "subscribed", "device_id": dev,
                                        "status": live.status() if live else None})  # type: ignore[attr-defined]
            elif t == "unsubscribe":
                q = subs.pop(str(m.get("device_id", "")), None)
                if q:
                    ctx.hub.unsubscribe(str(m.get("device_id")), q)
            elif t == "pong":
                last_pong = time.monotonic()

    async def writer() -> None:
        last_ping = time.monotonic()
        while True:
            sent = False
            for q in list(subs.values()):
                while not q.empty():
                    await ws.send_text(q.get_nowait())
                    sent = True
            now = time.monotonic()
            if now - last_ping > 15:
                await ws.send_json({"v": 1, "type": "ping", "server_time": time.time()})
                last_ping = now
            if now - last_pong > 45:
                await ws.close(code=4408, reason="heartbeat timeout")
                return
            if not sent:
                await asyncio.sleep(0.02)

    tasks = [asyncio.create_task(reader()), asyncio.create_task(writer())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()
        for dev, q in subs.items():
            ctx.hub.unsubscribe(dev, q)
