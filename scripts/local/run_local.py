"""Run the whole MESP platform on one computer: API + website on http://localhost:8000.

No Node.js needed: the website is served from the pre-built `apps/web/dist` folder.
"localhost" counts as a secure address, so Chrome/Edge allow "Connect by Bluetooth"
and "Connect by USB cable" here.

Settings (environment variables, all optional):
  MESP_PORT            port (default 8000)
  MESP_ADMIN_EMAIL     team login created on first start (default admin@mesp.local)
  MESP_ADMIN_PASSWORD  its password (default: generated once, saved in local-data/admin.txt)
"""
from __future__ import annotations

import os
import secrets
import sys
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "apps" / "web" / "dist"
DATA = ROOT / "local-data"
DATA.mkdir(exist_ok=True)


def _settings() -> tuple[str, str, int]:
    port = int(os.environ.get("MESP_PORT", "8000"))
    email = os.environ.get("MESP_ADMIN_EMAIL", "admin@mesp.local")
    cred = DATA / "admin.txt"
    if os.environ.get("MESP_ADMIN_PASSWORD"):
        pw = os.environ["MESP_ADMIN_PASSWORD"]
    elif cred.exists():
        pw = cred.read_text(encoding="utf-8").splitlines()[1].split(":", 1)[1].strip()
    else:
        pw = "Mesp-" + secrets.token_urlsafe(9)
    cred.write_text(f"email: {email}\npassword: {pw}\n", encoding="utf-8")
    secret_file = DATA / "jwt_secret.txt"
    if not secret_file.exists():
        secret_file.write_text(secrets.token_urlsafe(48), encoding="utf-8")
    os.environ.setdefault("MESP_JWT_SECRET", secret_file.read_text(encoding="utf-8").strip())
    os.environ.setdefault("MESP_DATABASE_URL", "sqlite+aiosqlite:///" + (DATA / "mesp.db").as_posix())
    os.environ.setdefault("MESP_DEMO_MODE", "true")
    os.environ["MESP_ADMIN_EMAIL"] = email
    os.environ["MESP_ADMIN_PASSWORD"] = pw
    os.environ.setdefault("MESP_CORS_ORIGINS", f"http://localhost:{port},http://127.0.0.1:{port}")
    return email, pw, port


def build_app():
    from fastapi import HTTPException
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles
    from mesp_api.main import app

    if not (DIST / "index.html").exists():
        sys.exit(f"Website files not found in {DIST}. Run `npm -w apps/web run build` first.")
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")
    index = DIST / "index.html"

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):                     # website pages; /api routes are matched first
        if path.startswith("api/"):
            raise HTTPException(404)
        f = (DIST / path).resolve()
        if path and f.is_file() and DIST in f.parents:
            return FileResponse(f)
        return FileResponse(index)

    return app


def main() -> None:
    email, pw, port = _settings()
    import uvicorn

    app = build_app()
    url = f"http://localhost:{port}"
    print("\n" + "=" * 60)
    print(f"  MESP platform is starting at {url}")
    print(f"  Team login:  {email}")
    print(f"  Password:    {pw}")
    print("  (also saved in local-data/admin.txt)")
    print("  Keep this window open. Close it to stop the platform.")
    print("=" * 60 + "\n")
    if not os.environ.get("MESP_NO_BROWSER"):
        threading.Timer(2.5, lambda: webbrowser.open(url + "/login")).start()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
