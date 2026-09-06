"""§68 — Einladungen : invitations de tenant par lien signé (Vague 2).

Une invitation = un jeton JWT (72 h) dont le `jti` est tracé ici : cela
permet la RÉVOCATION (lien compromis), l'usage UNIQUE (anti-réjeu) et
l'audit (« qui a rejoint quel tenant, quand ») — conformité §60/DSGVO.
Jamais de suppression : révoquer = `revoked_at`, consommer = `used_at`.
"""

from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, Index, String, func

from app.database import Base
from app.models.tenant_mixin import HasTenantColumn


class TenantInvite(HasTenantColumn, Base):
    __tablename__ = "tenant_invites"

    id = Column(String, primary_key=True, default=lambda: f"inv-{uuid.uuid4().hex[:16]}")
    # Empreinte du JWT (claim `jti`) — unique : un jeton = une ligne.
    jti = Column(String(64), unique=True, index=True, nullable=False)
    invited_email = Column(String(320), nullable=True)
    created_by = Column(String, nullable=False)  # id de l'owner émetteur
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    used_by_email = Column(String(320), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_tenant_invites_tenant_created", "tenant_id", "created_at"),
    )
