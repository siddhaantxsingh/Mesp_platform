"""REST API v1: auth, users, devices, sessions, samples, events, analytics, export, demo, system."""
from __future__ import annotations

import csv
import io
import json
import os
import tempfile
import time

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import PlainTextResponse
from mesp_protocol import PROFILES, get_profile
from mesp_simulator import SCENARIOS
from sqlalchemy import and_, delete, func, select, text

from .. import DISCLAIMER, __version__, models
from ..context import AppContext
from ..deps import Principal, client_ip, current_user, get_ctx, require
from ..pipeline.ingest import clean, event_dict
from ..schemas import AckIn, DemoStartIn, DeviceIn, LoginIn, SessionPatch, TokenOut, UserIn, UserPatch
from ..security import hash_password, make_token, new_device_key, verify_or_dummy

router = APIRouter(prefix="/api/v1")
system = APIRouter()

MAX_SAMPLE_WINDOW_S = 1800


# ============================================================== system
@system.get("/health", tags=["system"])
async def health() -> dict:
    return {"status": "ok", "version": __version__}


@system.get("/ready", tags=["system"])
async def ready(ctx: AppContext = Depends(get_ctx)) -> Response:
    try:
        async with ctx.db.session() as s:
            await s.execute(text("SELECT 1"))
    except Exception as e:  # noqa: BLE001
        return Response(json.dumps({"status": "unavailable", "database": str(e.__class__.__name__)}),
                        status_code=503, media_type="application/json")
    return Response(json.dumps({"status": "ready", "database": "ok"}), media_type="application/json")


@system.get("/metrics", tags=["system"], response_class=PlainTextResponse)
async def metrics(ctx: AppContext = Depends(get_ctx)) -> str:
    lines = []
    for k, v in ctx.metrics.counters.items():
        lines += [f"# TYPE mesp_{k} counter", f"mesp_{k} {v}"]
    lines += ["# TYPE mesp_live_clients gauge", f"mesp_live_clients {ctx.hub.client_count}",
              "# TYPE mesp_live_dropped_messages_total counter", f"mesp_live_dropped_messages_total {ctx.hub.dropped}",
              "# TYPE mesp_active_ingest_sessions gauge", f"mesp_active_ingest_sessions {len(ctx.ingest)}",
              "# TYPE mesp_uptime_seconds gauge", f"mesp_uptime_seconds {time.time() - ctx.metrics.started:.0f}"]
    for dev, sess in ctx.ingest.items():
        st = sess.public_stats()  # type: ignore[attr-defined]
        for key in ("frames_ok", "crc_errors", "lost_frames", "duplicates"):
            lines.append(f'mesp_device_{key}_total{{device="{dev}"}} {st.get(key) or 0}')
        if st.get("latency_ms_p95") is not None:
            lines.append(f'mesp_device_ingest_latency_p95_ms{{device="{dev}"}} {st["latency_ms_p95"]}')
    return "\n".join(lines) + "\n"


@router.get("/meta", tags=["system"])
async def meta(ctx: AppContext = Depends(get_ctx)) -> dict:
    return {"version": __version__, "disclaimer": DISCLAIMER, "demo_mode": ctx.settings.demo_mode,
            "protocol_version": 1, "ingest_version": 1, "live_ws_version": 1,
            "profiles": [p.to_dict() for p in PROFILES.values()]}


# ============================================================== auth
@router.post("/auth/login", response_model=TokenOut, tags=["auth"])
async def login(body: LoginIn, request: Request, ctx: AppContext = Depends(get_ctx)) -> TokenOut:
    email = body.email.strip().lower()
    ip = client_ip(request)
    if not ctx.login_limiter.allow(f"{ip}|{email}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "too many login attempts; wait a minute")
    async with ctx.db.session() as s:
        u = (await s.execute(select(models.User).where(models.User.email == email))).scalar_one_or_none()
    ok = verify_or_dummy(body.password, u.password_hash if u else None)
    if not ok or u is None or u.disabled:
        await ctx.audit(email, "login_failed", ip=ip)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid email or password")
    await ctx.audit(email, "login", ip=ip)
    ttl = ctx.settings.jwt_ttl_minutes
    return TokenOut(access_token=make_token(ctx.jwt_secret, u.id, u.email, u.role, ttl), role=u.role, email=u.email,
                    expires_in=ttl * 60)


@router.post("/auth/demo", response_model=TokenOut, tags=["auth"])
async def demo_login(request: Request, ctx: AppContext = Depends(get_ctx)) -> TokenOut:
    if not ctx.settings.demo_mode:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "demo mode is disabled")
    if not ctx.login_limiter.allow(f"{client_ip(request)}|demo"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "too many requests")
    await ctx.audit("demo", "demo_login", ip=client_ip(request))
    ttl = min(ctx.settings.jwt_ttl_minutes, 240)
    # Demo visitors may run scenarios and acknowledge synthetic events, but not administer.
    return TokenOut(access_token=make_token(ctx.jwt_secret, "demo", "demo@mesp.local", "operator", ttl, demo=True),
                    role="operator", email="demo@mesp.local", demo=True, expires_in=ttl * 60)


@router.get("/auth/me", tags=["auth"])
async def me(p: Principal = Depends(current_user)) -> dict:
    return {"id": p.id, "email": p.email, "role": p.role, "demo": p.demo}


# ============================================================== users (admin)
def _user(u: models.User) -> dict:
    return {"id": u.id, "email": u.email, "role": u.role, "disabled": u.disabled, "created_at": u.created_at}


@router.get("/users", tags=["users"])
async def list_users(_: Principal = Depends(require("admin")), ctx: AppContext = Depends(get_ctx)) -> list[dict]:
    async with ctx.db.session() as s:
        return [_user(u) for u in (await s.execute(select(models.User).order_by(models.User.created_at))).scalars()]


@router.post("/users", status_code=201, tags=["users"])
async def create_user(body: UserIn, request: Request, p: Principal = Depends(require("admin")),
                      ctx: AppContext = Depends(get_ctx)) -> dict:
    async with ctx.db.session() as s:
        if (await s.execute(select(models.User).where(models.User.email == body.email.lower()))).first():
            raise HTTPException(409, "email already registered")
        u = models.User(email=body.email.lower(), password_hash=hash_password(body.password), role=body.role)
        s.add(u)
        await s.commit()
    await ctx.audit(p.email, "user_create", u.email, {"role": body.role}, client_ip(request))
    return _user(u)


@router.patch("/users/{user_id}", tags=["users"])
async def patch_user(user_id: str, body: UserPatch, request: Request, p: Principal = Depends(require("admin")),
                     ctx: AppContext = Depends(get_ctx)) -> dict:
    async with ctx.db.session() as s:
        u = await s.get(models.User, user_id)
        if not u:
            raise HTTPException(404, "user not found")
        if u.id == p.id and (body.role not in (None, "admin") or body.disabled):
            raise HTTPException(400, "you cannot demote or disable yourself")
        if body.role is not None:
            u.role = body.role
        if body.disabled is not None:
            u.disabled = body.disabled
        await s.commit()
    await ctx.audit(p.email, "user_update", u.email, body.model_dump(exclude_none=True), client_ip(request))
    return _user(u)


# ============================================================== devices
def _device(d: models.Device, ctx: AppContext) -> dict:
    live = ctx.ingest.get(d.id)
    return clean({"id": d.id, "name": d.name, "profile_id": d.profile_id, "profile": get_profile(d.profile_id).to_dict(),
                  "key_prefix": d.key_prefix, "simulated": d.simulated, "firmware": d.firmware,
                  "created_at": d.created_at, "last_seen": d.last_seen,
                  "online": live is not None, "live": live.status() if live else None})  # type: ignore[attr-defined]


@router.get("/devices", tags=["devices"])
async def list_devices(_: Principal = Depends(current_user), ctx: AppContext = Depends(get_ctx)) -> list[dict]:
    async with ctx.db.session() as s:
        rows = (await s.execute(select(models.Device).order_by(models.Device.created_at))).scalars().all()
    return [_device(d, ctx) for d in rows]


@router.post("/devices", status_code=201, tags=["devices"])
async def create_device(body: DeviceIn, request: Request, p: Principal = Depends(require("operator")),
                        ctx: AppContext = Depends(get_ctx)) -> dict:
    if body.profile_id not in PROFILES:
        raise HTTPException(422, f"unknown profile; choose from {', '.join(PROFILES)}")
    if p.demo:
        raise HTTPException(403, "demo accounts cannot register hardware")
    key, kh, prefix = new_device_key()
    async with ctx.db.session() as s:
        d = models.Device(name=body.name, profile_id=body.profile_id, key_hash=kh, key_prefix=prefix, created_by=p.id)
        s.add(d)
        await s.commit()
    await ctx.audit(p.email, "device_create", d.id, {"name": d.name}, client_ip(request))
    return _device(d, ctx) | {"ingest_key": key, "ingest_key_note": "Shown once. Store it in the gateway's environment."}


@router.get("/devices/{device_id}", tags=["devices"])
async def get_device(device_id: str, _: Principal = Depends(current_user), ctx: AppContext = Depends(get_ctx)) -> dict:
    async with ctx.db.session() as s:
        d = await s.get(models.Device, device_id)
    if not d:
        raise HTTPException(404, "device not found")
    return _device(d, ctx)


@router.post("/devices/{device_id}/rotate-key", tags=["devices"])
async def rotate_key(device_id: str, request: Request, p: Principal = Depends(require("operator")),
                     ctx: AppContext = Depends(get_ctx)) -> dict:
    if p.demo:
        raise HTTPException(403, "demo accounts cannot manage keys")
    key, kh, prefix = new_device_key()
    async with ctx.db.session() as s:
        d = await s.get(models.Device, device_id)
        if not d:
            raise HTTPException(404, "device not found")
        d.key_hash, d.key_prefix = kh, prefix
        await s.commit()
    await ctx.audit(p.email, "device_rotate_key", device_id, {}, client_ip(request))
    return {"id": device_id, "key_prefix": prefix, "ingest_key": key}


@router.delete("/devices/{device_id}", status_code=204, tags=["devices"])
async def delete_device(device_id: str, request: Request, p: Principal = Depends(require("admin")),
                        ctx: AppContext = Depends(get_ctx)) -> Response:
    if device_id in ctx.ingest:
        raise HTTPException(409, "device is streaming; stop it first")
    async with ctx.db.session() as s:
        sids = [r for r in (await s.execute(select(models.Session.id).where(models.Session.device_id == device_id))).scalars()]
        for model in (models.SampleChunk, models.Vital):
            await s.execute(delete(model).where(model.session_id.in_(sids)))
        await s.execute(delete(models.Event).where(models.Event.device_id == device_id))
        await s.execute(delete(models.Session).where(models.Session.device_id == device_id))
        res = await s.execute(delete(models.Device).where(models.Device.id == device_id))
        await s.commit()
    if not res.rowcount:
        raise HTTPException(404, "device not found")
    await ctx.audit(p.email, "device_delete", device_id, {"sessions": len(sids)}, client_ip(request))
    return Response(status_code=204)


# ============================================================== sessions
def _session(r: models.Session, device_name: str | None = None) -> dict:
    dur = (r.ended_at or time.time()) - r.started_at
    return clean({"id": r.id, "device_id": r.device_id, "device_name": device_name, "started_at": r.started_at,
                  "ended_at": r.ended_at, "duration_s": dur, "active": r.ended_at is None, "source": r.source,
                  "synthetic": r.synthetic, "profile_id": r.profile_id, "firmware": r.firmware,
                  "protocol_version": r.protocol_version, "label": r.label, "stats": r.stats or {}})


@router.get("/sessions", tags=["sessions"])
async def list_sessions(device_id: str | None = None, synthetic: bool | None = None, limit: int = Query(50, le=500),
                        offset: int = 0, _: Principal = Depends(current_user), ctx: AppContext = Depends(get_ctx)) -> dict:
    q = select(models.Session, models.Device.name).join(models.Device, models.Device.id == models.Session.device_id)
    if device_id:
        q = q.where(models.Session.device_id == device_id)
    if synthetic is not None:
        q = q.where(models.Session.synthetic.is_(synthetic))
    async with ctx.db.session() as s:
        total = (await s.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
        rows = (await s.execute(q.order_by(models.Session.started_at.desc()).limit(limit).offset(offset))).all()
    return {"total": total, "items": [_session(r, n) for r, n in rows]}


async def _get_session(ctx: AppContext, session_id: str) -> models.Session:
    async with ctx.db.session() as s:
        r = await s.get(models.Session, session_id)
    if not r:
        raise HTTPException(404, "session not found")
    return r


@router.get("/sessions/{session_id}", tags=["sessions"])
async def get_session(session_id: str, _: Principal = Depends(current_user), ctx: AppContext = Depends(get_ctx)) -> dict:
    r = await _get_session(ctx, session_id)
    async with ctx.db.session() as s:
        dev = await s.get(models.Device, r.device_id)
        bounds = (await s.execute(select(func.min(models.SampleChunk.t_start), func.max(models.SampleChunk.t_start))
                                  .where(models.SampleChunk.session_id == session_id))).one()
        n_events = (await s.execute(select(func.count()).where(models.Event.session_id == session_id))).scalar_one()
    out = _session(r, dev.name if dev else None)
    out["data_start"], out["data_end"] = bounds[0], (bounds[1] + 1.0 if bounds[1] else None)
    out["event_count"] = n_events
    return out


@router.patch("/sessions/{session_id}", tags=["sessions"])
async def patch_session(session_id: str, body: SessionPatch, p: Principal = Depends(require("operator")),
                        ctx: AppContext = Depends(get_ctx)) -> dict:
    async with ctx.db.session() as s:
        r = await s.get(models.Session, session_id)
        if not r:
            raise HTTPException(404, "session not found")
        r.label = body.label
        await s.commit()
    return _session(r)


@router.delete("/sessions/{session_id}", status_code=204, tags=["sessions"])
async def delete_session(session_id: str, request: Request, p: Principal = Depends(require("admin")),
                         ctx: AppContext = Depends(get_ctx)) -> Response:
    r = await _get_session(ctx, session_id)
    if r.ended_at is None:
        raise HTTPException(409, "session is still recording")
    async with ctx.db.session() as s:
        for model in (models.SampleChunk, models.Vital, models.Event):
            await s.execute(delete(model).where(model.session_id == session_id))
        await s.execute(delete(models.Session).where(models.Session.id == session_id))
        await s.commit()
    await ctx.audit(p.email, "session_delete", session_id, {}, client_ip(request))
    return Response(status_code=204)


STREAMS = {
    # name: (channels, labels, units, converter(profile, array) -> array)
    "ecg": (["ecg"], ["V at ADC (mid-scale removed)"]),
    "ppg": (["red", "ir"], ["ADC code", "ADC code"]),
    "imu": (["ax", "ay", "az", "imu_temp", "gx", "gy", "gz"], ["g", "g", "g", "°C (die)", "dps", "dps", "dps"]),
}


def _convert(stream: str, prof, a: np.ndarray) -> np.ndarray:
    if stream == "ecg":
        return (a - (2 ** prof.ecg_adc_bits) / 2) * prof.ecg_vref / (2 ** prof.ecg_adc_bits - 1)
    if stream == "imu":
        out = a.astype(np.float64).copy()
        out[:, 0:3] /= prof.accel_lsb_per_g
        out[:, 3] = out[:, 3] / 326.8 + 25.0
        out[:, 4:7] /= prof.gyro_lsb_per_dps
        return out
    return a


async def _load_runs(ctx: AppContext, session_id: str, stream: str, t_from: float, t_to: float):
    async with ctx.db.session() as s:
        rows = (await s.execute(select(models.SampleChunk).where(
            models.SampleChunk.session_id == session_id, models.SampleChunk.stream == stream,
            models.SampleChunk.t_start < t_to, models.SampleChunk.t_start > t_from - 5.0)
            .order_by(models.SampleChunk.t_start))).scalars().all()
    runs: list[tuple[float, float, np.ndarray]] = []
    for c in rows:
        a = np.frombuffer(c.data, dtype="<f4").reshape(c.n, c.channels)
        t = c.t_start + np.arange(c.n) / c.sample_rate
        m = (t >= t_from) & (t < t_to)
        if not m.any():
            continue
        a, t0 = a[m], float(t[m][0])
        if runs and abs(runs[-1][0] + len(runs[-1][2]) / runs[-1][1] - t0) < 1.5 / c.sample_rate:
            runs[-1] = (runs[-1][0], runs[-1][1], np.concatenate([runs[-1][2], a]))
        else:
            runs.append((t0, c.sample_rate, a))
    return runs


@router.get("/sessions/{session_id}/samples", tags=["sessions"])
async def samples(session_id: str, stream: str = Query(..., pattern="^(ecg|ppg|imu)$"), t_from: float | None = None,
                  t_to: float | None = None, max_points: int = Query(2000, ge=100, le=20000),
                  _: Principal = Depends(current_user), ctx: AppContext = Depends(get_ctx)) -> dict:
    """Samples in physical units where the conversion is known. Long ranges are reduced to a
    min/max envelope (2 points per bucket) so peaks are never hidden by decimation. Gaps are
    returned as null values between runs."""
    r = await _get_session(ctx, session_id)
    prof = get_profile(r.profile_id)
    t_from = t_from if t_from is not None else r.started_at - 60
    t_to = t_to if t_to is not None else (r.ended_at or time.time()) + 60
    if t_to - t_from > 6 * 3600:
        raise HTTPException(422, "range too long (max 6 h)")
    runs = await _load_runs(ctx, session_id, stream, t_from, t_to)
    names, units = STREAMS[stream]
    total = sum(len(a) for _, _, a in runs)
    per_run_budget = max_points / max(1, total)
    t_out: list[float | None] = []
    cols: list[list[float | None]] = [[] for _ in names]
    decimated = False
    for i, (t0, fs, a) in enumerate(runs):
        if i:
            t_out.append(None)
            for c in cols:
                c.append(None)
        a = _convert(stream, prof, a)
        n = len(a)
        k = int(n * per_run_budget)
        if k >= n or n < 4:
            t = t0 + np.arange(n) / fs
            t_out += np.round(t, 4).tolist()
            for j, c in enumerate(cols):
                c += np.round(a[:, j], 5).tolist()
            continue
        decimated = True
        buckets = max(1, k // 2)
        edges = np.linspace(0, n, buckets + 1).astype(int)
        for b0, b1 in zip(edges[:-1], edges[1:]):
            if b1 <= b0:
                continue
            seg = a[b0:b1]
            lo, hi = int(np.argmin(seg[:, 0])), int(np.argmax(seg[:, 0]))
            for idx in sorted({lo, hi}):
                t_out.append(round(t0 + (b0 + idx) / fs, 4))
                for j, c in enumerate(cols):
                    c.append(round(float(seg[idx, j]), 5))
    return {"session_id": session_id, "stream": stream, "synthetic": r.synthetic, "t_from": t_from, "t_to": t_to,
            "decimated": decimated, "points": len(t_out), "source_samples": total, "t": t_out,
            "channels": [{"name": n, "unit": u, "values": c} for n, u, c in zip(names, units, cols)]}


VITAL_FIELDS = ("t", "hr_ecg", "hr_ppg", "spo2", "rr_ms", "rr_irregularity", "ecg_quality", "ppg_quality",
                "perfusion_index", "motion_g", "activity", "roll_deg", "pitch_deg", "imu_temp_c", "battery_soc",
                "skin_temp_c")


@router.get("/sessions/{session_id}/vitals", tags=["sessions"])
async def vitals(session_id: str, t_from: float | None = None, t_to: float | None = None,
                 _: Principal = Depends(current_user), ctx: AppContext = Depends(get_ctx)) -> dict:
    r = await _get_session(ctx, session_id)
    q = select(models.Vital).where(models.Vital.session_id == session_id)
    if t_from is not None:
        q = q.where(models.Vital.t >= t_from)
    if t_to is not None:
        q = q.where(models.Vital.t < t_to)
    async with ctx.db.session() as s:
        rows = (await s.execute(q.order_by(models.Vital.t).limit(50000))).scalars().all()
    return {"session_id": session_id, "synthetic": r.synthetic,
            "items": [clean({k: getattr(v, k) for k in VITAL_FIELDS}) for v in rows]}


# ============================================================== export
@router.get("/sessions/{session_id}/export", tags=["export"])
async def export(session_id: str, request: Request, format: str = Query("csv", pattern="^(csv|json)$"),
                 stream: str = Query("vitals", pattern="^(vitals|events|ecg|ppg|imu)$"),
                 t_from: float | None = None, t_to: float | None = None,
                 p: Principal = Depends(current_user), ctx: AppContext = Depends(get_ctx)) -> Response:
    r = await _get_session(ctx, session_id)
    label = "SIMULATED DATA" if r.synthetic else "DEVICE DATA (engineering prototype)"
    header = {"session_id": r.id, "device_id": r.device_id, "source": r.source, "synthetic": r.synthetic,
              "data_label": label, "profile": get_profile(r.profile_id).to_dict(), "exported_at": time.time(),
              "exported_by": p.email, "disclaimer": DISCLAIMER, "time_base": "UTC epoch seconds"}
    rows: list[dict]
    if stream == "vitals":
        rows = (await vitals(session_id, t_from, t_to, p, ctx))["items"]
    elif stream == "events":
        async with ctx.db.session() as s:
            evs = (await s.execute(select(models.Event).where(models.Event.session_id == session_id)
                                   .order_by(models.Event.t))).scalars().all()
        rows = [{k: v for k, v in event_dict(e).items() if k != "data"} for e in evs]
    else:
        t_from = t_from if t_from is not None else r.started_at - 60
        t_to = t_to if t_to is not None else min((r.ended_at or time.time()) + 60, t_from + MAX_SAMPLE_WINDOW_S)
        if t_to - t_from > MAX_SAMPLE_WINDOW_S + 120:
            raise HTTPException(422, f"raw export window is limited to {MAX_SAMPLE_WINDOW_S // 60} min per file")
        prof = get_profile(r.profile_id)
        names, _units = STREAMS[stream]
        rows = []
        for t0, fs, a in await _load_runs(ctx, session_id, stream, t_from, t_to):
            conv = _convert(stream, prof, a)
            for i in range(len(a)):
                row = {"t": round(t0 + i / fs, 6)}
                for j, n in enumerate(names):
                    row[f"{n}_raw"] = float(a[i, j])
                    if stream != "ppg":
                        row[n] = round(float(conv[i, j]), 6)
                rows.append(row)
    await ctx.audit(p.email, "export", session_id, {"format": format, "stream": stream, "rows": len(rows)},
                    client_ip(request))
    fname = f"mesp_{session_id[:8]}_{stream}{'_SIMULATED' if r.synthetic else ''}.{format}"
    disp = {"Content-Disposition": f'attachment; filename="{fname}"'}
    if format == "json":
        return Response(json.dumps({"meta": header, "rows": rows}, allow_nan=False), media_type="application/json",
                        headers=disp)
    buf = io.StringIO()
    buf.write(f"# {label}\n# {DISCLAIMER}\n# session={r.id} source={r.source} profile={r.profile_id} time=UTC epoch s\n")
    if rows:
        w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    return Response(buf.getvalue(), media_type="text/csv", headers=disp)


# ============================================================== events
@router.get("/events", tags=["events"])
async def list_events(device_id: str | None = None, session_id: str | None = None, severity: str | None = None,
                      acknowledged: bool | None = None, t_from: float | None = None, t_to: float | None = None,
                      limit: int = Query(100, le=1000), offset: int = 0, _: Principal = Depends(current_user),
                      ctx: AppContext = Depends(get_ctx)) -> dict:
    conds = []
    if device_id:
        conds.append(models.Event.device_id == device_id)
    if session_id:
        conds.append(models.Event.session_id == session_id)
    if severity:
        conds.append(models.Event.severity.in_([s.strip().upper() for s in severity.split(",")]))
    if acknowledged is not None:
        conds.append(models.Event.acknowledged_at.is_not(None) if acknowledged else models.Event.acknowledged_at.is_(None))
    if t_from is not None:
        conds.append(models.Event.t >= t_from)
    if t_to is not None:
        conds.append(models.Event.t < t_to)
    where = and_(*conds) if conds else True
    async with ctx.db.session() as s:
        total = (await s.execute(select(func.count()).select_from(models.Event).where(where))).scalar_one()
        rows = (await s.execute(select(models.Event).where(where).order_by(models.Event.t.desc())
                                .limit(limit).offset(offset))).scalars().all()
        unacked = dict((await s.execute(select(models.Event.severity, func.count()).where(
            models.Event.acknowledged_at.is_(None)).group_by(models.Event.severity))).all())
    return {"total": total, "unacknowledged": {k: unacked.get(k, 0) for k in ("INFO", "WARNING", "CRITICAL")},
            "items": [event_dict(e) for e in rows]}


@router.post("/events/{event_id}/ack", tags=["events"])
async def ack_event(event_id: str, body: AckIn, request: Request, p: Principal = Depends(require("operator")),
                    ctx: AppContext = Depends(get_ctx)) -> dict:
    async with ctx.db.session() as s:
        e = await s.get(models.Event, event_id)
        if not e:
            raise HTTPException(404, "event not found")
        if p.demo and not e.synthetic:
            raise HTTPException(403, "demo accounts can only acknowledge synthetic events")
        if e.acknowledged_at is None:
            e.acknowledged_at, e.acknowledged_by, e.ack_note = time.time(), p.email, body.note
            await s.commit()
    await ctx.audit(p.email, "event_ack", event_id, {"code": e.code, "note": body.note}, client_ip(request))
    d = event_dict(e)
    ctx.publish(e.device_id, {"type": "event_ack", "event": d})
    return d


# ============================================================== analytics
def _stats(vals: list[float]) -> dict | None:
    if not vals:
        return None
    a = np.asarray(vals)
    return {"n": int(a.size), "min": float(a.min()), "mean": float(a.mean()), "max": float(a.max()),
            "p05": float(np.percentile(a, 5)), "p50": float(np.median(a)), "p95": float(np.percentile(a, 95))}


@router.get("/analytics/sessions/{session_id}", tags=["analytics"])
async def session_analytics(session_id: str, _: Principal = Depends(current_user),
                            ctx: AppContext = Depends(get_ctx)) -> dict:
    r = await _get_session(ctx, session_id)
    items = (await vitals(session_id, None, None, _, ctx))["items"]
    col = lambda k: [v[k] for v in items if v.get(k) is not None]  # noqa: E731
    hist = None
    sp = col("spo2")
    if sp:
        counts, edges = np.histogram(sp, bins=np.arange(80, 101, 1))
        hist = {"edges": edges.tolist(), "counts": counts.tolist()}
    act: dict[str, int] = {}
    for a in col("activity"):
        act[a] = act.get(a, 0) + 1
    q_e: dict[str, int] = {}
    for a in col("ecg_quality"):
        q_e[a] = q_e.get(a, 0) + 1
    q_p: dict[str, int] = {}
    for a in col("ppg_quality"):
        q_p[a] = q_p.get(a, 0) + 1
    async with ctx.db.session() as s:
        ev = dict((await s.execute(select(models.Event.code, func.count()).where(models.Event.session_id == session_id)
                                   .group_by(models.Event.code))).all())
    st = r.stats or {}
    frames, lost, crc = st.get("frames_ok") or 0, st.get("lost_frames") or 0, st.get("crc_errors") or 0
    total = frames + lost + crc
    hr_pair = [(v["hr_ecg"], v["hr_ppg"]) for v in items if v.get("hr_ecg") and v.get("hr_ppg")]
    agreement = None
    if len(hr_pair) >= 10:
        d = np.array([a - b for a, b in hr_pair])
        agreement = {"n": len(hr_pair), "mean_diff_bpm": float(d.mean()), "sd_diff_bpm": float(d.std()),
                     "note": "ECG-derived vs PPG-derived HR from the same device (internal consistency only)"}
    return clean({"session_id": session_id, "synthetic": r.synthetic, "seconds_with_vitals": len(items),
                  "hr_ecg": _stats(col("hr_ecg")), "hr_ppg": _stats(col("hr_ppg")), "spo2": _stats(sp),
                  "spo2_histogram": hist, "rr_irregularity": _stats(col("rr_irregularity")),
                  "motion_g": _stats(col("motion_g")), "activity_seconds": act, "ecg_quality_seconds": q_e,
                  "ppg_quality_seconds": q_p, "hr_agreement": agreement, "event_counts": ev,
                  "link": {"frames_ok": frames, "lost_frames": lost, "crc_errors": crc,
                           "loss_ratio": lost / total if total else None, "crc_ratio": crc / total if total else None,
                           "latency_ms_p50": st.get("latency_ms_p50"), "latency_ms_p95": st.get("latency_ms_p95")}})


@router.get("/analytics/devices/{device_id}/trend", tags=["analytics"])
async def device_trend(device_id: str, days: int = Query(7, ge=1, le=90), bucket_s: int = Query(300, ge=60, le=86400),
                       _: Principal = Depends(current_user), ctx: AppContext = Depends(get_ctx)) -> dict:
    t0 = time.time() - days * 86400
    async with ctx.db.session() as s:
        rows = (await s.execute(select(models.Vital.t, models.Vital.hr_ecg, models.Vital.hr_ppg, models.Vital.spo2,
                                       models.Vital.motion_g)
                                .join(models.Session, models.Session.id == models.Vital.session_id)
                                .where(models.Session.device_id == device_id, models.Vital.t >= t0)
                                .order_by(models.Vital.t))).all()
    buckets: dict[int, list] = {}
    for t, he, hp, sp, mo in rows:
        b = int(t // bucket_s) * bucket_s
        buckets.setdefault(b, []).append((he if he is not None else hp, sp, mo))
    out = []
    for b, vals in sorted(buckets.items()):
        hr = [v[0] for v in vals if v[0] is not None]
        sp = [v[1] for v in vals if v[1] is not None]
        mo = [v[2] for v in vals if v[2] is not None]
        out.append({"t": b, "hr_mean": float(np.mean(hr)) if hr else None, "hr_min": min(hr) if hr else None,
                    "hr_max": max(hr) if hr else None, "spo2_mean": float(np.mean(sp)) if sp else None,
                    "motion_mean": float(np.mean(mo)) if mo else None, "n": len(vals)})
    return {"device_id": device_id, "bucket_s": bucket_s, "items": clean(out)}


# ============================================================== demo
@router.get("/demo/scenarios", tags=["demo"])
async def scenarios(_: Principal = Depends(current_user)) -> list[dict]:
    return [{"id": s.id, "title": s.title, "description": s.description, "duration_s": s.duration_s,
             "expected_events": list(s.expected_events)} for s in SCENARIOS.values()]


def _demo(ctx: AppContext):
    if not ctx.settings.demo_mode or ctx.demo is None:
        raise HTTPException(404, "demo mode is disabled")
    return ctx.demo


@router.get("/demo/status", tags=["demo"])
async def demo_status(_: Principal = Depends(current_user), ctx: AppContext = Depends(get_ctx)) -> dict:
    return _demo(ctx).status()


@router.post("/demo/start", tags=["demo"])
async def demo_start(body: DemoStartIn, request: Request, p: Principal = Depends(require("operator")),
                     ctx: AppContext = Depends(get_ctx)) -> dict:
    if body.scenario not in SCENARIOS:
        raise HTTPException(422, f"unknown scenario; choose from {', '.join(SCENARIOS)}")
    st = await _demo(ctx).start(scenario=body.scenario, speed=body.speed, seed=body.seed)
    await ctx.audit(p.email, "demo_start", body.scenario, body.model_dump(), client_ip(request))
    return st


@router.post("/demo/stop", tags=["demo"])
async def demo_stop(request: Request, p: Principal = Depends(require("operator")), ctx: AppContext = Depends(get_ctx)) -> dict:
    d = _demo(ctx)
    await d.stop()
    await ctx.audit(p.email, "demo_stop", None, {}, client_ip(request))
    return d.status()


@router.post("/demo/replay", tags=["demo"])
async def demo_replay(file: UploadFile, request: Request, speed: float = Query(1.0, gt=0, le=20),
                      p: Principal = Depends(require("operator")), ctx: AppContext = Depends(get_ctx)) -> dict:
    from mesp_replay import RecordingError, read_recording
    data = await file.read(64 * 1024 * 1024 + 1)
    if len(data) > 64 * 1024 * 1024:
        raise HTTPException(413, "recording larger than 64 MB")
    try:
        rec = read_recording(data)
    except (RecordingError, ValueError) as e:
        raise HTTPException(422, f"invalid recording: {e}") from e
    fd, path = tempfile.mkstemp(suffix=".mesprec")
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    st = await _demo(ctx).start(recording=path, speed=speed)
    await ctx.audit(p.email, "replay_start", file.filename, {"records": len(rec.records), "synthetic": rec.synthetic},
                    client_ip(request))
    return st


# ============================================================== audit
@router.get("/audit", tags=["audit"])
async def audit_log(limit: int = Query(200, le=2000), _: Principal = Depends(require("admin")),
                    ctx: AppContext = Depends(get_ctx)) -> list[dict]:
    async with ctx.db.session() as s:
        rows = (await s.execute(select(models.AuditLog).order_by(models.AuditLog.at.desc()).limit(limit))).scalars()
        return [{"at": a.at, "actor": a.actor, "action": a.action, "target": a.target, "detail": a.detail, "ip": a.ip}
                for a in rows]

