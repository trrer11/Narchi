"""
NARCHI V5 — JWT Token Management
HMAC-SHA256 signed tokens with strong user binding and session invalidation.
"""

from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, TYPE_CHECKING
import jwt

from app.config import settings
from app.core.security.config import SECRET_KEY
from app.core.context import tenant_id_context

if TYPE_CHECKING:
    from app.models.user import User


def create_access_token(
    data: Dict[str, Any],
    user: "User",
    expires_delta: Optional[timedelta] = None
) -> str:
    """
    Create a JWT signed with HMAC-SHA256 strongly bound to the user.
    Includes pw_stamp for instant session invalidation on password change.
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta else timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    # Secure pw_stamp against null values
    pwd_hash = user.hashed_password if user.hashed_password else ""
    to_encode.update({
        "exp": expire,
        "pw_stamp": pwd_hash[-8:],
        "tenant_id": user.tenant_id
    })

    return jwt.encode(to_encode, SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> Dict[str, Any]:
    """Decode and validate a JWT token."""
    return jwt.decode(token, SECRET_KEY, algorithms=[settings.ALGORITHM])


def get_token_payload(token: str) -> Optional[Dict[str, Any]]:
    """Safely decode token, return None if invalid."""
    try:
        return decode_token(token)
    except jwt.PyJWTError:
        return None