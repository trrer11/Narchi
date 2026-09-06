"""
NARCHI V5 — Asynchronous BIM Parsing Endpoints.
Exposes routes to trigger out-of-band IfcOpenShell triangulation tasks
and immediately yields execution control back to the client.
"""

from fastapi import APIRouter, Depends, status, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.user import User
from app.models.project import Project
from app.core.security import get_current_user
from app.core.celery_app import celery_app
from app.core.logging import get_logger

logger = get_logger("api.parser")
router = APIRouter(prefix="/api/v5/ifc", tags=["Asynchronous BIM Parsing"])

# ============================================================================
# PYDANTIC SCHEMAS
# ============================================================================
class ParseRequest(BaseModel):
    project_id: str
    file_key: str


@router.post("/parse", status_code=status.HTTP_202_ACCEPTED)
async def trigger_async_ifc_parsing(
    req: ParseRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Enclenche de manière asynchrone le traitement et parsing géométrique tridimensionnel (IfcOpenShell).
    Valide l'appartenance du projet sous l'isolation logique du locataire (tenant_id)
    et délègue le calcul lourd à la file d'attente distribuée Celery/Redis.
    Retourne immédiatement le statut HTTP 202 (Accepted) avec l'identifiant de la tâche.
    """
    # Alimentation du tenant_id de session pour contraindre la recherche de projet à l'isolation logique
    db.info["tenant_id"] = current_user.tenant_id

    # S'assurer que le projet appartient bien à l'agence détentrice du contexte utilisateur
    project = db.query(Project).filter(Project.id == req.project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Le projet spécifié est introuvable ou n'appartient pas à votre agence."
        )

    try:
        # Enclenchement de la tâche asynchrone distribuée dans Celery
        task = celery_app.send_task(
            "app.tasks.ifc_tasks.process_ifc_file_task",
            args=[current_user.tenant_id, req.project_id, req.file_key, "s3"],
        )

        return {
            "status": "accepted",
            "task_id": task.id,
            "project_id": req.project_id,
            "message": "Calculs géométriques et parsing de maquette planifiés dans la file d'attente."
        }
    except Exception as error:
        logger.exception(
            "IFC parsing task scheduling failed",
            extra={
                "event_code": "IFC_TASK_SCHEDULING_FAILED",
                "project_id": req.project_id,
                "tenant_id": current_user.tenant_id,
                "error_type": type(error).__name__,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Échec de planification du calcul asynchrone sur la file d'attente système."
        )
