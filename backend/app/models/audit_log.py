"""NARCHI V5 — Journal SOC2 immuable, partitionné mensuellement."""

from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, Index, JSON, String, event, func

from app.database import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


class AuditLog(Base):
    """Entrée append-only. La clé inclut la date, exigée par PostgreSQL partitionné."""

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("idx_audit_logs_tenant_created", "tenant_id", "created_at"),
        Index("idx_audit_logs_tenant_action_created", "tenant_id", "action", "created_at"),
        {"postgresql_partition_by": "RANGE (created_at)"},
    )

    id = Column(String, primary_key=True, default=generate_uuid)
    created_at = Column(
        DateTime(timezone=True),
        primary_key=True,
        server_default=func.now(),
        nullable=False,
    )
    tenant_id = Column(String, nullable=False)
    user_id = Column(String, nullable=True)
    action = Column(String, nullable=False)
    ip_address = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    payload = Column(JSON, nullable=True)


@event.listens_for(AuditLog, "before_update", propagate=True)
def _prevent_audit_update(*_args) -> None:
    raise ValueError("audit_logs est append-only : UPDATE interdit")


@event.listens_for(AuditLog, "before_delete", propagate=True)
def _prevent_audit_delete(*_args) -> None:
    raise ValueError("audit_logs est append-only : DELETE interdit")
