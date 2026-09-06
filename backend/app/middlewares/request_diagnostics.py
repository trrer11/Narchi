"""Middleware de diagnostic HTTP avec identifiant de corrélation."""

from __future__ import annotations

import re
import time
import uuid

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from app.core.context import request_id_context, tenant_id_context, user_id_context
from app.core.logging import get_logger

logger = get_logger("middleware.http")
_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._-]{8,128}$")
_QUIET_PATHS = frozenset({"/health", "/api/health", "/metrics"})


def _request_id(request: Request) -> str:
    supplied = (
        request.headers.get("x-narchi-request-id")
        or request.headers.get("x-request-id")
        or ""
    ).strip()
    if _REQUEST_ID_RE.fullmatch(supplied):
        return supplied
    return uuid.uuid4().hex


class RequestDiagnosticsMiddleware(BaseHTTPMiddleware):
    """Journalise statut/durée sans lire le corps, les cookies ou les secrets."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        correlation_id = _request_id(request)
        request.state.request_id = correlation_id
        request_token = request_id_context.set(correlation_id)
        tenant_token = tenant_id_context.set(None)
        user_token = user_id_context.set(None)
        started = time.perf_counter()
        status_code = 500

        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers["X-Narchi-Request-ID"] = correlation_id
            response.headers["Server-Timing"] = (
                f'narchi;dur={(time.perf_counter() - started) * 1000:.2f};desc="NARCHI API"'
            )
            return response
        except Exception as error:
            logger.exception(
                "Unhandled HTTP request failure",
                extra={
                    "event_code": "HTTP_REQUEST_EXCEPTION",
                    "method": request.method,
                    "path": request.url.path,
                    "error_type": type(error).__name__,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                },
            )
            raise
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            if request.url.path not in _QUIET_PATHS or status_code >= 400:
                log_method = logger.warning if status_code >= 400 else logger.info
                log_method(
                    "HTTP request completed",
                    extra={
                        "event_code": (
                            "HTTP_REQUEST_FAILED"
                            if status_code >= 400
                            else "HTTP_REQUEST_COMPLETED"
                        ),
                        "method": request.method,
                        "path": request.url.path,
                        "status_code": status_code,
                        "duration_ms": duration_ms,
                        "client_ip": request.client.host if request.client else "unknown",
                        "host": request.headers.get("host", "")[:255],
                        "forwarded_proto": request.headers.get("x-forwarded-proto", "")[:16],
                        "tenant_id": getattr(request.state, "tenant_id", None),
                        "user_id": getattr(request.state, "user_id", None),
                    },
                )
            user_id_context.reset(user_token)
            tenant_id_context.reset(tenant_token)
            request_id_context.reset(request_token)
