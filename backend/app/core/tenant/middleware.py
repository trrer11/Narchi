"""NARCHI V5 — Résolution vérifiée du tenant depuis le JWT signé."""

from __future__ import annotations

import hmac
import re
from contextvars import Token

from fastapi import Request, status
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from app.core.context import tenant_id_context
from app.core.logging import get_logger
from app.core.security.jwt import get_token_payload

logger = get_logger("middleware.tenant")

TENANT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$")
PUBLIC_PATHS = frozenset(
    {
        "/health",
        "/api/health",
        "/metrics",
        "/openapi.json",
        "/api/v5/auth/token",
        "/api/v5/auth/register",
        "/api/v5/auth/guest-login",
        "/api/v5/auth/refresh",
        "/api/v5/diagnostics/client-events",
        "/api/v5/billing/webhook",
    }
)
PUBLIC_PREFIXES = ("/api/docs",)


class TenantIsolationMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if request.method == "OPTIONS" or self._is_public(request.url.path):
            return await call_next(request)

        token = self._extract_token(request)
        payload = get_token_payload(token) if token else None
        if not payload or payload.get("type") == "refresh":
            if not token:
                event_code = "AUTH_SESSION_MISSING"
                message = "Protected endpoint called without a session cookie or bearer"
            elif payload and payload.get("type") == "refresh":
                event_code = "AUTH_REFRESH_TOKEN_MISUSED"
                message = "Refresh token rejected by tenant middleware"
            else:
                event_code = "AUTH_TOKEN_INVALID"
                message = "Invalid or expired token rejected by tenant middleware"
            logger.info(
                message,
                extra={
                    "event_code": event_code,
                    "path": request.url.path,
                    "has_cookie": bool(request.cookies.get("narchi_session")),
                    "has_authorization_header": bool(request.headers.get("Authorization")),
                },
            )
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"error": "INVALID_SESSION", "code": "TNT-401"},
            )

        tenant_id = payload.get("tenant_id")
        if not isinstance(tenant_id, str) or not TENANT_RE.fullmatch(tenant_id):
            logger.warning(
                "Tenant claim is missing or malformed",
                extra={"event_code": "TENANT_CLAIM_INVALID", "path": request.url.path},
            )
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"error": "INVALID_TENANT_CLAIM", "code": "TNT-002"},
            )

        requested_tenant = request.headers.get("X-Tenant-ID")
        if requested_tenant and not hmac.compare_digest(requested_tenant, tenant_id):
            logger.warning(
                "Requested tenant does not match the signed session",
                extra={"event_code": "TENANT_MISMATCH", "path": request.url.path},
            )
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"error": "TENANT_MISMATCH", "code": "TNT-003"},
            )

        request.state.tenant_id = tenant_id
        context_token: Token = tenant_id_context.set(tenant_id)
        try:
            return await call_next(request)
        finally:
            tenant_id_context.reset(context_token)

    @staticmethod
    def _is_public(path: str) -> bool:
        return path in PUBLIC_PATHS or any(path.startswith(prefix) for prefix in PUBLIC_PREFIXES)

    @staticmethod
    def _extract_token(request: Request) -> str | None:
        cookie_token = request.cookies.get("narchi_session")
        if cookie_token:
            return cookie_token

        authorization = request.headers.get("Authorization", "")
        scheme, _, value = authorization.partition(" ")
        if scheme.lower() == "bearer" and value:
            return value.strip()
        return None
