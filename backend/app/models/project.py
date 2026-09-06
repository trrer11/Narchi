"""NARCHI V5 — Projets, estimations DIN 276 et lignes KG normalisées."""

from __future__ import annotations

import uuid

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from app.database import Base
from app.models.tenant_mixin import HasTenantColumn


def generate_uuid() -> str:
    return str(uuid.uuid4())


class Project(HasTenantColumn, Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name = Column(String, nullable=False)
    file_name = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    file_size_bytes = Column(Integer, default=0, nullable=False)
    status = Column(String, default="UPLOADED", nullable=False)
    schema_version = Column(String, default="IFC2X3")
    element_count = Column(Integer, default=0)
    bgf = Column(Float, default=0.0)
    bri = Column(Float, default=0.0)
    ngf = Column(Float, default=0.0)
    storey_count = Column(Integer, default=1)
    location_plz = Column(String, default="10115")
    grossstadt = Column(String, default="Berlin")
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    estimations = relationship(
        "CostEstimation", back_populates="project", cascade="all, delete-orphan"
    )


class CostEstimation(HasTenantColumn, Base):
    __tablename__ = "cost_estimations"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    project_id = Column(
        String,
        ForeignKey("projects.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    gebaeudeart = Column(String, default="MFH")
    standard = Column(String, default="mittel")
    regional_faktor = Column(Float, default=1.08)
    index_faktor = Column(Float, default=1.0636)
    total_netto = Column(Float, nullable=False)
    total_brutto = Column(Float, nullable=False)
    cost_per_m2_bgf = Column(Float, nullable=False)
    confidence_low_80 = Column(Float, nullable=False)
    confidence_high_80 = Column(Float, nullable=False)
    co2_total_kg = Column(Float, default=0.0)
    co2_per_m2 = Column(Float, default=0.0)
    geg_conform = Column(Boolean, default=True)
    hoai_honorar_netto = Column(Float, default=0.0)
    audit_hash = Column(String, nullable=False)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    project = relationship("Project", back_populates="estimations")
    kg_items = relationship(
        "CostEstimationItem",
        back_populates="estimation",
        cascade="all, delete-orphan",
        order_by="CostEstimationItem.kg_code",
        lazy="selectin",
    )

    @property
    def kg_breakdown(self) -> list[dict]:
        """Compatibilité API : construit le JSON depuis les lignes SQL normalisées."""
        return [item.as_dict() for item in self.kg_items]


class CostEstimationItem(HasTenantColumn, Base):
    __tablename__ = "cost_estimation_items"
    __table_args__ = (
        UniqueConstraint("estimation_id", "kg_code", name="uq_cost_item_estimation_kg"),
    )

    id = Column(String, primary_key=True, default=generate_uuid)
    estimation_id = Column(
        String,
        ForeignKey("cost_estimations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kg_code = Column(String(16), nullable=False, index=True)
    label = Column(String(255), nullable=False)
    amount = Column(Numeric(16, 2), nullable=False)
    per_m2 = Column(Numeric(16, 2), nullable=False, default=0)
    share_pct = Column(Numeric(7, 3), nullable=False, default=0)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    estimation = relationship("CostEstimation", back_populates="kg_items")

    def as_dict(self) -> dict:
        return {
            "code": self.kg_code,
            "label": self.label,
            "amount": float(self.amount),
            "perM2": float(self.per_m2),
            "share_pct": float(self.share_pct),
        }


Index("idx_projects_tenant_id_id", Project.tenant_id, Project.id)
Index(
    "idx_projects_tenant_created_id",
    Project.tenant_id,
    Project.created_at,
    Project.id,
)
Index("idx_cost_estimations_tenant_id_id", CostEstimation.tenant_id, CostEstimation.id)
Index(
    "idx_cost_items_tenant_kg_estimation",
    CostEstimationItem.tenant_id,
    CostEstimationItem.kg_code,
    CostEstimationItem.estimation_id,
)

# Enregistre les intercepteurs ORM multi-tenant au chargement des modèles.
import app.core.tenant_interceptor  # noqa: E402,F401
