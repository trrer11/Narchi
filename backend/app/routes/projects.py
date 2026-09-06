"""
NARCHI V5 — Projects & Cloud Integration Router (SecOps Hardened).
Handles secure multi-tenant project management, S3/R2 presigned POST provisioning,
and logic-based database record creation using certified Cloud Metadata (HEAD).
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, Dict, Any
import uuid
from pathlib import Path

from app.database import get_db
from app.models.user import User
from app.models.project import Project
from app.core.security import get_current_user
from app.services.storage_service import storage_service
from app.services.quota_service import QuotaService
from app.middlewares.quota_guard import verify_storage_quota_allowance
from app.core.logging import get_logger
from app.core.pagination import decode_cursor, encode_cursor

logger = get_logger("routes.projects")
router = APIRouter(prefix="/api/v5/projects", tags=["SaaS Multi-Tenant Projects"])

# ============================================================================
# PYDANTIC SCHEMAS
# ============================================================================
class ProjectCreateRequest(BaseModel):
    id: Optional[str] = None
    code: str
    name: str
    file_name: str
    object_key: str
    grossFloorArea: float
    floors: int
    location: str

class PresignedPostResponse(BaseModel):
    url: str
    fields: dict
    key: str
    bucket: str
    file_name: str
    method: str


@router.get("/presigned-url", response_model=PresignedPostResponse, dependencies=[Depends(verify_storage_quota_allowance)])
async def get_project_upload_presigned_post(
    file_name: str = Query(..., description="Le nom original du fichier IFC/DWG à uploader"),
    file_size_bytes: int = Query(..., description="La taille attendue du fichier à téléverser en octets (FinOps Guard)"),
    current_user: User = Depends(get_current_user)
):
    """
    Fournit une URL et des champs pré-signés de type POST pour téléverser un fichier directement vers S3/R2.
    Protège la bande passante de l'API en déléguant le flux de données au navigateur.
    La clé de stockage générée est isolée dans le répertoire du locataire connecté.
    La signature de dépôt impose cryptographiquement les limites de taille (content-length-range).
    """
    tenant_id = current_user.tenant_id
    # Signature POST robuste de classe entreprise avec clauses de contraintes
    presigned_data = storage_service.generate_presigned_upload_post(
        tenant_id=tenant_id, 
        file_name=file_name,
        file_size_bytes=file_size_bytes
    )
    return presigned_data


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_multi_tenant_project(
    req: ProjectCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Enregistre un nouveau projet BIM en base de données de manière logicielle.
    Récupère et certifie de manière hermétique la taille réelle du fichier par requête S3 HEAD (Zero Trust).
    Applique le contrôle final de quota et bloque l'enregistrement si l'utilisateur a dépassé sa limite.
    """
    # Injection synchrone du tenant_id dans la session SQLAlchemy pour activer l'intercepteur ORM
    db.info["tenant_id"] = current_user.tenant_id

    project_id = req.id or str(uuid.uuid4())
    
    cloud_file_path = req.object_key
    expected_prefix = f"tenants/{current_user.tenant_id}/files/"
    if not cloud_file_path.startswith(expected_prefix):
        raise HTTPException(status_code=403, detail="Clé objet hors tenant")

    # 1. AUTHENTICATION FORENSIQUE DU STOCKAGE CLOUD (S3 HEAD Object)
    # Plus aucune confiance envers les valeurs déclarées par le client.
    cloud_metadata = storage_service.get_cloud_object_metadata(
        tenant_id=current_user.tenant_id,
        object_key=cloud_file_path
    )
    
    physical_file_size = cloud_metadata["size_bytes"]
    if Path(req.file_name).suffix.lower() in {".ifc", ".step"}:
        signature = storage_service.get_object_header_bytes(
            current_user.tenant_id,
            cloud_file_path,
            byte_count=16,
        )
        if not signature.startswith(b"ISO-10303-21"):
            raise HTTPException(status_code=400, detail="Signature STEP/IFC invalide")

    # 2. CONTRÔLE FINAL D'ADMISSIBILITÉ DE QUOTA FINOPS
    # On compare la somme accumulée existante + la taille RÉELLE lue sur le Cloud
    is_allowed = QuotaService.check_quota_allowance(
        db=db,
        tenant_id=current_user.tenant_id,
        incoming_file_size=physical_file_size
    )

    if not is_allowed:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="FinOps Protection: Le fichier téléversé provoque un dépassement de votre quota d'espace disque. Veuillez mettre à jour votre forfait."
        )

    try:
        new_proj = Project(
            id=project_id,
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,  # Forçage strict de la colocalisation tenant
            name=req.name,
            file_name=req.file_name,
            file_size_bytes=physical_file_size,  # Taille certifiée issue de S3/R2 (HEAD) !
            file_path=cloud_file_path,  # URI cloud exclusive
            status="UPLOADED",
            schema_version="PENDING",
            element_count=0,
            bgf=0,
            bri=0,
            ngf=0,
            storey_count=0,
            location_plz="10115",
            grossstadt=req.location.split(",")[0] if "," in req.location else req.location
        )
        
        db.add(new_proj)
        db.commit()
        db.refresh(new_proj)

        from app.core.celery_app import celery_app
        task = celery_app.send_task(
            "app.tasks.ifc_tasks.process_ifc_file_task",
            args=[current_user.tenant_id, new_proj.id, cloud_file_path, "s3"],
        )

        return {
            "status": "queued",
            "project_id": new_proj.id,
            "job_id": task.id,
            "tenant_id": new_proj.tenant_id,
            "file_path": new_proj.file_path,
            "file_size_bytes": new_proj.file_size_bytes,
            "status_url": f"/api/v5/ifc/jobs/{new_proj.id}",
            "message": "Projet validé et parsing Celery planifié."
        }
    except Exception as error:
        db.rollback()
        if "new_proj" in locals() and new_proj.id:
            persisted = db.query(Project).filter(Project.id == new_proj.id).first()
            if persisted is not None:
                persisted.status = "FAILED"
                db.commit()
        logger.exception("Project creation or queueing failed", extra={"error": str(error)})
        raise HTTPException(
            status_code=503,
            detail="Projet enregistré mais planification du worker indisponible."
        ) from error


@router.get("", response_model=list)
async def list_tenant_projects(
    response: Response,
    cursor: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Liste keyset O(log N), triée par date/id, sans OFFSET coûteux."""
    db.info["tenant_id"] = current_user.tenant_id
    query = db.query(Project)
    if cursor:
        try:
            cursor_date, cursor_id = decode_cursor(cursor)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        query = query.filter(
            or_(
                Project.created_at < cursor_date,
                and_(Project.created_at == cursor_date, Project.id < cursor_id),
            )
        )

    rows = (
        query.order_by(Project.created_at.desc(), Project.id.desc())
        .limit(limit + 1)
        .all()
    )
    projects = rows[:limit]
    if len(rows) > limit and projects:
        response.headers["X-Cursor"] = encode_cursor(
            projects[-1].created_at, projects[-1].id
        )
    response.headers["X-Page-Limit"] = str(limit)

    return [
        {
            "id": project.id,
            "user_id": project.user_id,
            "tenant_id": project.tenant_id,
            "name": project.name,
            "file_name": project.file_name,
            "file_path": project.file_path,
            "file_size_bytes": project.file_size_bytes,
            "status": project.status,
            "bgf": project.bgf,
            "storey_count": project.storey_count,
            "location_plz": project.location_plz,
            "created_at": project.created_at,
        }
        for project in projects
    ]
