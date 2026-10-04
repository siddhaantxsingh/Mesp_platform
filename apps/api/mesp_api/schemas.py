from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator


class LoginIn(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=200)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105 (OAuth2 token type, not a secret)
    role: str
    email: str
    demo: bool = False
    expires_in: int


class UserIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=200)
    role: Literal["viewer", "operator", "admin"] = "viewer"


class UserPatch(BaseModel):
    role: Literal["viewer", "operator", "admin"] | None = None
    disabled: bool | None = None


class DeviceIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    profile_id: str = "mesp-lab-main-v1"

    @field_validator("name")
    @classmethod
    def strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name required")
        return v


class AckIn(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class SessionPatch(BaseModel):
    label: str | None = Field(default=None, max_length=200)


class DemoStartIn(BaseModel):
    scenario: str = "normal"
    speed: float = Field(default=1.0, gt=0, le=20)
    seed: int = 1234
