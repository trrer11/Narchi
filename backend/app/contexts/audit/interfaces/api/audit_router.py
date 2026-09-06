from fastapi import APIRouter, Depends, HTTPException, status
from typing import List
from app.shared.dtos.geometry_dtos import CorrectionRequestDTO, BcfIssueUpdateDTO
from app.contexts.audit.application.run_audit_uc import RunAuditUseCase
from app.contexts.audit.application.apply_correction_uc import ApplyCorrectionUseCase
from app.core.database import get_db

router = APIRouter()

# Dependency Injection for Use Cases
def get_audit_service():
    return RunAuditUseCase(get_db())

def get_correction_service():
    return ApplyCorrectionUseCase(get_db())

@router.post("/apply-correction", status_code=status.HTTP_200_OK)
async def apply_ai_correction(
    request: CorrectionRequestDTO, 
    service: ApplyCorrectionUseCase = Depends(get_correction_service)
):
    """
    Endpoint to apply a predicted geometric correction.
    The CorrectionRequestDTO ensures that all dimensions are mathematically valid.
    """
    try:
        result = await service.execute(request)
        return {"status": "success", "data": result}
    except ValueError as e:
        # Business logic error (e.g. collision detected during apply)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        # System error
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error during correction.")

@router.patch("/issue/{issue_id}")
async def update_bcf_issue(
    issue_id: str,
    update: BcfIssueUpdateDTO,
    service: RunAuditUseCase = Depends(get_audit_service)
):
    """
    Updates a BCF issue status with strict validation of GUIDs and enums.
    """
    try:
        result = await service.update_issue_status(issue_id, update)
        return {"status": "updated", "issue": result}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Issue {issue_id} not found.")
