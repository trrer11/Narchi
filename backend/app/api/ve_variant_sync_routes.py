# §163 — Synchro des VE-Varianten (miroir serveur). Les variantes (§160)
# vivaient en localStorage (un seul poste). Même vérité partagée que §118
# pour les Projets, sur une table dédiée :
#
#   GET    /api/v5/ve-variant-sync            → liste (tombstones incluses)
#   POST   /api/v5/ve-variant-sync/batch      → upserts LWW (verdict écrit)
#   GET    /api/v5/ve-variant-sync/{id}       → 404 hors tenant
#   DELETE /api/v5/ve-variant-sync/{id}       → pierre tombale idempotente
#
# Mêmes lois que §115/§117/§118 : dernier-écrivain-gagne sur l'horodatage
# APPAREIL ; un upsert appliqué RÉSSUSCITE une pierre tombale.
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.core.security import get_current_user
from app.database import get_db
from app.models.user import User
from app.models.ve_variant_mirror import VEVariantMirror
from app.schemas.ve_variant_sync import (
    VEVariantSyncApplied,
    VEVariantSyncBatchRequest,
    VEVariantSyncBatchResponse,
    VEVariantSyncListResponse,
    VEVariantSyncOut,
)

router = APIRouter(prefix="/api/v5/ve-variant-sync", tags=["VE-Varianten Sync §163"])
logger = get_logger("ve-variant-sync")

LIMITE_MAX = 500


def _out(v: VEVariantMirror) -> VEVariantSyncOut:
    return VEVariantSyncOut(
        id=v.id,
        name=v.name,
        payload=dict(v.payload or {}),
        created_by=v.created_by,
        created_at=v.created_at,
        updated_at=v.updated_at,
        deleted_at=v.deleted_at,
    )


def _own_or_404(db: Session, variant_id: str, tenant_id: str) -> VEVariantMirror:
    row = (
        db.query(VEVariantMirror)
        .filter(VEVariantMirror.id == variant_id, VEVariantMirror.tenant_id == tenant_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Variante nicht gefunden")
    return row


@router.get("", response_model=VEVariantSyncListResponse)
def list_variants(
    since: datetime | None = Query(default=None),
    limit: int = Query(default=LIMITE_MAX, ge=1, le=LIMITE_MAX),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    q = db.query(VEVariantMirror).filter(VEVariantMirror.tenant_id == current_user.tenant_id)
    if since is not None:
        q = q.filter(VEVariantMirror.updated_at > since)
    rows = q.order_by(VEVariantMirror.updated_at.asc(), VEVariantMirror.id.asc()) \
            .limit(limit + 1).all()
    truncated = len(rows) > limit
    return VEVariantSyncListResponse(
        variants=[_out(v) for v in rows[:limit]],
        server_time=datetime.now(timezone.utc),
        truncated=truncated,
    )


@router.post("/batch", response_model=VEVariantSyncBatchResponse)
def push_batch(
    req: VEVariantSyncBatchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    results: list[VEVariantSyncApplied] = []
    for item in req.items:
        existing = (
            db.query(VEVariantMirror)
            .filter(
                VEVariantMirror.id == item.id,
                VEVariantMirror.tenant_id == current_user.tenant_id,
            )
            .first()
        )
        if existing is not None and existing.updated_at is not None:
            ref = existing.updated_at
            ref_utc = ref if ref.tzinfo else ref.replace(tzinfo=timezone.utc)
            if ref_utc >= item.updated_at:
                results.append(
                    VEVariantSyncApplied(id=item.id, applied=False, server_updated_at=ref_utc)
                )
                continue
        if existing is None:
            existing = VEVariantMirror(
                id=item.id,
                tenant_id=current_user.tenant_id,
                created_by=current_user.id,
            )
            db.add(existing)
        existing.name = item.name.strip()
        existing.payload = dict(item.payload)
        existing.updated_at = item.updated_at
        existing.deleted_at = None  # résurrection (leçon §117)
        results.append(
            VEVariantSyncApplied(id=item.id, applied=True, server_updated_at=item.updated_at)
        )
    db.commit()
    logger.info(
        "ve-variant-sync.batch tenant=%s user=%s appliqués=%s/%s",
        current_user.tenant_id, current_user.id,
        sum(1 for r in results if r.applied), len(results),
    )
    return VEVariantSyncBatchResponse(results=results)


@router.get("/{variant_id}", response_model=VEVariantSyncOut)
def get_variant(
    variant_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    return _out(_own_or_404(db, variant_id, current_user.tenant_id))


@router.delete("/{variant_id}", response_model=VEVariantSyncOut)
def delete_variant(
    variant_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    row = _own_or_404(db, variant_id, current_user.tenant_id)
    if row.deleted_at is None:
        row.deleted_at = datetime.now(timezone.utc)
        row.updated_at = row.deleted_at
        db.commit()
    return _out(row)
