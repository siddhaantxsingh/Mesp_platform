import asyncio
import os

from alembic import context
from mesp_api import models  # noqa: F401  (registers tables)
from mesp_api.db import Base
from sqlalchemy.ext.asyncio import create_async_engine

target_metadata = Base.metadata
from mesp_api.config import Settings  # noqa: E402

URL = Settings(database_url=os.environ.get("MESP_DATABASE_URL", "postgresql+asyncpg://mesp@localhost:5432/mesp")).database_url


def run_offline() -> None:
    context.configure(url=URL, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def _do(conn) -> None:
    context.configure(connection=conn, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_online() -> None:
    eng = create_async_engine(URL)
    async with eng.connect() as conn:
        await conn.run_sync(_do)
    await eng.dispose()


if context.is_offline_mode():
    run_offline()
else:
    asyncio.run(run_online())
