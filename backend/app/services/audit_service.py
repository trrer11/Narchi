"""
NARCHI V5 — Async Audit Log Logic Service.
Handles thread-safe persistence of audit entries using FastAPI's BackgroundTasks
to ensure zero response latency on critical application routes.
"""

from sqlalchemy.orm import Session
from fastapi import BackgroundTasks
from app.database import SessionLocal
from app.models.audit_log import AuditLog
from app.core.logging import get_logger

logger = get_logger("services.audit")


def persist_audit_log(
    tenant_id: str,
    user_id: str,
    action: str,
    ip_address: str,
    user_agent: str,
    payload: dict = None
) -> None:
    """
    Fonction synchrone d'arrière-plan exécutée de manière non-bloquante.
    Ouvre une session transactionnelle dédiée pour persister le log d'audit.
    """
    db: Session = SessionLocal()
    try:
        if tenant_id:
            db.info["tenant_id"] = tenant_id
        log_entry = AuditLog(
            tenant_id=tenant_id,
            user_id=user_id,
            action=action,
            ip_address=ip_address,
            user_agent=user_agent,
            payload=payload or {}
        )
        db.add(log_entry)
        db.commit()
    except Exception as error:
        db.rollback()
        logger.exception(
            "Audit log persistence failed",
            extra={
                "event_code": "AUDIT_PERSISTENCE_FAILED",
                "tenant_id": tenant_id,
                "user_id": user_id,
                "audit_action": action,
                "error_type": type(error).__name__,
            },
        )
    finally:
        db.close()


class AuditService:
    @staticmethod
    def log_action(
        background_tasks: BackgroundTasks,
        tenant_id: str,
        user_id: str,
        action: str,
        ip_address: str,
        user_agent: str,
        payload: dict = None
    ) -> None:
        """
        Délègue l'écriture de l'audit log aux BackgroundTasks de FastAPI.
        Garantit que l'écriture disque ou réseau S3 ne bloque pas le traitement principal.
        """
        background_tasks.add_task(
            persist_audit_log,
            tenant_id,
            user_id,
            action,
            ip_address,
            user_agent,
            payload
        )
