"""FastAPI application factory."""
from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import DISCLAIMER, __version__
from .config import Settings, get_settings
from .context import AppContext
from .routes import core, ws

log = logging.getLogger("mesp")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        ctx = AppContext(settings)
        app.state.ctx = ctx
        await ctx.bootstrap()
        if settings.demo_mode:
            from .demo import DemoController
            ctx.demo = DemoController(ctx)
            if settings.demo_autostart_scenario:
                await ctx.demo.start(scenario=settings.demo_autostart_scenario)
        from .retention import RetentionJob
        retention = RetentionJob(ctx)
        retention.start()
        yield
        await retention.stop()
        if ctx.demo:
            await ctx.demo.stop()
        for sess in list(ctx.ingest.values()):
            await sess.close("server shutdown", expected=True)  # type: ignore[attr-defined]
        await ctx.db.dispose()

    app = FastAPI(title="MESP Health Monitoring Platform API", version=__version__, lifespan=lifespan,
                  description=f"Ingest, storage, analytics and live streaming for the MESP wrist-worn monitor.\n\n"
                              f"**{DISCLAIMER}**")
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False,
                       allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type"])

    @app.middleware("http")
    async def headers(request: Request, call_next):
        t = time.perf_counter()
        resp = await call_next(request)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Cache-Control"] = resp.headers.get("Cache-Control", "no-store")
        resp.headers["Server-Timing"] = f"app;dur={(time.perf_counter() - t) * 1000:.1f}"
        if hasattr(request.app.state, "ctx"):
            request.app.state.ctx.metrics.inc("http_requests_total")
        return resp

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):  # never leak internals
        log.exception("unhandled error on %s", request.url.path)
        return JSONResponse({"detail": "internal server error"}, status_code=500)

    app.include_router(core.system)
    app.include_router(core.router)
    app.include_router(ws.router)
    return app


app = create_app() if __name__ != "__main__" else None
