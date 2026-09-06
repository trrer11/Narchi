"""
NARCHI V5 — Versioning des estimations avec diff.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Dict, List, Optional
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text, select, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship

from app.database import Base


class EstimationVersion(Base):
    __tablename__ = "estimation_versions"

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    estimation_id = Column(PG_UUID(as_uuid=True), nullable=False, index=True)
    project_id = Column(PG_UUID(as_uuid=True), nullable=False)
    tenant_id = Column(PG_UUID(as_uuid=True), nullable=False)
    version_number = Column(Integer, nullable=False)
    version_label = Column(String(100))
    content_hash = Column(String(64), nullable=False)
    estimation_data = Column(JSON, nullable=False)
    total_ht = Column(Numeric(14, 2))
    total_ttc = Column(Numeric(14, 2))
    element_count = Column(Integer)
    confidence_score = Column(Numeric(3, 2))
    created_by = Column(String(200))
    change_reason = Column(Text)
    parent_version_id = Column(PG_UUID(as_uuid=True), ForeignKey("estimation_versions.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


@dataclass
class EstimationDiff:
    version_from: int
    version_to: int
    added_lines: List[Dict]
    modified_lines: List[Dict]
    removed_lines: List[Dict]
    total_delta_ht: Decimal
    total_delta_percent: Decimal
    category_deltas: Dict[str, Decimal]


class EstimationVersioningService:
    async def save_version(
        self,
        session,
        estimation_data: dict,
        project_id: UUID,
        tenant_id: UUID,
        created_by: str,
        label: str = "",
        change_reason: str = "",
    ) -> EstimationVersion:
        result = await session.execute(
            select(func.max(EstimationVersion.version_number))
            .where(EstimationVersion.estimation_id == estimation_data["estimation_id"])
        )
        max_version = result.scalar() or 0

        content_str = json.dumps(estimation_data, sort_keys=True, default=str)
        content_hash = hashlib.sha256(content_str.encode()).hexdigest()

        # Clés allemandes prioritaires, alias historiques tolérés.
        total_netto = estimation_data.get("total_netto", estimation_data.get("total_ht", 0))
        total_brutto = estimation_data.get("total_brutto", estimation_data.get("total_ttc", 0))

        version = EstimationVersion(
            estimation_id=UUID(estimation_data["estimation_id"]),
            project_id=project_id,
            tenant_id=tenant_id,
            version_number=max_version + 1,
            version_label=label or f"Version {max_version + 1}",
            content_hash=content_hash,
            estimation_data=estimation_data,
            total_ht=Decimal(str(total_netto)),
            total_ttc=Decimal(str(total_brutto)),
            element_count=len(estimation_data.get("lines", [])),
            confidence_score=Decimal(str(estimation_data.get("confidence_score", 0))),
            created_by=created_by,
            change_reason=change_reason,
        )
        session.add(version)
        await session.commit()
        return version

    def compute_diff(
        self,
        version_a: EstimationVersion,
        version_b: EstimationVersion,
    ) -> EstimationDiff:
        data_a = version_a.estimation_data
        data_b = version_b.estimation_data

        lines_a = {l["line_number"]: l for l in data_a.get("lines", [])}
        lines_b = {l["line_number"]: l for l in data_b.get("lines", [])}

        added = [lines_b[key] for key in lines_b if key not in lines_a]
        removed = [lines_a[key] for key in lines_a if key not in lines_b]
        modified = []

        for key, line_b in lines_b.items():
            if key not in lines_a:
                continue
            line_a = lines_a[key]
            delta = Decimal(str(line_b["total_ht"])) - Decimal(str(line_a["total_ht"]))
            if abs(delta) > Decimal("0.01"):
                modified.append({
                    "before": line_a,
                    "after": line_b,
                    "delta_ht": delta,
                    "delta_percent": (
                        delta / Decimal(str(line_a["total_ht"])) * 100
                        if Decimal(str(line_a["total_ht"])) != 0
                        else Decimal("0")
                    ),
                })

        total_a = Decimal(str(data_a.get("total_netto", data_a.get("total_ht", 0))))
        total_b = Decimal(str(data_b.get("total_netto", data_b.get("total_ht", 0))))
        delta = total_b - total_a

        cats_a = {k: Decimal(str(v)) for k, v in data_a.get("totals_by_category", {}).items()}
        cats_b = {k: Decimal(str(v)) for k, v in data_b.get("totals_by_category", {}).items()}
        all_cats = set(cats_a.keys()) | set(cats_b.keys())
        category_deltas = {cat: cats_b.get(cat, Decimal(0)) - cats_a.get(cat, Decimal(0)) for cat in all_cats}

        return EstimationDiff(
            version_from=version_a.version_number,
            version_to=version_b.version_number,
            added_lines=added,
            modified_lines=modified,
            removed_lines=removed,
            total_delta_ht=delta,
            total_delta_percent=(delta / total_a * 100 if total_a != 0 else Decimal("0")),
            category_deltas=category_deltas,
        )
