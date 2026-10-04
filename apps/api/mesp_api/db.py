from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class Database:
    def __init__(self, url: str):
        kw: dict = {"pool_pre_ping": True}
        if url.startswith("sqlite"):
            from sqlalchemy.pool import NullPool
            # SQLite is for dev/tests only: one connection per unit of work, nothing pooled
            kw = {"connect_args": {"check_same_thread": False, "timeout": 30}, "poolclass": NullPool}
        self.engine: AsyncEngine = create_async_engine(url, **kw)
        self.session = async_sessionmaker(self.engine, expire_on_commit=False)

    async def create_all(self) -> None:
        from . import models  # noqa: F401  (register tables)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def dispose(self) -> None:
        await self.engine.dispose()


__all__ = ["Base", "Database", "AsyncSession"]
