"""NARCHI V5 — file Celery avec événements de diagnostic structurés."""

from __future__ import annotations

import os
import time
from typing import Any

from celery import Celery, signals

from app.core.logging import get_logger, setup_logging

os.environ.setdefault("NARCHI_SERVICE_NAME", "narchi-worker")
setup_logging(
    level=os.getenv("LOG_LEVEL", "INFO"),
    json_format=os.getenv("ENVIRONMENT", "development").lower() == "production",
)
logger = get_logger("workers.lifecycle")

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
celery_app = Celery(
    "narchi_worker",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["app.tasks.ifc_tasks", "app.tasks.pdf_tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Europe/Berlin",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=1800,
    task_soft_time_limit=1200,
    worker_concurrency=4,
    worker_prefetch_multiplier=1,
    worker_hijack_root_logger=False,
)

_task_started_at: dict[str, float] = {}


@signals.task_prerun.connect
def _task_started(task_id: str | None = None, task=None, **_kwargs: Any) -> None:
    if task_id:
        _task_started_at[task_id] = time.perf_counter()
    logger.info(
        "Celery task started",
        extra={
            "event_code": "CELERY_TASK_STARTED",
            "task_id": task_id,
            "task_name": getattr(task, "name", "unknown"),
        },
    )


@signals.task_postrun.connect
def _task_completed(
    task_id: str | None = None,
    task=None,
    state: str | None = None,
    **_kwargs: Any,
) -> None:
    started = _task_started_at.pop(task_id, None) if task_id else None
    logger.info(
        "Celery task completed",
        extra={
            "event_code": "CELERY_TASK_COMPLETED",
            "task_id": task_id,
            "task_name": getattr(task, "name", "unknown"),
            "task_state": state,
            "duration_ms": (
                round((time.perf_counter() - started) * 1000, 2)
                if started is not None
                else None
            ),
        },
    )


@signals.task_failure.connect
def _task_failed(
    task_id: str | None = None,
    exception: BaseException | None = None,
    sender=None,
    **_kwargs: Any,
) -> None:
    started = _task_started_at.get(task_id) if task_id else None
    logger.error(
        "Celery task failed",
        extra={
            "event_code": "CELERY_TASK_FAILED",
            "task_id": task_id,
            "task_name": getattr(sender, "name", "unknown"),
            "error_type": type(exception).__name__ if exception else "unknown",
            "error": str(exception)[:1_000] if exception else "unknown",
            "duration_ms": (
                round((time.perf_counter() - started) * 1000, 2)
                if started is not None
                else None
            ),
        },
    )


try:
    from opentelemetry.instrumentation.celery import CeleryInstrumentor

    CeleryInstrumentor().instrument()
    logger.info(
        "OpenTelemetry Celery instrumentation active",
        extra={"event_code": "CELERY_TELEMETRY_READY"},
    )
except ImportError:
    logger.info(
        "OpenTelemetry Celery instrumentation unavailable",
        extra={"event_code": "CELERY_TELEMETRY_DISABLED"},
    )
