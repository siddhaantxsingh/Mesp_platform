"""Authentication: bcrypt passwords, HS256 JWT access tokens, hashed device ingest keys, roles."""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque

import bcrypt
import jwt

ROLES = ("viewer", "operator", "admin")
_RANK = {r: i for i, r in enumerate(ROLES)}


def hash_password(pw: str) -> str:
    if len(pw) < 10:
        raise ValueError("password must be at least 10 characters")
    return bcrypt.hashpw(pw.encode()[:72], bcrypt.gensalt(rounds=12)).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode()[:72], hashed.encode())
    except ValueError:
        return False


_DUMMY_HASH = bcrypt.hashpw(b"timing-equaliser", bcrypt.gensalt(rounds=12)).decode()


def verify_or_dummy(pw: str, hashed: str | None) -> bool:
    """Always runs one bcrypt check so unknown emails take as long as wrong passwords."""
    return verify_password(pw, hashed or _DUMMY_HASH) and hashed is not None


def make_token(secret: str, sub: str, email: str, role: str, ttl_min: int, demo: bool = False) -> str:
    now = int(time.time())
    return jwt.encode({"sub": sub, "email": email, "role": role, "demo": demo, "iat": now,
                       "exp": now + ttl_min * 60, "iss": "mesp-api"}, secret, algorithm="HS256")


def decode_token(secret: str, token: str) -> dict:
    return jwt.decode(token, secret, algorithms=["HS256"], issuer="mesp-api", options={"require": ["exp", "sub"]})


def role_at_least(role: str, needed: str) -> bool:
    return _RANK.get(role, -1) >= _RANK[needed]


def new_device_key() -> tuple[str, str, str]:
    """Returns (plaintext key shown once, sha256 hex stored, display prefix)."""
    key = "mesp_dk_" + secrets.token_urlsafe(32)
    return key, hash_key(key), key[:12]


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def keys_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)


class RateLimiter:
    """Sliding-window limiter (in-process)."""

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        q = self._hits[key]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= self.per_minute:
            return False
        q.append(now)
        return True
