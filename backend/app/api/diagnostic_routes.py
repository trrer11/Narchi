"""Réception limitée des événements de diagnostic du navigateur.

Cet endpoint ne reçoit ni mot de passe, ni cookie, ni corps de requête métier.
Il permet de retrouver dans ``docker compose logs backend`` une erreur React qui
serait autrement visible uniquement dans la console du navigateur.
"""

from __future__ import annotations

import json
import re
import time
from collections import defaultdict, deque
from threading import Lock
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.logging import get_logger, redact_log_value

router = APIRouter(prefix="/api/v5/diagnostics", tags=["Diagnostics"])
logger = get_logger("frontend")
_EVENT_CODE_RE = re.compile(r"^[A-Z][A-Z0-9_]{2,63}$")
_windows: dict[str, deque[float]] = defaultdict(deque)
_window_lock = Lock()
_MAX_EVENTS_PER_MINUTE = 30


class ClientDiagnosticEvent(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    event_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    event_code: str = Field(min_length=3, max_length=64)
    level: Literal["debug", "info", "warning", "error"] = "error"
    message: str = Field(min_length=1, max_length=2_000)
    context: dict[str, Any] = Field(default_factory=dict)
    stack: str | None = Field(default=None, max_length=8_000)
    client_timestamp: str | None = Field(default=None, max_length=64)
    page: str | None = Field(default=None, max_length=512)
    release: str | None = Field(default=None, max_length=128)

    @field_validator("event_code")
    @classmethod
    def validate_event_code(cls, value: str) -> str:
        normalized = value.upper()
        if not _EVENT_CODE_RE.fullmatch(normalized):
            raise ValueError("event_code invalide")
        return normalized

    @field_validator("context")
    @classmethod
    def limit_context(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(value) > 30:
            raise ValueError("contexte trop volumineux")
        serialized = json.dumps(value, ensure_ascii=False, default=str)
        if len(serialized.encode("utf-8")) > 16_000:
            raise ValueError("contexte trop volumineux")
        return value


def _allow_event(client_ip: str) -> bool:
    now = time.monotonic()
    with _window_lock:
        window = _windows[client_ip]
        while window and now - window[0] >= 60:
            window.popleft()
        if len(window) >= _MAX_EVENTS_PER_MINUTE:
            return False
        window.append(now)
        if len(_windows) > 5_000:
            for key in list(_windows)[:1_000]:
                if not _windows[key] or now - _windows[key][-1] >= 60:
                    _windows.pop(key, None)
        return True


@router.post("/client-events", status_code=status.HTTP_202_ACCEPTED)
async def receive_client_event(
    payload: ClientDiagnosticEvent, request: Request
) -> dict[str, str]:
    client_ip = request.client.host if request.client else "unknown"
    if not _allow_event(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Limite de diagnostic atteinte.",
        )

    safe_context = redact_log_value(payload.context)
    extra = {
        "event_code": payload.event_code,
        "frontend_event_id": payload.event_id,
        "frontend_context": safe_context,
        "frontend_stack": payload.stack,
        "client_timestamp": payload.client_timestamp,
        "page": payload.page,
        "release": payload.release,
        "client_ip": client_ip,
    }
    log_method = {
        "debug": logger.debug,
        "info": logger.info,
        "warning": logger.warning,
        "error": logger.error,
    }[payload.level]
    log_method(payload.message, extra=extra)
    return {
        "status": "recorded",
        "event_id": payload.event_id,
        "request_id": getattr(request.state, "request_id", ""),
    }
