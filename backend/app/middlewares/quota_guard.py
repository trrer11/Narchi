"""
NARCHI V5 — FinOps Storage Quota Interceptor.
Prevents processing S3/R2 presigned upload URL requests if the tenant has exhausted
their allocated storage space allowance (HTTP 402 Payment Required).
"""

from fastapi import Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.core.security import get_current_user
from app.services.quota_service import QuotaService
from app.core.logging import get_logger

logger = get_logger("quota_guard")


async def verify_storage_quota_allowance(
    file_size_bytes: int = Query(..., description="La taille attendue du fichier à téléverser en octets"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Garde d'interception et dépendance de sécurité FastAPI (FinOps Protection).
    Évalue l'espace d'hébergement consommé en base de données par l'agence (tenant_id).
    Lève instantanément un code d'erreur HTTP 402 (Payment Required) si l'import dépasse le quota alloué.
    """
    # Exécuter le contrôle d'admissibilité du quota d'hébergement
    is_allowed = QuotaService.check_quota_allowance(
        db=db,
        tenant_id=current_user.tenant_id,
        incoming_file_size=file_size_bytes
    )

    if not is_allowed:
        logger.warning("Storage quota exceeded",
                       extra={"tenant_id": current_user.tenant_id,
                              "user_id": current_user.id,
                              "file_size_bytes": file_size_bytes})
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Storage quota exceeded. Please upgrade your subscription plan."
        )