# backend/app/main.py
# ============================================================================
# NARCHI — FastAPI Application Entrypoint (production)
# Cible du Dockerfile : uvicorn app.main:app
# ============================================================================
from contextlib import asynccontextmanager
import asyncio
import os
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import settings
from app.core.logging import setup_logging, get_logger

# La journalisation doit être active avant l'import des routeurs : certains
# vérifient Redis ou d'autres dépendances dès leur chargement.
setup_logging(
    level=settings.LOG_LEVEL if hasattr(settings, "LOG_LEVEL") else "INFO",
    json_format=not settings.DEBUG,
    include_stdlib=True,
)
logger = get_logger("main")

from app.database import Base, engine, SessionLocal
from app.api import (
    auth_routes,
    diagnostic_routes,
    ifc_routes,
    feedback_routes,
    reminder_routes,
    report_routes,
    chat_routes,
    price_routes,
    estimation_routes,
    office_price_routes,
    subscription_routes,
    invite_routes,
    branding_routes,
    collab_routes,
    collab_ws_routes,
    members_routes,
    issue_routes,
    invoice_routes,
    project_sync_routes,
    ve_variant_sync_routes,
    office_blob_sync_routes,
    system_status_routes,
    media_routes,
    iq_routes,
    webauthn_routes,
    office_sender_routes,
)
from app.routes import projects, parser_routes, upload_validation
from app.core.security import ensure_default_admins
from app.models.audit_log import AuditLog  # Inscription de la table d'audit SOC2 immuable
from app.core import tenant_interceptor  # Inscription explicite des intercepteurs ORM Multi-Tenant
from app.core.cors import configure_cors
from app.core.tenant.middleware import TenantIsolationMiddleware
from app.core.telemetry import PrometheusMetricsMiddleware, get_prometheus_metrics_payload
from app.core.audit_partitions import ensure_audit_partitions
from app.middlewares.request_diagnostics import RequestDiagnosticsMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager - startup and shutdown."""
    logger.info(
        "NARCHI V5 starting",
        extra={
            "event_code": "BACKEND_STARTING",
            "app_version": settings.APP_VERSION,
            "environment_name": settings.ENVIRONMENT,
            "log_level": settings.LOG_LEVEL,
        },
    )

    db = SessionLocal()
    advisory_lock_acquired = False
    try:
        db.execute(text("SELECT 1"))
        logger.info(
            "Database connectivity validated",
            extra={"event_code": "DATABASE_CONNECTION_OK", "driver": engine.dialect.name},
        )
        ensure_audit_partitions(engine, months_ahead=12)

        if engine.dialect.name == "postgresql":
            advisory_lock_acquired = bool(
                db.execute(text("SELECT pg_try_advisory_lock(7242505)")).scalar()
            )
        else:
            advisory_lock_acquired = True

        if advisory_lock_acquired:
            seeded_admin = ensure_default_admins(db)
            if seeded_admin is not None:
                logger.info(
                    "Bootstrap admin provisioning completed",
                    extra={"event_code": "ADMIN_PROVISIONING_COMPLETED"},
                )
    except Exception as error:
        logger.exception(
            "Database startup validation failed",
            extra={
                "event_code": "DATABASE_STARTUP_FAILED",
                "error_type": type(error).__name__,
            },
        )
        if settings.ENVIRONMENT.lower() == "production":
            raise
    finally:
        if advisory_lock_acquired and engine.dialect.name == "postgresql":
            try:
                db.execute(text("SELECT pg_advisory_unlock(7242505)"))
            except Exception as unlock_error:
                logger.warning(
                    "Advisory lock release failed",
                    extra={
                        "event_code": "DATABASE_LOCK_RELEASE_FAILED",
                        "error_type": type(unlock_error).__name__,
                    },
                )
        db.close()

    logger.info(
        "NARCHI V5 startup complete",
        extra={"event_code": "BACKEND_READY"},
    )

    # §46 — Worker rappels serveur : sonne même onglet NARCHI fermé (e-mail
    # si SMTP configuré + pull in-app à la réouverture). Désactivable par env
    # et TOUJOURS coupé hors production « test » (les tests pilotent le cycle
    # manuellement — jamais de minuterie concurrente).
    reminder_stop: asyncio.Event | None = None
    reminder_task: asyncio.Task | None = None
    if settings.REMINDER_WORKER_ENABLED and settings.ENVIRONMENT.lower() not in {"test", "ci"}:
        from app.services.reminder_service import reminder_worker_loop

        reminder_stop = asyncio.Event()
        reminder_task = asyncio.create_task(reminder_worker_loop(settings, reminder_stop))

    yield

    logger.info("NARCHI V5 shutting down", extra={"event_code": "BACKEND_STOPPING"})
    if reminder_stop is not None and reminder_task is not None:
        reminder_stop.set()
        try:
            await asyncio.wait_for(reminder_task, timeout=5)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            reminder_task.cancel()
    await chat_routes.close_chat_resources()
    if auth_routes.redis_client is not None:
        auth_routes.redis_client.close()


app = FastAPI(
    title=settings.APP_NAME,
    description="Industrial-grade BIM Audit and Costing Engine",
    version=settings.APP_VERSION,
    docs_url="/api/docs" if settings.DEBUG else None,
    redoc_url=None,
    lifespan=lifespan,
)

# ============================================================================
# MIDDLEWARE STACK (order matters - first added = innermost)
# ============================================================================

# 1. Multi-tenant isolation (innermost - authenticated)
app.add_middleware(TenantIsolationMiddleware)

# 2. CORS (must be before TenantIsolation to handle preflight OPTIONS)
_allowed_origins = [o for o in settings.CORS_ORIGINS if o != "*"] or [
    "http://localhost:8080",
    "http://localhost:3000",
]
configure_cors(app, _allowed_origins)

# 3. Prometheus Metrics
app.add_middleware(PrometheusMetricsMiddleware)

# 4. Diagnostic HTTP (outermost): request_id visible dans tous les autres logs.
app.add_middleware(RequestDiagnosticsMiddleware)


# ============================================================================
# GLOBAL VALIDATION ERROR HANDLER
# ============================================================================
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Intercepts Pydantic validation errors with architect-friendly messages."""
    errors = []
    for error in exc.errors():
        field = " -> ".join(str(loc) for loc in error["loc"])
        errors.append(f"Field {field}: {error['msg']}")

    logger.warning(
        "Validation failed",
        extra={
            "event_code": "REQUEST_VALIDATION_FAILED",
            "path": request.url.path,
            "method": request.method,
            "validation_errors": errors,
            "client_host": request.client.host if request.client else "unknown"
        }
    )

    return JSONResponse(
        status_code=422,
        content={
            "status": "error",
            "type": "VALIDATION_FAILED",
            "message": "The provided geometric or regulatory data is invalid.",
            "details": errors,
        },
    )


# ============================================================================
# ROUTING
# ============================================================================
app.include_router(auth_routes.router)
app.include_router(diagnostic_routes.router)
app.include_router(ifc_routes.router)
app.include_router(ifc_routes.compat_router)
app.include_router(feedback_routes.router)
app.include_router(report_routes.router)
app.include_router(chat_routes.router)
app.include_router(projects.router)
app.include_router(parser_routes.router)
app.include_router(upload_validation.router)
app.include_router(price_routes.router)
app.include_router(estimation_routes.router)
app.include_router(subscription_routes.router)
# §46 — Serverseitige Terminerinnerungen (rappels même NARCHI fermé)
app.include_router(reminder_routes.router)
app.include_router(office_price_routes.router)
# §68 — Einladungen par lien signé (bêta : inviter sans créer à la main)
app.include_router(invite_routes.router)
app.include_router(branding_routes.router)
app.include_router(collab_routes.router)
app.include_router(collab_ws_routes.router)
app.include_router(members_routes.router)
app.include_router(issue_routes.router)
app.include_router(invoice_routes.router)
app.include_router(project_sync_routes.router)
app.include_router(ve_variant_sync_routes.router)
app.include_router(office_blob_sync_routes.router)
app.include_router(system_status_routes.router)
app.include_router(media_routes.router)
app.include_router(iq_routes.router)
app.include_router(webauthn_routes.router)
app.include_router(office_sender_routes.router)


# ============================================================================
# OPEN TELEMETRY INSTRUMENTATION (SOC2 / ISO 27001 Traceability)
# ============================================================================
try:
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    FastAPIInstrumentor.instrument_app(app)
    logger.info("✅ OpenTelemetry FastAPI Instrumentation active.")
except ImportError:
    logger.warning("⚠️ OpenTelemetry non installé. Tracing distribué désactivé.")

# ============================================================================
# HEALTH & METRICS ENDPOINTS
# ============================================================================
@app.get("/api/health")
async def health_check():
    return {"status": "operational", "version": settings.APP_VERSION}


@app.get("/health")
async def health_check_legacy():
    return {"status": "operational", "version": settings.APP_VERSION}


@app.get("/metrics")
async def get_prometheus_metrics():
    """Prometheus metrics scrape endpoint."""
    return Response(
        content=get_prometheus_metrics_payload(),
        media_type="text/plain; version=0.0.4; charset=utf-8"
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
        reload=settings.DEBUG,
    )