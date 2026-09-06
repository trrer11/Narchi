"""
NARCHI V5 — Asynchronous Reports & PDF API Router (SecOps & Performance Hardened).
Implements Redis-based report caching, deduplication of pending generation tasks,
and immediate 202 Accepted polling states to guarantee sub-millisecond API response times.
Includes logic DoS and Hardware Circuit Breaker protection.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional  # SÉCURITÉ : Import requis pour la résolution de types de Pydantic
import redis
import json
import os

from app.database import get_db
from app.models.user import User
from app.models.project import CostEstimation
from app.core.security import get_current_user
from app.core.celery_app import celery_app
from app.middlewares.dos_guard import verify_dos_protection
from app.core.logging import get_logger

logger = get_logger("api.reports")
router = APIRouter(prefix="/api/v5/reports", tags=["PDF Reports"])

# Initialisation de Redis pour le cache et le statut des tâches
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
r_client = redis.from_url(REDIS_URL, decode_responses=True)

# ============================================================================
# PYDANTIC SCHEMAS
# ============================================================================
class TriggerExportResponse(BaseModel):
    status: str
    job_id: Optional[str] = None
    estimation_id: str
    message: str
    download_url: Optional[str] = None

class JobStatusResponse(BaseModel):
    status: str
    progress: int
    download_url: Optional[str] = None
    error: Optional[str] = None


@router.post("/{estimation_id}/trigger", response_model=TriggerExportResponse, status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(verify_dos_protection)])
async def trigger_asynchronous_pdf_generation(
    estimation_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Enclenche le processus d'exportation asynchrone du rapport d'estimation.
    Interroge le cache Redis en amont (sub-milliseconde) pour servir le fichier s'il a déjà été généré.
    Vérifie l'isolation multi-tenant de base de données avant planification de la tâche Celery.
    Sécurisé par le middleware de contrôle DoS et de surcharge matérielle.
    """
    # Injection du tenant_id de session pour contraindre le filtrage ORM
    db.info["tenant_id"] = current_user.tenant_id

    # S'assurer de la présence physique de l'estimation sous notre isolation
    est = db.query(CostEstimation).filter(CostEstimation.id == estimation_id).first()
    if not est:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Le rapport d'estimation spécifié est introuvable ou n'appartient pas à votre agence."
        )

    cache_key = f"cache:pdf:{estimation_id}"
    job_key = f"job:pdf:{estimation_id}"

    # 1. INTERROGATION DU CACHE REDIS (Sûreté de performance)
    cached_url = r_client.get(cache_key)
    if cached_url:
        return {
            "status": "cached",
            "estimation_id": estimation_id,
            "download_url": cached_url,
            "message": "Fichier d'exportation récupéré instantanément depuis notre cache."
        }

    # 2. DÉDOUBLIFICATION DES REQUÊTES (Évite les tâches concurrentes)
    pending_job = r_client.get(job_key)
    if pending_job:
        job_data = json.loads(pending_job)
        if job_data.get("status") == "PROCESSING":
            return {
                "status": "processing",
                "estimation_id": estimation_id,
                "message": "Un export est déjà en cours d'analyse et de génération d'arrière-plan."
            }

    try:
        # Enclencher la tâche Celery de compilation lourde ReportLab hors-bande
        task = celery_app.send_task(
            "app.tasks.pdf_tasks.generate_pdf_report_task",
            args=[current_user.tenant_id, estimation_id],
        )

        # Enregistrer l'état d'enclenchement initial
        initial_payload = {
            "status": "PROCESSING",
            "progress": 5,
            "download_url": None,
            "error": None
        }
        r_client.set(job_key, json.dumps(initial_payload), ex=86400)

        return {
            "status": "accepted",
            "job_id": task.id,
            "estimation_id": estimation_id,
            "message": "Génération de rapport PDF initiée avec succès."
        }
    except Exception as error:
        logger.exception(
            "PDF task scheduling failed",
            extra={
                "event_code": "PDF_TASK_SCHEDULING_FAILED",
                "estimation_id": estimation_id,
                "tenant_id": current_user.tenant_id,
                "error_type": type(error).__name__,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Échec de planification du traitement de rapport d'arrière-plan."
        )


@router.get("/{estimation_id}/status", response_model=JobStatusResponse)
async def get_pdf_generation_job_status(
    estimation_id: str,
    current_user: User = Depends(get_current_user)
):
    """
    Endpoint de polling du statut de la tâche de génération de rapport d'estimations.
    Interroge Redis pour retourner l'état d'avancement (progress) en temps réel.
    """
    job_key = f"job:pdf:{estimation_id}"
    
    # Interroger l'état du job d'arrière-plan stocké dans Redis
    job_payload = r_client.get(job_key)
    if not job_payload:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Aucune tâche d'exportation en cours d'analyse pour ce rapport."
        )

    job_data = json.loads(job_payload)
    return {
        "status": job_data["status"],
        "progress": job_data["progress"],
        "download_url": job_data.get("download_url"),
        "error": job_data.get("error")
    }
