"""
NARCHI V5 — BIM Security & Edge Validation Router.
Validates uploaded model headers prior to storage or background job queueing,
shielding downstream engines from processing hostile files.
"""

from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, status
from pydantic import BaseModel

from app.core.security import get_current_user
from app.models.user import User
from app.services.ifc_validator import validate_ifc_header_stream, InvalidIFCSchemaException
from app.core.logging import get_logger

logger = get_logger("api.upload_validation")
router = APIRouter(prefix="/api/v5/ifc", tags=["BIM Security Validation"])

# ============================================================================
# PYDANTIC SCHEMAS
# ============================================================================
class ValidationResponse(BaseModel):
    status: str
    schema_version: str
    message: str


@router.post("/validate", response_model=ValidationResponse, status_code=status.HTTP_200_OK)
async def validate_ifc_model_upload(
    file: UploadFile = File(..., description="Le fichier binaire IFC à soumettre à l'analyseur de sécurité"),
    current_user: User = Depends(get_current_user)
):
    """
    Endpoint de sécurité d'infrastructure (Edge Security Check).
    Scanne l'en-tête de la maquette binaire soumise en streaming (limité à 1 Mo en RAM)
    pour bloquer toute tentative d'injection de scripts, de fichiers d'extensions altérées,
    ou de payloads corrompus pouvant provoquer un Buffer Overflow sur nos processeurs de calcul.
    """
    try:
        # Analyse directe du flux d'octets sans chargement complet en mémoire vive
        schema_version = validate_ifc_header_stream(file.file)
        
        # Réinitialisation du curseur de lecture pour les futurs traitements ou uploads du pipeline
        file.file.seek(0)
        
        return {
            "status": "valid",
            "schema_version": schema_version,
            "message": f"Contrôle de sécurité validé. Schéma de modélisation certifié : {schema_version}"
        }
    except InvalidIFCSchemaException as error:
        logger.warning(
            "IFC upload header rejected",
            extra={
                "event_code": "IFC_HEADER_REJECTED",
                "error_type": type(error).__name__,
                "file_name": file.filename,
            },
        )
        # Rejet immédiat en bordure réseau (Bad Request)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error)
        )
    except Exception as error:
        logger.exception(
            "Unexpected IFC header validation failure",
            extra={
                "event_code": "IFC_HEADER_VALIDATION_FAILED",
                "error_type": type(error).__name__,
                "file_name": file.filename,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Erreur d'infrastructure interne lors du scan d'en-tête de la maquette."
        )
