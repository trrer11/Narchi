"""
NARCHI V5 — Asynchronous PDF Generation Celery Tasks.
Compiles ReportLab PDF documents out-of-band on worker containers
and streams them securely to S3/R2, keeping the API gateway responsive under high load.
"""

import os
import json
import time
from celery import Celery
import redis

from app.core.celery_app import celery_app
from app.database import SessionLocal
from app.models.project import CostEstimation
from app.services.storage_service import storage_service
from app.core.pdf_generator import generate_pitch_pdf
from app.core.logging import get_logger

logger = get_logger("tasks.pdf")

# Initialisation du client de cache Redis
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
r_client = redis.from_url(REDIS_URL, decode_responses=True)

@celery_app.task(bind=True, max_retries=3)
def generate_pdf_report_task(self, tenant_id: str, estimation_id: str) -> dict:
    """
    Tâche asynchrone distribuée pour compiler et uploader le PDF d'estimation DIN 276.
    Met à jour l'avancement pas-à-pas dans Redis pour le polling du frontend.
    Stocke le résultat sur S3/R2 et met l'URL de streaming en cache pendant 12 heures.
    """
    job_key = f"job:pdf:{estimation_id}"
    cache_key = f"cache:pdf:{estimation_id}"

    # 1. Déclaration de l'état de démarrage dans Redis (10% de complétion)
    r_client.set(job_key, json.dumps({"status": "PROCESSING", "progress": 10, "error": None}), ex=86400)

    db = SessionLocal()
    if tenant_id:
        db.info["tenant_id"] = tenant_id

    try:
        # Recherche de l'estimation de coûts sous isolation d'agence stricte
        est = db.query(CostEstimation).filter(CostEstimation.id == estimation_id).first()
        if not est:
            err_msg = f"Estimation {estimation_id} introuvable pour le locataire demandé."
            logger.warning(
                "PDF estimation was not found for tenant",
                extra={
                    "event_code": "PDF_ESTIMATION_NOT_FOUND",
                    "estimation_id": estimation_id,
                    "tenant_id": tenant_id,
                },
            )
            r_client.set(job_key, json.dumps({"status": "FAILED", "progress": 0, "error": err_msg}), ex=86400)
            return {"status": "error", "message": err_msg}

        r_client.set(job_key, json.dumps({"status": "PROCESSING", "progress": 40, "error": None}), ex=86400)

        # 2. Compilation physique du rapport PDF (ReportLab - CPU-bound)
        # S'exécute de façon autonome hors du thread de l'API
        pdf_path = generate_pitch_pdf(est.project, est)
        
        if not pdf_path.exists():
            raise FileNotFoundError("La génération physique du fichier temporaire PDF a échoué.")

        r_client.set(job_key, json.dumps({"status": "PROCESSING", "progress": 80, "error": None}), ex=86400)

        # 3. Téléversement sécurisé et cloisonné du binaire vers le stockage S3/R2
        cloud_key = f"tenants/{tenant_id}/reports/{estimation_id}.pdf"
        
        # Téléverser de façon robuste le fichier temporaire
        storage_service.s3_client.upload_file(
            Filename=str(pdf_path),
            Bucket=storage_service.bucket_name,
            Key=cloud_key,
            ExtraArgs={"ContentType": "application/pdf"}
        )

        # Supprimer immédiatement le fichier temporaire du disque du worker (anti-saturation d'espace disque)
        if pdf_path.exists():
            pdf_path.unlink()

        # 4. Émission d'une URL de lecture sécurisée pré-signée S3/R2 GET
        download_url = storage_service.generate_presigned_download_url(
            tenant_id=tenant_id,
            object_key=cloud_key,
            expires_in=43200  # URL pré-signée active pendant 12 heures
        )

        # Mettre en cache l'URL de téléchargement pour éviter les re-générations ultérieures coûteuses
        r_client.set(cache_key, download_url, ex=43200) # Cache expire après 12 heures

        # 5. Déclaration d'achèvement de traitement réussie (100% de complétion)
        success_payload = {
            "status": "COMPLETED",
            "progress": 100,
            "download_url": download_url,
            "cloud_key": cloud_key,
            "error": None
        }
        r_client.set(job_key, json.dumps(success_payload), ex=86400) # Le job persiste 24 heures pour consultation

        logger.info(
            "PDF compilation and upload completed",
            extra={
                "event_code": "PDF_TASK_SUCCEEDED",
                "estimation_id": estimation_id,
                "tenant_id": tenant_id,
            },
        )
        return {
            "status": "success",
            "estimation_id": estimation_id,
            "download_url": download_url
        }

    except Exception as e:
        db.rollback()
        logger.exception(
            "PDF generation task failed",
            extra={
                "event_code": "PDF_TASK_FAILED",
                "estimation_id": estimation_id,
                "tenant_id": tenant_id,
                "error_type": type(e).__name__,
            },
        )

        # Si on a épuisé le nombre de retries, on force l'état FAILED
        if self.request.retries >= self.max_retries:
            r_client.set(
                job_key, 
                json.dumps({"status": "FAILED", "progress": 0, "error": f"Exception interne : {str(e)}"}), 
                ex=86400
            )
            
        retry_delay = 30 * (2 ** self.request.retries)
        raise self.retry(exc=e, countdown=retry_delay)
    finally:
        db.close()
