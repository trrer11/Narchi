"""
NARCHI V5 — BIM / IFC & Calculation API Router (durci post-audit 360°).
Handles model uploads, QTO extraction, and DIN 276 cost computations.
Includes direct REST compatibility bridge for V2 React SPA (Port 8080).

Correctifs appliqués :
  A3-1  Event loop non bloquant : le parsing IfcOpenShell et la génération
        géométrique sont exclusivement exécutés par les workers Celery. L'API
        ne conserve que l'écriture bornée du flux et la planification du job.
  A3-2  Path Traversal éradiqué : chaque nom de fichier client est réduit à
        son basename assaini, puis le chemin final RÉSOLU est vérifié comme
        strictement contenu dans settings.UPLOAD_DIR. Toute tentative de
        contournement ("../", chemin absolu, octet NUL) => HTTP 400 immédiat.
  A3-3  Zero Trust S3 Upload : upload direct client → S3/R2 via presigned POST,
        validation HEAD Object avant enregistrement en base, quota FinOps.
"""

import hashlib
import json
import os
import re
import uuid

import redis
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Body, Request, status
from sqlalchemy.orm import Session
from pathlib import Path
from typing import Any, Dict
from pydantic import BaseModel

from app.database import get_db
from app.models.user import User
from app.models.project import Project
from app.schemas.ifc import ComputeRequest, ComputeResponse
from app.core.security import get_current_user
from app.core.ifc_pipeline import calculate_din276_estimate
from app.config import settings
from app.middlewares.dos_guard import verify_dos_protection
from app.services.storage_service import storage_service
from app.services.quota_service import QuotaService
from app.services.dxf_analysis import MAX_DXF_BYTES, DxfAnalysisError, analyze_dxf_bytes
from app.core.logging import get_logger

logger = get_logger("api.ifc")

# §60 — l'upload brut de maquettes n'avait AUCUN quota (seule la taille via
# QuotaService) : 10 uploads/minute par utilisateur, avant tout I/O disque.
from app.core.rate_limit import RedisSlidingWindowRateLimiter

upload_limiter = RedisSlidingWindowRateLimiter(max_attempts=10, window_seconds=60, namespace="ifc-upload")

_estimation_cache = redis.from_url(
    os.getenv("REDIS_URL", "redis://redis:6379/0"),
    decode_responses=True,
    socket_timeout=1,
)


def _estimation_cache_key(tenant_id: str, project: Project, req: ComputeRequest) -> str:
    canonical = json.dumps(
        {
            "tenant": tenant_id,
            "project": project.id,
            "bgf": project.bgf,
            "bri": project.bri,
            "type": req.gebaeudeart,
            "standard": req.bauklasse,
            "plz": req.plz,
            "city": req.grossstadt,
            "energy": req.energi_standard,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return "estimate:v5:" + hashlib.sha256(canonical.encode()).hexdigest()


router = APIRouter(prefix="/api/v5/ifc", tags=["BIM & IFC Pipeline"])
compat_router = APIRouter(tags=["Legacy unversioned compatibility bridge"])

# =====================================================================
# SÉCURITÉ FICHIERS — Correctif A3-2 (Path Traversal)
# =====================================================================

_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._\-]")
# §67 — HONNÊTETÉ FORMATS : .dwg/.rvt étaient acceptés mais JAMAIS parsés
# (seuls .ifc/.step partaient au pipeline). Refus explicite + guide de
# conversion plutôt qu'une promesse non tenue. .dxf = analysé (ezdxf).
_UNSUPPORTED_KNOWN_EXTENSIONS = {".dwg", ".rvt"}
_ALLOWED_EXTENSIONS = {".ifc", ".ifczip", ".ifcxml", ".step", ".dxf"}

def _sanitize_filename(raw_name: str) -> str:
    """Réduit un nom de fichier client à un basename inoffensif."""
    if not raw_name:
        raise HTTPException(status_code=400, detail="Nom de fichier manquant.")
    if "\x00" in raw_name:
        raise HTTPException(status_code=400, detail="Nom de fichier invalide (octet NUL).")

    if ".." in raw_name or "/" in raw_name or "\\" in raw_name:
        raise HTTPException(
            status_code=400,
            detail="Nom de fichier rejeté : séquence de traversée de répertoire détectée.",
        )

    basename = Path(raw_name).name
    if basename in ("", ".", ".."):
        raise HTTPException(status_code=400, detail="Nom de fichier invalide.")

    cleaned = _SAFE_FILENAME_RE.sub("_", basename)
    if not cleaned.strip("._"):
        raise HTTPException(status_code=400, detail="Nom de fichier invalide après assainissement.")

    suffix = Path(cleaned).suffix.lower()
    if suffix in _UNSUPPORTED_KNOWN_EXTENSIONS:
        # §67 — message-guide : ne jamais laisser croire que ça marche.
        raise HTTPException(
            status_code=400,
            detail=(
                f"{suffix.upper()[1:]} wird derzeit nicht direkt verarbeitet (ehrlich statt leeres Versprechen). "
                "Exportieren Sie in Ihrem CAD bitte IFC (Revit: Datei → Exportieren → IFC; Archicad: Datei → "
                "Speichern unter → IFC; Allplan: IFC-Schnittstelle) — oder DXF für 2D-Grundrisse : les fichiers "
                ".dxf sont analysés (calques, entités, surfaces fermées)."
            ),
        )
    if suffix not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Extension '{suffix or 'aucune'}' non autorisée. Formats acceptés : "
                   + ", ".join(sorted(_ALLOWED_EXTENSIONS)),
        )
    return cleaned[:180]

def secure_upload_path(raw_name: str, prefix: str = "") -> Path:
    """Construit un chemin d'écriture GARANTI à l'intérieur de UPLOAD_DIR."""
    safe_name = _sanitize_filename(raw_name)
    upload_root = settings.UPLOAD_DIR.resolve()
    candidate = (upload_root / f"{prefix}{safe_name}").resolve()

    if not candidate.is_relative_to(upload_root):
        raise HTTPException(
            status_code=400,
            detail="Chemin de fichier rejeté : tentative de sortie du répertoire d'upload détectée.",
        )
    return candidate

def _write_upload_to_disk(upload: UploadFile, target: Path) -> int:
    """Écrit le flux d'upload sur disque avec plafond de taille strict."""
    max_bytes = settings.MAX_UPLOAD_SIZE_BYTES
    written = 0
    chunk_size = 1024 * 1024
    try:
        with open(target, "wb") as buffer:
            while True:
                chunk = upload.file.read(chunk_size)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    raise ValueError(f"Fichier trop volumineux (> {max_bytes // (1024 * 1024)} Mo).")
                buffer.write(chunk)
    except ValueError:
        target.unlink(missing_ok=True)
        raise
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return written

class ProjectCreate(BaseModel):
    id: str
    code: str
    name: str
    type: str
    location: str
    client: str
    budget: float
    grossFloorArea: float
    floors: int
    startDate: str
    endDate: str

# =====================================================================
# UPLOAD ZERO TRUST — Presigned S3 + HEAD Validation
# =====================================================================

class PresignedUploadRequest(BaseModel):
    file_name: str
    file_size_bytes: int
    content_type: str = "application/octet-stream"

class PresignedUploadResponse(BaseModel):
    url: str
    fields: Dict[str, str]
    key: str
    bucket: str
    method: str
    file_name: str

@router.post("/upload/presigned", response_model=PresignedUploadResponse)
def get_presigned_upload_url(
    req: PresignedUploadRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Génère une URL pré-signée POST pour upload direct client → S3/R2.
    Le fichier ne passe JAMAIS par le backend (Zero Trust).
    """
    # 1. Vérifier le quota FinOps AVANT de générer l'URL
    quota_ok = QuotaService.check_quota_allowance(db, current_user.tenant_id, req.file_size_bytes)
    if not quota_ok:
        raise HTTPException(
            status_code=status.HTTP_507_INSUFFICIENT_STORAGE,
            detail="Quota de stockage dépassé pour votre agence."
        )

    # 2. Générer l'URL pré-signée avec contrainte de taille cryptographique
    result = storage_service.generate_presigned_upload_post(
        tenant_id=current_user.tenant_id,
        file_name=req.file_name,
        file_size_bytes=req.file_size_bytes,
        expires_in=3600
    )
    return result

class ConfirmUploadRequest(BaseModel):
    object_key: str
    declared_size: int


class AsyncUploadResponse(BaseModel):
    project_id: str
    job_id: str
    status: str
    status_url: str
    message: str


class DxfLayerStatOut(BaseModel):
    name: str
    entity_count: int
    closed_polyline_area: float


class DxfAnalysisOut(BaseModel):
    """§67 — résultat RÉEL d'analyse DXF (ezdxf). Tout est mesuré/compté."""
    filename: str
    dxf_version: str
    units: str
    entity_total: int
    entity_counts: Dict[str, int]
    layer_count: int
    layers: list[DxfLayerStatOut]
    block_definition_count: int
    block_reference_count: int
    text_entity_count: int
    closed_polyline_area_total: float
    area_method: str
    analysis_kind: str


class IfcJobStatusResponse(BaseModel):
    project_id: str
    status: str
    progress: int
    schema_version: str | None = None
    element_count: int = 0
    bgf: float = 0
    bri: float = 0
    ngf: float = 0
    storey_count: int = 0
    error: str | None = None


def _queue_project(
    *,
    db: Session,
    current_user: User,
    file_name: str,
    file_path: str,
    file_size: int,
    source: str,
) -> AsyncUploadResponse:
    from app.core.celery_app import celery_app

    project = Project(
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        name=f"Projet BIM ({file_name})",
        file_name=file_name,
        file_path=file_path,
        file_size_bytes=file_size,
        status="UPLOADED",
        schema_version="PENDING",
        element_count=0,
        bgf=0,
        bri=0,
        ngf=0,
        storey_count=0,
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    try:
        task = celery_app.send_task(
            "app.tasks.ifc_tasks.process_ifc_file_task",
            args=[current_user.tenant_id, project.id, file_path, source],
        )
    except Exception as error:
        project.status = "FAILED"
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Le worker IFC est indisponible; aucun parsing synchrone de secours n'a été lancé.",
        ) from error

    return AsyncUploadResponse(
        project_id=project.id,
        job_id=task.id,
        status="QUEUED",
        status_url=f"/api/v5/ifc/jobs/{project.id}",
        message="Fichier validé; parsing IFC planifié dans Celery.",
    )


@router.post(
    "/upload/confirm",
    response_model=AsyncUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def confirm_s3_upload(
    req: ConfirmUploadRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if req.declared_size <= 0:
        raise HTTPException(status_code=400, detail="Taille déclarée invalide")

    metadata = storage_service.get_cloud_object_metadata(
        tenant_id=current_user.tenant_id,
        object_key=req.object_key,
    )
    actual_size = int(metadata["size_bytes"])
    if abs(actual_size - req.declared_size) > max(1, req.declared_size * 0.02):
        raise HTTPException(
            status_code=400,
            detail="La taille S3 ne correspond pas à la taille déclarée.",
        )
    if not QuotaService.check_quota_allowance(
        db, current_user.tenant_id, actual_size
    ):
        raise HTTPException(status_code=507, detail="Quota de stockage dépassé.")

    file_name = _sanitize_filename(Path(req.object_key).name)
    if Path(file_name).suffix.lower() in {".ifc", ".step"}:
        header = storage_service.get_object_header_bytes(
            current_user.tenant_id, req.object_key, byte_count=16
        )
        if not header.startswith(b"ISO-10303-21"):
            raise HTTPException(status_code=400, detail="Signature STEP/IFC invalide.")

    return _queue_project(
        db=db,
        current_user=current_user,
        file_name=file_name,
        file_path=req.object_key,
        file_size=actual_size,
        source="s3",
    )


@router.post(
    "/upload",
    response_model=AsyncUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def upload_ifc_model(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # §60 — quota AVANT toute écriture disque / tâche Celery (SEC-003 : IP
    # lue depuis la connexion ASGI, jamais un en-tête forgeable).
    ip_address = request.client.host if request.client else "unknown"
    if not upload_limiter.check_and_record(f"user:{current_user.id}", ip_address):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Zu viele Uploads. Bitte spaeter erneut versuchen.",
        )
    unique_prefix = f"{current_user.id[:8]}_{uuid.uuid4().hex[:12]}_"
    file_path = secure_upload_path(file.filename or "", prefix=unique_prefix)
    try:
        size_bytes = _write_upload_to_disk(file, file_path)
    except ValueError as error:
        raise HTTPException(status_code=413, detail=str(error)) from error

    if not QuotaService.check_quota_allowance(
        db, current_user.tenant_id, size_bytes
    ):
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=507, detail="Quota de stockage dépassé.")

    return _queue_project(
        db=db,
        current_user=current_user,
        file_name=_sanitize_filename(file.filename or ""),
        file_path=str(file_path),
        file_size=size_bytes,
        source="local",
    )


@router.post("/dxf/analyze", response_model=DxfAnalysisOut)
def analyze_dxf_upload(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """§67 — Analyse DXF 2D immédiate (sans Celery, < 25 Mo).

    Retourne UNIQUEMENT des mesures réelles (calques, entités, surfaces
    fermées). Jamais de stockage permanent : le service travaille sur un
    fichier temporaire supprimé en `finally`.
    """
    ip_address = request.client.host if request.client else "unknown"
    if not upload_limiter.check_and_record(f"user:{current_user.id}", ip_address):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Zu viele Analysen. Bitte spaeter erneut versuchen.",
        )
    safe_name = _sanitize_filename(file.filename or "")
    if Path(safe_name).suffix.lower() != ".dxf":
        raise HTTPException(status_code=400, detail="Nur .dxf-Dateien werden hier analysiert.")

    payload = file.file.read(MAX_DXF_BYTES + 1)
    if len(payload) > MAX_DXF_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"DXF zu gross (max. {MAX_DXF_BYTES // (1024 * 1024)} Mo für die Sofort-Analyse).",
        )
    try:
        result = analyze_dxf_bytes(payload, safe_name)
    except DxfAnalysisError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    logger.info(
        "DXF analysé",
        extra={
            "event_code": "DXF_ANALYZED",
            "user_id": current_user.id,
            "filename": safe_name,
            "entity_total": result["entity_total"],
            "layer_count": result["layer_count"],
        },
    )
    return DxfAnalysisOut(**result)


@router.get("/jobs/{project_id}", response_model=IfcJobStatusResponse)
def get_ifc_job_status(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Projet introuvable")

    progress = 100 if project.status == "COMPLETED" else 0
    error = "Le parsing IFC a échoué." if project.status == "FAILED" else None
    if project.status in {"UPLOADED", "PROCESSING"}:
        try:
            import json
            import redis

            client = redis.from_url(
                os.getenv("REDIS_URL", "redis://redis:6379/0"),
                decode_responses=True,
                socket_timeout=1,
            )
            payload = client.get(f"job:ifc:{project.id}")
            if payload:
                state = json.loads(payload)
                progress = int(state.get("progress", progress))
                error = state.get("error")
        except Exception as error:
            # L'état SQL reste la source de vérité si Redis est indisponible.
            logger.warning(
                "IFC job status cache unavailable",
                extra={"project_id": project.id, "error": str(error)},
            )

    return IfcJobStatusResponse(
        project_id=project.id,
        status=project.status,
        progress=progress,
        schema_version=project.schema_version,
        element_count=project.element_count or 0,
        bgf=project.bgf or 0,
        bri=project.bri or 0,
        ngf=project.ngf or 0,
        storey_count=project.storey_count or 0,
        error=error,
    )


@router.post("/compute", response_model=ComputeResponse, dependencies=[Depends(verify_dos_protection)])
def compute_din276_estimate(
    req: ComputeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    project = db.query(Project).filter(Project.id == req.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable.")
    if project.status != "COMPLETED":
        raise HTTPException(status_code=409, detail="Le parsing IFC n'est pas terminé.")

    cache_key = _estimation_cache_key(current_user.tenant_id, project, req)
    try:
        cached = _estimation_cache.get(cache_key)
        if cached:
            return json.loads(cached)
    except redis.RedisError as error:
        logger.warning("DIN cache read failed", extra={"error": str(error)})

    estimation = calculate_din276_estimate(
        project, req.gebaeudeart, req.bauklasse, req.plz, req.grossstadt, db,
    )
    payload = {
        "estimation_id": estimation.id,
        "project_id": project.id,
        "kg": estimation.kg_breakdown,
        "total": estimation.total_netto,
        "total_brutto": estimation.total_brutto,
        "perM2": estimation.cost_per_m2_bgf,
        "bgf": project.bgf,
        "bri": project.bri,
        "ngf": project.ngf,
        "confidenceLow": estimation.confidence_low_80,
        "confidenceHigh": estimation.confidence_high_80,
        "co2Total": estimation.co2_total_kg,
        "co2PerM2": estimation.co2_per_m2,
        "gegConform": estimation.geg_conform,
        "foerderungen": ["KfW 261 Klimafreundlicher Neubau", "BAFA BEG WG"],
        "hoaiNetto": estimation.hoai_honorar_netto,
        "auditHash": estimation.audit_hash,
        "created_at": estimation.created_at.isoformat(),
    }
    try:
        _estimation_cache.setex(cache_key, 3600, json.dumps(payload))
    except redis.RedisError as error:
        logger.warning("DIN cache write failed", extra={"error": str(error)})
    return payload

# =====================================================================
# FRONTEND V2 REACT SPA COMPATIBILITY BRIDGE (/api/...)
# =====================================================================

@compat_router.get("/api/health")
async def compat_health():
    return {"status": "ok", "version": settings.APP_VERSION}

# §49 — SUPPRIMÉ (audit prix 2026-08-06) : les endpoints compat
# /api/precision/data/search, /api/markt/forecast et /api/foerderung/match
# renvoyaient des DONNÉES CODÉES EN DUR (« 169.7 » présenté comme Q2/2026,
# montants KfW inventés) — contraires à la charte, aucun appelant frontend.
# Source d'indices officielle unique : Destatis bpr110 (front
# src/data/destatisIndex.ts ; backend price_revision.py synchro GENESIS).
# /api/health reste inchangé ; /api/copilot/ask (RAG + facturation réelle,
# pas un mock) conservé pour les clients historiques.

@compat_router.post("/api/copilot/ask")
def compat_copilot(
    data: Dict[str, Any] = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.services.ai_audit_service import ai_audit_service
    from app.services.stripe_service import stripe_billing_service

    q = data.get("question", "")
    # Simulation des données du contexte IFC (en production : issues du body ou de la BDD)
    ifc_context_data = data.get("elements", [])
    
    # Exécution de l'Audit IA (RAG)
    tenant_id = current_user.tenant_id
    audit_result = ai_audit_service.run_compliance_audit(
        q,
        ifc_context_data,
        tenant_id=tenant_id,
    )

    # Facturation Stripe (Metered Billing)
    stripe_billing_service.charge_ai_audit_credits(tenant_id, db, tokens_used=1)

    return {
        "answer": audit_result["answer"],
        "sources": audit_result.get("sources", []),
        "intent": "compliance_audit"
    }
