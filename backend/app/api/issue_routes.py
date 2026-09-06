# §115 — API Mängel serveur (étape 1 de la synchro inter-appareils).
#
# Contrat public, dit dans docs/SYNCHRO_MANGELS.md :
#   GET  /api/v5/issues?since=<ISO>&project_id=<id>&limit=<n>
#       → delta (updated_at > since, tombstones INCLUSES) ou tout si absent ;
#         server_time = curseur du prochain appel, fourni par le SERVEUR.
#   POST /api/v5/issues/batch      → poussée d'upserts (LWW client-timestamp)
#   GET  /api/v5/issues/{id}       → 404 hors tenant (identique à §80/§108)
#   DELETE /api/v5/issues/{id}     → pierre tombale (updated_at = maintenant)
#
# Dernière-écriture-gagne, horodatage côté APPAREIL (le bureau qui note à
# 16:58 sur le chantier gagne même s'il rentre à 18:00) ; seul biais connu
# et DIT : une horloge d'appareil déréglée fait gagner ce tort — limite
# documentée, pas de fausse fusion « intelligente ».
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.core.security import get_current_user
from app.database import get_db
from app.models.baustelle_issue import BaustelleIssue
from app.models.user import User
from app.schemas.baustelle_issue import (
    IssueApplied,
    IssueBatchRequest,
    IssueBatchResponse,
    IssueListResponse,
    IssueOut,
)

router = APIRouter(prefix="/api/v5/issues", tags=["Baustelle Mängel (sync) §115"])
logger = get_logger("issues")

LIMITE_MAX = 500  # cap ferme : un delta ne rend jamais la base entière par accident


def _issue_out(i: BaustelleIssue) -> IssueOut:
    return IssueOut(
        id=i.id,
        project_id=i.project_id,
        day=i.day,
        title=i.title,
        description=i.description or "",
        zone=i.zone or "",
        severity=i.severity,
        status=i.status,
        photo_ids=list(i.photo_ids or []),
        video_ids=list(i.video_ids or []),
        created_by=i.created_by,
        created_at=i.created_at,
        updated_at=i.updated_at,
        deleted_at=i.deleted_at,
    )


def _own_or_404(db: Session, issue_id: str, tenant_id: str) -> BaustelleIssue:
    # Filtre tenant EXPLICITE : aucune lecture hors périmètre (garde §80).
    issue = (
        db.query(BaustelleIssue)
        .filter(BaustelleIssue.id == issue_id, BaustelleIssue.tenant_id == tenant_id)
        .first()
    )
    if issue is None:
        raise HTTPException(status_code=404, detail="Mangel introuvable")
    return issue


@router.get("", response_model=IssueListResponse)
def list_issues(
    since: datetime | None = Query(default=None),
    project_id: str | None = Query(default=None),
    limit: int = Query(default=LIMITE_MAX, ge=1, le=LIMITE_MAX),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    q = db.query(BaustelleIssue).filter(BaustelleIssue.tenant_id == current_user.tenant_id)
    if since is not None:
        q = q.filter(BaustelleIssue.updated_at > since)
    if project_id:
        q = q.filter(BaustelleIssue.project_id == project_id)
    rows = q.order_by(BaustelleIssue.updated_at.asc(), BaustelleIssue.id.asc()) \
            .limit(limit + 1).all()
    truncated = len(rows) > limit
    return IssueListResponse(
        issues=[_issue_out(i) for i in rows[:limit]],
        server_time=datetime.now(timezone.utc),
        truncated=truncated,
    )


@router.post("/batch", response_model=IssueBatchResponse)
def push_batch(
    req: IssueBatchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    results: list[IssueApplied] = []
    for item in req.items:
        existing = (
            db.query(BaustelleIssue)
            .filter(
                BaustelleIssue.id == item.id,
                BaustelleIssue.tenant_id == current_user.tenant_id,
            )
            .first()
        )
        if existing is not None and existing.updated_at is not None:
            ref = existing.updated_at
            ref_utc = ref if ref.tzinfo else ref.replace(tzinfo=timezone.utc)
            if ref_utc >= item.updated_at:
                # Le serveur détient déjà aussi récent : la poussée est
                # DÉCLINÉE et le gagnant est dit (jamais de silence).
                results.append(IssueApplied(id=item.id, applied=False, server_updated_at=ref_utc))
                continue
        if existing is None:
            existing = BaustelleIssue(
                id=item.id,
                tenant_id=current_user.tenant_id,
                project_id=item.project_id,
                created_by=current_user.id,
            )
            db.add(existing)
        existing.project_id = item.project_id
        existing.day = item.day
        existing.title = item.title.strip()
        existing.description = item.description
        existing.zone = item.zone
        existing.severity = item.severity
        existing.status = item.status
        existing.photo_ids = item.photo_ids
        existing.video_ids = item.video_ids
        existing.updated_at = item.updated_at
        # §117 — RÉSURRECTION DITE : un upsert APPLIQUÉ est par définition
        # plus récent que la pierre tombale éventuelle (sinon décliné
        # plus haut) → l'écriture la plus récente fait REVIVRE la ligne,
        # au lieu de la laisser morte avec un contenu frais (divergence
        # muette découverte en écrivant l'étape 2 : le moteur navigateur
        # devait pouvoir « dé-supprimer » une édition hors-ligne).
        existing.deleted_at = None
        results.append(IssueApplied(id=item.id, applied=True, server_updated_at=item.updated_at))
    db.commit()
    logger.info("issues.batch tenant=%s user=%s appliqués=%s/%s",
                current_user.tenant_id, current_user.id,
                sum(1 for r in results if r.applied), len(results))
    return IssueBatchResponse(results=results)


@router.get("/{issue_id}", response_model=IssueOut)
def get_issue(
    issue_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    return _issue_out(_own_or_404(db, issue_id, current_user.tenant_id))


@router.delete("/{issue_id}", response_model=IssueOut)
def delete_issue(
    issue_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    issue = _own_or_404(db, issue_id, current_user.tenant_id)
    if issue.deleted_at is None:
        # Pierre tombale : la ligne reste pour que le delta des AUTRES
        # appareils apprenne la suppression (un DELETE dur serait muet).
        issue.deleted_at = datetime.now(timezone.utc)
        issue.updated_at = issue.deleted_at
        db.commit()
        logger.info("issues.suppression tenant=%s user=%s id=%s",
                    current_user.tenant_id, current_user.id, issue_id)
    return _issue_out(issue)
