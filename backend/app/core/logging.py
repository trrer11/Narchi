"""NARCHI V5 — journalisation structurée, corrélée et sans secrets.

Les journaux sont écrits en JSON sur stdout afin d'être récupérés par Docker.
Chaque événement applicatif possède un ``event_code`` stable et chaque requête
HTTP un ``request_id`` qui permet de suivre le même problème de Nginx à FastAPI.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import sys
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from pythonjsonlogger.json import JsonFormatter

from app.core.context import request_id_context, tenant_id_context, user_id_context

# Alias conservés pour les imports historiques.
request_id_var = request_id_context
tenant_id_var = tenant_id_context
user_id_var = user_id_context

_STANDARD_RECORD_FIELDS = {
    "name",
    "msg",
    "args",
    "created",
    "filename",
    "funcName",
    "levelname",
    "levelno",
    "lineno",
    "module",
    "msecs",
    "message",
    "pathname",
    "process",
    "processName",
    "relativeCreated",
    "thread",
    "threadName",
    "exc_info",
    "exc_text",
    "stack_info",
    "taskName",
}
_SENSITIVE_KEY_RE = re.compile(
    r"(?:password|passwd|pwd|secret|authorization|cookie|set-cookie|"
    r"api[_-]?key|access[_-]?token|refresh[_-]?token|session|dsn|"
    r"database_url|flower_basic_auth)",
    re.IGNORECASE,
)
_BEARER_RE = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{12,}")
_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")
_URL_CREDENTIAL_RE = re.compile(r"(://[^\s:/@]+:)([^\s@]+)(@)")
_EMAIL_RE = re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
_KEY_VALUE_SECRET_RE = re.compile(
    r"(?i)(password|passwd|pwd|secret|token|api[_-]?key)(\s*[=:]\s*)([^\s,;&]+)"
)
_SAFE_SECURITY_METADATA_KEYS = {
    "cookie_name_safe",
    "cookie_secure",
    "cookie_httponly",
    "cookie_samesite",
    "cookie_domain_configured",
    "has_cookie",
    "has_authorization_header",
}


def redact_text(value: str) -> str:
    """Masque les formes de secrets les plus fréquentes dans un texte libre."""
    redacted = _BEARER_RE.sub("Bearer [REDACTED]", value)
    redacted = _JWT_RE.sub("[REDACTED_JWT]", redacted)
    redacted = _URL_CREDENTIAL_RE.sub(r"\1[REDACTED]\3", redacted)
    redacted = _EMAIL_RE.sub("[REDACTED_EMAIL]", redacted)
    redacted = _KEY_VALUE_SECRET_RE.sub(r"\1\2[REDACTED]", redacted)
    return redacted


def redact_log_value(value: Any, key: str | None = None, depth: int = 0) -> Any:
    """Nettoie récursivement une valeur avant sérialisation dans les logs."""
    if (
        key
        and key.lower() not in _SAFE_SECURITY_METADATA_KEYS
        and _SENSITIVE_KEY_RE.search(key)
    ):
        return "[REDACTED]"
    if depth > 6:
        return "[TRUNCATED]"
    if isinstance(value, str):
        return redact_text(value[:16_384])
    if isinstance(value, dict):
        return {
            str(item_key)[:128]: redact_log_value(item_value, str(item_key), depth + 1)
            for item_key, item_value in list(value.items())[:100]
        }
    if isinstance(value, (list, tuple, set)):
        return [redact_log_value(item, depth=depth + 1) for item in list(value)[:100]]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return redact_text(str(value)[:4_096])


def anonymize_identifier(value: str) -> str:
    """Produit un identifiant corrélable mais non réversible pour e-mail/login."""
    normalized = value.strip().lower().encode("utf-8", errors="replace")
    key = os.getenv("SECRET_KEY", "narchi-diagnostic-local").encode("utf-8")
    return hmac.new(key, normalized, hashlib.sha256).hexdigest()[:16]


class SensitiveDataFilter(logging.Filter):
    """Dernière barrière empêchant l'écriture accidentelle de secrets."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact_text(record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = redact_log_value(record.args)
            elif isinstance(record.args, tuple):
                record.args = tuple(redact_log_value(item) for item in record.args)
        for key in list(record.__dict__):
            if key not in _STANDARD_RECORD_FIELDS:
                record.__dict__[key] = redact_log_value(record.__dict__[key], key)
        return True


class NarchiJsonFormatter(JsonFormatter):
    """Format JSON commun au backend, aux migrations et aux workers Celery."""

    def add_fields(
        self,
        log_record: Dict[str, Any],
        record: logging.LogRecord,
        message_dict: Dict[str, Any],
    ) -> None:
        super().add_fields(log_record, record, message_dict)
        log_record["timestamp"] = datetime.now(timezone.utc).isoformat()
        log_record["level"] = record.levelname
        log_record["logger"] = record.name
        log_record["event_code"] = getattr(record, "event_code", "UNCLASSIFIED")
        log_record["module"] = record.module
        log_record["function"] = record.funcName
        log_record["line"] = record.lineno
        log_record["request_id"] = request_id_context.get()
        log_record["tenant_id"] = tenant_id_context.get()
        log_record["user_id"] = user_id_context.get()
        log_record["environment"] = os.getenv("ENVIRONMENT", "development")
        log_record["service"] = os.getenv("NARCHI_SERVICE_NAME", "narchi-backend")
        log_record["version"] = os.getenv("APP_VERSION", "5.0.0")

        if record.exc_info:
            log_record["exception"] = redact_text(self.formatException(record.exc_info))

        for key, value in record.__dict__.items():
            if key not in _STANDARD_RECORD_FIELDS:
                log_record[key] = redact_log_value(value, key)

        # Nettoyage final, y compris des champs ajoutés par python-json-logger.
        for key in list(log_record):
            log_record[key] = redact_log_value(log_record[key], key)


def setup_logging(
    level: str = "INFO",
    json_format: bool = True,
    include_stdlib: bool = True,
) -> None:
    """Configure une seule sortie stdout, exploitable par ``docker compose logs``."""
    log_level = getattr(logging, level.upper(), logging.INFO)
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    root_logger.handlers.clear()

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(log_level)
    console_handler.addFilter(SensitiveDataFilter())

    if json_format:
        formatter: logging.Formatter = NarchiJsonFormatter(
            fmt="%(timestamp)s %(level)s %(logger)s %(event_code)s %(message)s"
        )
    else:
        formatter = logging.Formatter(
            fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    if include_stdlib:
        logging.getLogger("sqlalchemy.engine").setLevel(
            logging.WARNING if log_level > logging.DEBUG else logging.INFO
        )
        logging.getLogger("sqlalchemy.pool").setLevel(logging.WARNING)
        logging.getLogger("sqlalchemy.dialects").setLevel(logging.WARNING)
        logging.getLogger("uvicorn").setLevel(logging.INFO)
        logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
        logging.getLogger("uvicorn.error").setLevel(logging.INFO)
        logging.getLogger("gunicorn.error").setLevel(logging.INFO)
        logging.getLogger("celery").setLevel(logging.INFO)
        logging.getLogger("celery.worker").setLevel(logging.INFO)
        logging.getLogger("redis").setLevel(logging.WARNING)
        logging.getLogger("httpx").setLevel(logging.WARNING)
        logging.getLogger("httpcore").setLevel(logging.WARNING)
        logging.getLogger("watchfiles").setLevel(logging.WARNING)

    for logger_name in (
        "narchi",
        "narchi.security",
        "narchi.api",
        "narchi.services",
        "narchi.models",
        "narchi.workers",
        "narchi.middleware",
        "narchi.migrations",
        "narchi.frontend",
    ):
        logging.getLogger(logger_name).setLevel(log_level)

    # L'accès HTTP utile est déjà journalisé avec request_id par notre middleware.
    logging.getLogger("uvicorn.access").propagate = False


def get_logger(name: str) -> logging.Logger:
    """Retourne un logger sous l'espace de noms ``narchi``."""
    if not name.startswith("narchi"):
        name = f"narchi.{name}"
    return logging.getLogger(name)


class LoggingContext:
    """Ajoute temporairement les identifiants de corrélation aux journaux."""

    def __init__(
        self,
        request_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> None:
        self.request_id = request_id
        self.tenant_id = tenant_id
        self.user_id = user_id
        self._tokens: list[tuple[ContextVar, object]] = []

    def __enter__(self):
        if self.request_id:
            self._tokens.append(
                (request_id_context, request_id_context.set(self.request_id))
            )
        if self.tenant_id:
            self._tokens.append((tenant_id_context, tenant_id_context.set(self.tenant_id)))
        if self.user_id:
            self._tokens.append((user_id_context, user_id_context.set(self.user_id)))
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        for variable, token in reversed(self._tokens):
            variable.reset(token)
        self._tokens.clear()


def log_function_call(logger: logging.Logger):
    """Décorateur de durée pour fonctions synchrones et asynchrones."""

    def decorator(func):
        import asyncio
        import functools
        import time

        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            started = time.perf_counter()
            logger.debug(
                "%s started",
                func.__name__,
                extra={"event_code": "FUNCTION_STARTED", "target_function": func.__name__},
            )
            try:
                result = func(*args, **kwargs)
                logger.debug(
                    "%s completed",
                    func.__name__,
                    extra={
                        "event_code": "FUNCTION_COMPLETED",
                        "target_function": func.__name__,
                        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                    },
                )
                return result
            except Exception:
                logger.exception(
                    "%s failed",
                    func.__name__,
                    extra={
                        "event_code": "FUNCTION_FAILED",
                        "target_function": func.__name__,
                        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                    },
                )
                raise

        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            started = time.perf_counter()
            logger.debug(
                "%s started",
                func.__name__,
                extra={"event_code": "FUNCTION_STARTED", "target_function": func.__name__},
            )
            try:
                result = await func(*args, **kwargs)
                logger.debug(
                    "%s completed",
                    func.__name__,
                    extra={
                        "event_code": "FUNCTION_COMPLETED",
                        "target_function": func.__name__,
                        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                    },
                )
                return result
            except Exception:
                logger.exception(
                    "%s failed",
                    func.__name__,
                    extra={
                        "event_code": "FUNCTION_FAILED",
                        "target_function": func.__name__,
                        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                    },
                )
                raise

        return async_wrapper if asyncio.iscoroutinefunction(func) else sync_wrapper

    return decorator
