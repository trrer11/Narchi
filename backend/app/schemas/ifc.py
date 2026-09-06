"""
NARCHI V5 — IFC & Calculation Schemas.
"""

from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class UploadResponse(BaseModel):
    project_id: str
    file_name: str
    schema_version: str
    element_count: int
    bgf: float
    bri: float
    ngf: float
    storey_count: int
    message: str

class ComputeRequest(BaseModel):
    project_id: str
    gebaeudeart: str = "MFH"
    plz: str = "10115"
    grossstadt: str = "Berlin"
    bauklasse: str = "mittel"
    energi_standard: str = "geg"

class KGBreakdownItem(BaseModel):
    code: str
    label: str
    amount: float
    perM2: float
    share_pct: float

class ComputeResponse(BaseModel):
    estimation_id: str
    project_id: str
    kg: List[KGBreakdownItem]
    total: float
    total_brutto: float
    perM2: float
    bgf: float
    bri: float
    ngf: float
    confidenceLow: float
    confidenceHigh: float
    co2Total: float
    co2PerM2: float
    gegConform: bool
    foerderungen: List[str]
    hoaiNetto: float
    auditHash: str
    created_at: datetime
