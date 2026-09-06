"""§202 — GET/PUT /api/v5/office-blob/{kind} — LWW, cloison tenant."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database import get_db
from app.models.office_blob_mirror import OfficeBlobMirror
from app.models.user import User
from app.schemas.office_blob_sync import KINDS, OfficeBlobOut, OfficeBlobPut

router = APIRouter(prefix="/api/v5/office-blob", tags=["Office blob sync §202"])


def _check_kind(kind: str) -> str:
    if kind not in KINDS:
        raise HTTPException(status_code=404, detail="Unbekannter Büro-Datensatz")
    return kind


@router.get("/{kind}", response_model=OfficeBlobOut)
def get_blob(kind: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    kind = _check_kind(kind)
    db.info["tenant_id"] = current_user.tenant_id
    row = (
        db.query(OfficeBlobMirror)
        .filter(OfficeBlobMirror.tenant_id == current_user.tenant_id, OfficeBlobMirror.kind == kind)
        .first()
    )
    if row is None:
        return OfficeBlobOut(kind=kind, payload={}, updated_at=datetime.now(timezone.utc), empty=True)
    return OfficeBlobOut(kind=kind, payload=dict(row.payload or {}), updated_at=row.updated_at, empty=False)


@router.put("/{kind}", response_model=OfficeBlobOut)
def put_blob(
    kind: str,
    body: OfficeBlobPut,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    kind = _check_kind(kind)
    db.info["tenant_id"] = current_user.tenant_id
    row = (
        db.query(OfficeBlobMirror)
        .filter(OfficeBlobMirror.tenant_id == current_user.tenant_id, OfficeBlobMirror.kind == kind)
        .first()
    )
    if row is not None and row.updated_at is not None:
        ref = row.updated_at
        ref_utc = ref if ref.tzinfo else ref.replace(tzinfo=timezone.utc)
        if ref_utc >= body.updated_at:
            return OfficeBlobOut(kind=kind, payload=dict(row.payload or {}), updated_at=ref_utc, empty=False)
    if row is None:
        row = OfficeBlobMirror(
            tenant_id=current_user.tenant_id,
            kind=kind,
            created_by=current_user.id,
        )
        db.add(row)
    row.payload = dict(body.payload)
    row.updated_at = body.updated_at
    db.commit()
    db.refresh(row)
    return OfficeBlobOut(kind=kind, payload=dict(row.payload or {}), updated_at=row.updated_at, empty=False)
