"""Runtime configuration from environment variables (prefix MESP_). No secrets have defaults."""
from __future__ import annotations

import json
import logging
import secrets
from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

log = logging.getLogger("mesp.config")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MESP_", env_file=".env", extra="ignore")

    env: str = "development"                      # development | test | production
    database_url: str = "sqlite+aiosqlite:///./mesp-dev.db"
    auto_create_schema: bool = True                # production: False, use Alembic
    jwt_secret: str = Field(default="", repr=False)
    jwt_ttl_minutes: int = 480
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    demo_mode: bool = True                         # allows demo login + in-process simulator
    demo_autostart_scenario: str | None = "normal"
    admin_email: str | None = None                 # bootstrap admin on first start
    admin_password: str | None = Field(default=None, repr=False)
    raw_retention_days: int = 14                   # raw sample chunks; vitals/events are kept
    live_ecg_hz: int = 250                         # browser ECG rate (decimated from device rate)
    live_imu_hz: int = 50
    login_rate_per_minute: int = 10

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _origins(cls, v):
        """Accept a JSON list, a comma-separated string or a single URL; trailing slashes stripped."""
        if isinstance(v, str):
            v = v.strip()
            if not v:
                return []
            items = json.loads(v) if v.startswith("[") else v.split(",")
        else:
            items = v
        return [str(o).strip().rstrip("/") for o in items if str(o).strip()]

    @field_validator("database_url")
    @classmethod
    def _async_driver(cls, v: str) -> str:
        # Hosted Postgres (Render, Neon, Railway, Supabase) hands out postgres:// URLs;
        # SQLAlchemy async needs the asyncpg driver. sslmode is a libpq option asyncpg rejects.
        if v.startswith("postgres://"):
            v = "postgresql+asyncpg://" + v[len("postgres://"):]
        elif v.startswith("postgresql://"):
            v = "postgresql+asyncpg://" + v[len("postgresql://"):]
        if "+asyncpg" in v and "sslmode=require" in v:
            v = v.replace("sslmode=require", "ssl=require")
        return v

    def resolved_jwt_secret(self) -> str:
        if self.jwt_secret:
            return self.jwt_secret
        if self.env == "production":
            raise RuntimeError("MESP_JWT_SECRET must be set in production")
        if not hasattr(self, "_ephemeral"):
            object.__setattr__(self, "_ephemeral", secrets.token_urlsafe(48))
            log.warning("MESP_JWT_SECRET not set: using an ephemeral secret (tokens die on restart)")
        return self._ephemeral  # type: ignore[attr-defined]


@lru_cache
def get_settings() -> Settings:
    return Settings()
