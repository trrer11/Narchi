# §118 — Synchro des Projets (miroir serveur). Plainte client : « un
# projet importé, invisible sur l'autre compte » — les Projets étaient les
# SEULES entités-clés sans vérité partagée (d'où les Mängel « garés »).
#
#   GET    /api/v5/project-sync?since=&limit=  → delta (tombstones incluses)
#   POST   /api/v5/project-sync/batch          → upserts LWW (verdict écrit)
#   GET    /api/v5/project-sync/{id}           → 404 hors tenant
#   DELETE /api/v5/project-sync/{id}           → pierre tombale idempotente
#
# Mêmes lois que §115/§117 : dernier-écrivain-gagne sur l'horodatage
# APPAREIL ; un upsert appliqué RÉSSUSCITE une pierre tombale ; le delta
# porte les suppressions sinon un appareil garderait l'ancien projet.
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.core.security import get_current_user
from app.database import get_db
from app.models.project_mirror import ProjectMirror
from app.models.user import User
from app.schemas.project_sync import (
    ProjectSyncApplied,
    ProjectSyncBatchRequest,
    ProjectSyncBatchResponse,
    ProjectSyncListResponse,
    ProjectSyncOut,
)

router = APIRouter(prefix="/api/v5/project-sync", tags=["Projet Sync §118"])
logger = get_logger("project-sync")

LIMITE_MAX = 500


def _out(p: ProjectMirror) -> ProjectSyncOut:
    return ProjectSyncOut(
        id=p.id,
        name=p.name,
        payload=dict(p.payload or {}),
        created_by=p.created_by,
        created_at=p.created_at,
        updated_at=p.updated_at,
        deleted_at=p.deleted_at,
    )


def _own_or_404(db: Session, project_id: str, tenant_id: str) -> ProjectMirror:
    row = (
        db.query(ProjectMirror)
        .filter(ProjectMirror.id == project_id, ProjectMirror.tenant_id == tenant_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Projekt nicht gefunden")
    return row


@router.get("", response_model=ProjectSyncListResponse)
def list_projects(
    since: datetime | None = Query(default=None),
    limit: int = Query(default=LIMITE_MAX, ge=1, le=LIMITE_MAX),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    q = db.query(ProjectMirror).filter(ProjectMirror.tenant_id == current_user.tenant_id)
    if since is not None:
        q = q.filter(ProjectMirror.updated_at > since)
    rows = q.order_by(ProjectMirror.updated_at.asc(), ProjectMirror.id.asc()) \
            .limit(limit + 1).all()
    truncated = len(rows) > limit
    return ProjectSyncListResponse(
        projects=[_out(p) for p in rows[:limit]],
        server_time=datetime.now(timezone.utc),
        truncated=truncated,
    )


@router.post("/batch", response_model=ProjectSyncBatchResponse)
def push_batch(
    req: ProjectSyncBatchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    results: list[ProjectSyncApplied] = []
    for item in req.items:
        existing = (
            db.query(ProjectMirror)
            .filter(
                ProjectMirror.id == item.id,
                ProjectMirror.tenant_id == current_user.tenant_id,
            )
            .first()
        )
        if existing is not None and existing.updated_at is not None:
            ref = existing.updated_at
            ref_utc = ref if ref.tzinfo else ref.replace(tzinfo=timezone.utc)
            if ref_utc >= item.updated_at:
                results.append(
                    ProjectSyncApplied(id=item.id, applied=False, server_updated_at=ref_utc)
                )
                continue
        if existing is None:
            existing = ProjectMirror(
                id=item.id,
                tenant_id=current_user.tenant_id,
                created_by=current_user.id,
            )
            db.add(existing)
        existing.name = item.name.strip()
        existing.payload = dict(item.payload)
        existing.updated_at = item.updated_at
        # Résurrection DÈS L'ORIGINE (leçon §117) : un upsert appliqué est
        # plus récent que la pierre tombale → la ligne revit.
        existing.deleted_at = None
        results.append(
            ProjectSyncApplied(id=item.id, applied=True, server_updated_at=item.updated_at)
        )
    db.commit()
    logger.info(
        "project-sync.batch tenant=%s user=%s appliqués=%s/%s",
        current_user.tenant_id, current_user.id,
        sum(1 for r in results if r.applied), len(results),
    )
    return ProjectSyncBatchResponse(results=results)


@router.get("/{project_id}", response_model=ProjectSyncOut)
def get_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    return _out(_own_or_404(db, project_id, current_user.tenant_id))


@router.delete("/{project_id}", response_model=ProjectSyncOut)
def delete_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    row = _own_or_404(db, project_id, current_user.tenant_id)
    if row.deleted_at is None:
        row.deleted_at = datetime.now(timezone.utc)
        row.updated_at = row.deleted_at
        db.commit()
    return _out(row)
