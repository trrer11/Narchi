"""
NARCHI V5 — Auth Schemas.
"""

from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user_info: dict

class TokenData(BaseModel):
    user_id: Optional[str] = None
    role: Optional[str] = None

class UserCreate(BaseModel):
    email: str
    password: str
    name: str
    company: Optional[str] = None
    ak_member_id: Optional[str] = None

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    role: str
    tenant_id: str
    company: Optional[str]
    ak_member_id: Optional[str]
    is_active: bool
    is_guest: bool
    created_at: datetime
    avatar_key: Optional[str] = None   # §80 — avatar self-service
    avatar_json: Optional[str] = None  # §82 — contenu avatar (propage navigateurs/appareils)

    model_config = ConfigDict(from_attributes=True)

class GuestLoginRequest(BaseModel):
    chamber_id: str = "AK-BERLIN"  # Architektenkammer Berlin Demo
