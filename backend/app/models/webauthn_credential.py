"""§246 — Passkeys (WebAuthn) gespeichert pro Konto."""
from sqlalchemy import Column, DateTime, Integer, LargeBinary, String, func

from app.database import Base
from app.models.tenant_mixin import HasTenantColumn


class WebAuthnCredential(HasTenantColumn, Base):
    __tablename__ = "webauthn_credentials"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    credential_id = Column(LargeBinary, nullable=False, unique=True)
    public_key = Column(LargeBinary, nullable=False)
    sign_count = Column(Integer, nullable=False, default=0)
    device_name = Column(String(120), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
