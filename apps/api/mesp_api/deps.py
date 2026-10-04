from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .context import AppContext
from .security import decode_token, role_at_least

bearer = HTTPBearer(auto_error=False)


def get_ctx(request: Request) -> AppContext:
    return request.app.state.ctx


@dataclass
class Principal:
    id: str
    email: str
    role: str
    demo: bool = False


def principal_from_token(ctx: AppContext, token: str) -> Principal:
    try:
        c = decode_token(ctx.jwt_secret, token)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token") from None
    return Principal(c["sub"], c.get("email", ""), c.get("role", "viewer"), bool(c.get("demo")))


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer),
                 ctx: AppContext = Depends(get_ctx)) -> Principal:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "authentication required",
                            headers={"WWW-Authenticate": "Bearer"})
    return principal_from_token(ctx, creds.credentials)


def require(role: str):
    def dep(p: Principal = Depends(current_user)) -> Principal:
        if not role_at_least(p.role, role):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"requires {role} role")
        return p
    return dep


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None
