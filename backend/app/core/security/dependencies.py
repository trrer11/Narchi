"""
NARCHI V5 — FastAPI Security Dependencies
Authentication and authorization dependencies for route protection.
Uses LAZY IMPORTS to avoid circular dependencies.
"""

from __future__ import annotations
from typing import TYPE_CHECKING, Generator, Optional
from fastapi import Depends, HTTPException, status, Request
from sqlalchemy.orm import Session

from app.core.context import tenant_id_context, user_id_context
from app.core.logging import get_logger
from app.core.security.jwt import get_token_payload

logger = get_logger("security.session")

if TYPE_CHECKING:
    from app.models.user import User


# Exception réutilisable
CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Jeton invalide ou expiré.",
    headers={"WWW-Authenticate": "Bearer"}
)


def get_db_dependency() -> Generator[Session, None, None]:
    """
    FastAPI dependency for database session with lazy import.
    Avoids circular import by importing database inside the generator.
    """
    from app.database import get_db as _get_db
    yield from _get_db()


def _get_user_model():
    """Lazy import for User model."""
    from app.models.user import User as _User
    return _User


def get_current_user(
    request: Request,
    db: Session = Depends(get_db_dependency)
) -> "User":
    """
    FastAPI dependency to verify JWT token via HttpOnly Cookie (priority)
    or Bearer Token header. Returns authenticated User.
    """
    User = _get_user_model()

    # Priority 1: HttpOnly Cookie
    token = request.cookies.get("narchi_session")

    # Priority 2: Authorization Header (Bearer)
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]

    if not token:
        logger.info(
            "Authenticated endpoint called without a session",
            extra={
                "event_code": "AUTH_SESSION_MISSING",
                "path": request.url.path,
                "has_cookie": False,
                "has_authorization_header": bool(request.headers.get("Authorization")),
            },
        )
        raise CREDENTIALS_EXCEPTION

    # Decode and validate token
    payload = get_token_payload(token)
    if not payload:
        logger.warning(
            "Session token signature or expiration is invalid",
            extra={"event_code": "AUTH_TOKEN_INVALID", "path": request.url.path},
        )
        raise CREDENTIALS_EXCEPTION

    # Reject refresh tokens for API access
    if payload.get("type") == "refresh":
        logger.warning(
            "Refresh token used as an access token",
            extra={"event_code": "AUTH_REFRESH_TOKEN_MISUSED", "path": request.url.path},
        )
        raise CREDENTIALS_EXCEPTION

    user_id: Optional[str] = payload.get("sub")
    pw_stamp: Optional[str] = payload.get("pw_stamp")
    token_tenant_id: Optional[str] = payload.get("tenant_id")

    if not user_id or not token_tenant_id:
        logger.warning(
            "Session token is missing required claims",
            extra={"event_code": "AUTH_TOKEN_CLAIMS_MISSING", "path": request.url.path},
        )
        raise CREDENTIALS_EXCEPTION

    session_tenant = db.info.get("tenant_id")
    if session_tenant and session_tenant != token_tenant_id:
        logger.warning(
            "Database tenant and signed token tenant do not match",
            extra={
                "event_code": "AUTH_DATABASE_TENANT_MISMATCH",
                "path": request.url.path,
                "user_id": user_id,
            },
        )
        raise CREDENTIALS_EXCEPTION
    db.info["tenant_id"] = token_tenant_id

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        logger.warning(
            "Session user no longer exists",
            extra={"event_code": "AUTH_SESSION_USER_NOT_FOUND", "user_id": user_id},
        )
        raise CREDENTIALS_EXCEPTION
    if not user.is_active:
        logger.warning(
            "Session user is inactive",
            extra={"event_code": "AUTH_SESSION_USER_INACTIVE", "user_id": user_id},
        )
        raise CREDENTIALS_EXCEPTION
    if user.tenant_id != token_tenant_id:
        logger.warning(
            "User tenant and signed token tenant do not match",
            extra={"event_code": "AUTH_USER_TENANT_MISMATCH", "user_id": user_id},
        )
        raise CREDENTIALS_EXCEPTION

    # Strict Session Invalidation: if password changed, residual token is dead
    pwd_hash = user.hashed_password if user.hashed_password else ""
    if pw_stamp and pwd_hash[-8:] != pw_stamp:
        logger.info(
            "Session invalidated because the password changed",
            extra={"event_code": "AUTH_PASSWORD_STAMP_MISMATCH", "user_id": user_id},
        )
        raise CREDENTIALS_EXCEPTION

    request.state.user_id = user.id
    request.state.tenant_id = user.tenant_id
    user_id_context.set(user.id)
    tenant_id_context.set(user.tenant_id)
    logger.info(
        "Authenticated session validated",
        extra={
            "event_code": "AUTH_SESSION_VALID",
            "user_id": user.id,
            "tenant_id": user.tenant_id,
            "path": request.url.path,
        },
    )
    return user


def get_current_active_user(current_user: "User" = Depends(get_current_user)) -> "User":
    """Dependency ensuring user is active (alias for clarity)."""
    return current_user


def require_role(*allowed_roles: str):
    """Dependency factory for role-based access control."""
    def role_checker(current_user: "User" = Depends(get_current_user)) -> "User":
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Accès refusé. Rôles requis: {', '.join(allowed_roles)}"
            )
        return current_user
    return role_checker


def require_owner(current_user: "User" = Depends(get_current_user)) -> "User":
    """Dependency requiring owner role."""
    if current_user.role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès réservé aux propriétaires."
        )
    return current_user


def require_architect_or_owner(current_user: "User" = Depends(get_current_user)) -> "User":
    """Dependency requiring architect or owner role."""
    if current_user.role not in ("architect", "owner"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès réservé aux architectes et propriétaires."
        )
    return current_user