"""§202 — Miroir JSON bureau (Mahnwesen, Stunden, Entscheidungslog)."""
from __future__ import annotations

from sqlalchemy import Column, DateTime, Index, PrimaryKeyConstraint, String, func
from sqlalchemy.types import JSON

from app.database import Base
from app.models.tenant_mixin import HasTenantColumn


class OfficeBlobMirror(HasTenantColumn, Base):
    __tablename__ = "office_blob_mirrors"

    kind = Column(String(40), nullable=False)
    payload = Column(JSON, nullable=False, default=dict)
    created_by = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False, index=True)

    __table_args__ = (
        PrimaryKeyConstraint("tenant_id", "kind"),
        Index("ix_office_blob_mirrors_tenant_updated", "tenant_id", "updated_at"),
    )
