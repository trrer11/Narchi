"""NARCHI V5 — Parsing IFC réel hors requête HTTP via Celery."""

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path

import redis
import sentry_sdk

from app.core.celery_app import celery_app
from app.core.ifc_pipeline import apply_ifc_metadata, extract_ifc_metadata
from app.core.logging import get_logger
from app.core.telemetry import IFC_TASK_DURATION_SECONDS
from app.database import SessionLocal
from app.models.project import Project
from app.services.storage_service import storage_service

logger = get_logger("tasks.ifc")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
r_client = redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=2)


def _job_key(project_id: str) -> str:
    return f"job:ifc:{project_id}"


def _set_status(project_id: str, payload: dict) -> None:
    try:
        r_client.set(_job_key(project_id), json.dumps(payload), ex=86400)
    except redis.RedisError as error:
        logger.warning(
            "Could not persist IFC job status",
            extra={"project_id": project_id, "error": str(error)},
        )


@celery_app.task(bind=True, max_retries=3, acks_late=True, reject_on_worker_lost=True)
def process_ifc_file_task(
    self,
    tenant_id: str,
    project_id: str,
    file_location: str,
    source: str = "local",
) -> dict:
    """Télécharge si nécessaire, parse réellement avec IfcOpenShell et met à jour le projet."""
    started = time.perf_counter()
    db = SessionLocal()
    db.info["tenant_id"] = tenant_id
    temporary_path: str | None = None
    outcome = "failed"

    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if project is None:
            raise ValueError("Projet introuvable pour ce tenant")

        project.status = "PROCESSING"
        db.commit()
        _set_status(
            project_id,
            {"status": "PROCESSING", "progress": 10, "error": None},
        )

        if source == "s3":
            suffix = Path(project.file_name).suffix or ".ifc"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temporary:
                temporary_path = temporary.name
            storage_service.download_file(
                tenant_id=tenant_id,
                object_key=file_location,
                local_path=temporary_path,
            )
            parse_path = Path(temporary_path)
        elif source == "local":
            parse_path = Path(file_location).resolve()
        else:
            raise ValueError(f"Source IFC non supportée: {source}")

        _set_status(
            project_id,
            {"status": "PROCESSING", "progress": 35, "error": None},
        )
        metadata = extract_ifc_metadata(parse_path, project.file_name)
        _set_status(
            project_id,
            {"status": "PROCESSING", "progress": 85, "error": None},
        )

        apply_ifc_metadata(project, metadata)
        db.commit()
        outcome = "completed"
        result = {
            "status": "COMPLETED",
            "progress": 100,
            "project_id": project.id,
            "schema_version": project.schema_version,
            "element_count": project.element_count,
            "bgf": project.bgf,
            "bri": project.bri,
            "ngf": project.ngf,
            "storey_count": project.storey_count,
            "error": None,
        }
        _set_status(project_id, result)
        return result
    except Exception as error:
        db.rollback()
        sentry_sdk.capture_exception(error)
        final_attempt = self.request.retries >= self.max_retries
        if final_attempt:
            failed_project = db.query(Project).filter(Project.id == project_id).first()
            if failed_project is not None:
                failed_project.status = "FAILED"
                db.commit()
            _set_status(
                project_id,
                {
                    "status": "FAILED",
                    "progress": 0,
                    "error": "Le fichier n'a pas pu être analysé.",
                },
            )
        logger.exception(
            "IFC task failed",
            extra={"tenant_id": tenant_id, "project_id": project_id},
        )
        raise self.retry(exc=error, countdown=30 * (2**self.request.retries))
    finally:
        IFC_TASK_DURATION_SECONDS.labels(status=outcome).observe(
            time.perf_counter() - started
        )
        db.close()
        if temporary_path:
            Path(temporary_path).unlink(missing_ok=True)
