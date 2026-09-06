"""NARCHI V5 — Sentry RGPD et métriques Prometheus à faible cardinalité."""

from __future__ import annotations

import time

import sentry_sdk
from fastapi import Request, Response
from prometheus_client import Counter, Gauge, Histogram, generate_latest
from sentry_sdk.integrations.celery import CeleryIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings


def _scrub_sentry_event(event, _hint):
    request = event.get("request")
    if request:
        request.pop("cookies", None)
        request.pop("data", None)
        headers = request.get("headers")
        if isinstance(headers, dict):
            for key in list(headers):
                if key.lower() in {"authorization", "cookie", "x-csrf-token"}:
                    headers[key] = "[Filtered]"
    return event


if settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        integrations=[FastApiIntegration(), SqlalchemyIntegration(), CeleryIntegration()],
        traces_sample_rate=max(0.0, min(settings.SENTRY_TRACES_SAMPLE_RATE, 1.0)),
        environment=settings.ENVIRONMENT,
        release=settings.APP_VERSION,
        send_default_pii=False,
        before_send=_scrub_sentry_event,
    )


HTTP_REQUESTS_TOTAL = Counter(
    "narchi_http_requests_total",
    "Nombre total de requêtes HTTP",
    ["method", "route", "status"],
)
HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "narchi_http_request_duration_seconds",
    "Latence HTTP en secondes",
    ["method", "route"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30),
)
HTTP_REQUESTS_IN_PROGRESS = Gauge(
    "narchi_http_requests_in_progress",
    "Requêtes HTTP actuellement en traitement",
    ["method"],
)
IFC_TASK_DURATION_SECONDS = Histogram(
    "narchi_ifc_task_duration_seconds",
    "Durée des tâches IFC Celery",
    ["status"],
    buckets=(1, 5, 10, 30, 60, 120, 300, 600, 1200, 1800),
)
PDF_TASK_DURATION_SECONDS = Histogram(
    "narchi_pdf_task_duration_seconds",
    "Durée des tâches PDF Celery",
    ["status"],
    buckets=(0.5, 1, 2.5, 5, 10, 30, 60, 120, 300),
)


class PrometheusMetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        if request.url.path in {"/metrics", "/health", "/api/health"}:
            return await call_next(request)

        method = request.method
        started = time.perf_counter()
        HTTP_REQUESTS_IN_PROGRESS.labels(method=method).inc()
        status_code = "500"
        try:
            response = await call_next(request)
            status_code = str(response.status_code)
            return response
        except Exception as error:
            sentry_sdk.capture_exception(error)
            raise
        finally:
            HTTP_REQUESTS_IN_PROGRESS.labels(method=method).dec()
            route = request.scope.get("route")
            route_label = getattr(route, "path", "unmatched")
            elapsed = time.perf_counter() - started
            HTTP_REQUESTS_TOTAL.labels(
                method=method, route=route_label, status=status_code
            ).inc()
            HTTP_REQUEST_DURATION_SECONDS.labels(
                method=method, route=route_label
            ).observe(elapsed)


def get_prometheus_metrics_payload() -> bytes:
    return generate_latest()
