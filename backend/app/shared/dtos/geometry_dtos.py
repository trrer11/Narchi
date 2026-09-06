from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Union
import re
from uuid import UUID

# ============================================================================
# CONSTANTS & REGEX
# ============================================================================

# IFC GUIDs are 22-character Base64 encoded strings (buildingSMART standard)
IFC_GUID_REGEX = re.compile(r"^[A-Za-z0-9+/=]{22}$")

# ============================================================================
# DTOs - GEOMETRIC & AUDIT
# ============================================================================

class Vector3DTO(BaseModel):
    """Strict 3D Coordinate validation."""
    x: float = Field(..., description="Coordinate on X axis in meters")
    y: float = Field(..., description="Coordinate on Y axis in meters")
    z: float = Field(..., description="Coordinate on Z axis in meters")

class BaseGeometryDTO(BaseModel):
    """Base class for all geometric modifications."""
    element_id: str = Field(..., min_length=1, max_length=128)
    
    @field_validator('element_id')
    @classmethod
    def validate_ifc_guid(cls, v: str) -> str:
        # Check if it's a valid IFC GUID or a standard UUID
        if not IFC_GUID_REGEX.match(v):
            try:
                UUID(v)
            except ValueError:
                raise ValueError("Invalid IFC GUID format. Must be 22-char Base64 or valid UUID.")
        return v

class WallCorrectionDTO(BaseLC_GeometryDTO := BaseGeometryDTO):
    """Strict validation for wall thickness and position adjustments."""
    thickness: float = Field(..., gt=0, description="Wall thickness must be strictly positive (meters)")
    translation: Optional[Vector3DTO] = None
    
    @field_validator('thickness')
    @classmethod
    def validate_realistic_thickness(cls, v: float) -> float:
        if v > 5.0: # Sanity check: walls larger than 5m are likely input errors
            raise ValueError("Wall thickness exceeds realistic architectural limits (> 5m).")
        return v

class DoorAdjustmentDTO(BaseLC_GeometryDTO := BaseGeometryDTO):
    """Strict validation for door width adjustments (PMR Compliance)."""
    width: float = Field(..., gt=0, description="Door clear width must be positive (meters)")
    
    @field_validator('width')
    @classmethod
    def validate_realistic_width(cls, v: float) -> float:
        if v > 10.0: # Sanity check
            raise ValueError("Door width exceeds realistic architectural limits (> 10m).")
        return v

class BcfIssueUpdateDTO(BaseModel):
    """Validation for BCF ticket updates."""
    issue_id: str = Field(..., min_length=1)
    status: str = Field(..., pattern="^(Open|Resolved|Closed)$")
    priority: str = Field(..., pattern="^(Low|Medium|High|Critical)$")
    comment: str = Field(..., min_length=1, max_length=2000)
    #L'id de l'élément lié doit être un GUID valide
    related_element_id: Optional[str] = None

    @field_validator('related_element_id')
    @classmethod
    def validate_related_guid(cls, v: Optional[str]) -> Optional[str]:
        if v and not IFC_GUID_REGEX.match(v):
            raise ValueError("Related element ID must be a valid IFC GUID.")
        return v

class CorrectionRequestDTO(BaseModel):
    """Unified request for applying AI suggestions."""
    suggestion_id: str
    patches: List[Union[WallCorrectionDTO, DoorAdjustmentDTO]]
    confirmation_token: str = Field(..., description="Token to prevent double-submission")
