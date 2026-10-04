import os

import pytest
from fastapi.testclient import TestClient
from mesp_api.config import Settings
from mesp_api.main import create_app

ADMIN = ("admin@example.com", "correct-horse-battery")


@pytest.fixture
def settings(tmp_path):
    url = os.getenv("MESP_TEST_DATABASE_URL") or f"sqlite+aiosqlite:///{tmp_path}/t.db"
    return Settings(env="test", database_url=url, jwt_secret="test-secret-" + "x" * 32, demo_mode=True,
                    demo_autostart_scenario=None, admin_email=ADMIN[0], admin_password=ADMIN[1],
                    login_rate_per_minute=1000, raw_retention_days=0)


def _reset_pg(url):
    import asyncio

    from mesp_api import models  # noqa: F401
    from mesp_api.db import Base, Database

    async def go():
        db = Database(url)
        async with db.engine.begin() as c:
            await c.run_sync(Base.metadata.drop_all)
        await db.dispose()
    asyncio.run(go())


@pytest.fixture
def client(settings):
    if settings.database_url.startswith("postgresql"):
        _reset_pg(settings.database_url)
    with TestClient(create_app(settings)) as c:
        yield c


def login(client, email=ADMIN[0], pw=ADMIN[1]):
    r = client.post("/api/v1/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def admin(client):
    return login(client)
