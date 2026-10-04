"""Relational schema. Times are UTC epoch seconds (float64) for sample-aligned arithmetic."""
from __future__ import annotations

import time
import uuid

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Index, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> float:
    return time.time()


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(16), default="viewer")      # viewer | operator | admin
    disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[float] = mapped_column(Float, default=_now)


class Device(Base):
    __tablename__ = "devices"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120))
    profile_id: Mapped[str] = mapped_column(String(64))
    key_hash: Mapped[str] = mapped_column(String(64), unique=True)        # sha256 of the ingest key
    key_prefix: Mapped[str] = mapped_column(String(12))
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    firmware: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[float] = mapped_column(Float, default=_now)
    last_seen: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    started_at: Mapped[float] = mapped_column(Float, default=_now)
    ended_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(200))
    synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    protocol_version: Mapped[int] = mapped_column(Integer, default=1)
    profile_id: Mapped[str] = mapped_column(String(64))
    firmware: Mapped[str | None] = mapped_column(String(200), nullable=True)
    stats: Mapped[dict] = mapped_column(JSON, default=dict)               # frames_ok, crc_errors, lost, ...
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)


class SampleChunk(Base):
    """~1 s block of one stream. data = little-endian float32 (n x channels)."""
    __tablename__ = "sample_chunks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    stream: Mapped[str] = mapped_column(String(16))       # ecg | ppg | imu
    t_start: Mapped[float] = mapped_column(Float)
    sample_rate: Mapped[float] = mapped_column(Float)
    n: Mapped[int] = mapped_column(Integer)
    channels: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    __table_args__ = (Index("ix_chunks_session_stream_t", "session_id", "stream", "t_start"),)


class Vital(Base):
    """Derived 1 Hz values. NULL = not computable (no signal / poor quality)."""
    __tablename__ = "vitals"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    t: Mapped[float] = mapped_column(Float)
    hr_ecg: Mapped[float | None] = mapped_column(Float, nullable=True)
    hr_ppg: Mapped[float | None] = mapped_column(Float, nullable=True)
    spo2: Mapped[float | None] = mapped_column(Float, nullable=True)
    rr_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    rr_irregularity: Mapped[float | None] = mapped_column(Float, nullable=True)
    ecg_quality: Mapped[str | None] = mapped_column(String(12), nullable=True)
    ppg_quality: Mapped[str | None] = mapped_column(String(12), nullable=True)
    perfusion_index: Mapped[float | None] = mapped_column(Float, nullable=True)
    motion_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    activity: Mapped[str | None] = mapped_column(String(12), nullable=True)
    roll_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    pitch_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    imu_temp_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    battery_soc: Mapped[float | None] = mapped_column(Float, nullable=True)
    skin_temp_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    __table_args__ = (Index("ix_vitals_session_t", "session_id", "t"),)


class Event(Base):
    __tablename__ = "events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[str | None] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True)
    t: Mapped[float] = mapped_column(Float, index=True)
    severity: Mapped[str] = mapped_column(String(10))       # INFO | WARNING | CRITICAL
    code: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(200))
    detail: Mapped[str] = mapped_column(Text, default="")
    stream: Mapped[str | None] = mapped_column(String(16), nullable=True)   # sensor timeline to open
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    acknowledged_by: Mapped[str | None] = mapped_column(String(320), nullable=True)
    acknowledged_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    ack_note: Mapped[str | None] = mapped_column(Text, nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[float] = mapped_column(Float, default=_now, index=True)
    actor: Mapped[str] = mapped_column(String(320))
    action: Mapped[str] = mapped_column(String(60))
    target: Mapped[str | None] = mapped_column(String(200), nullable=True)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
