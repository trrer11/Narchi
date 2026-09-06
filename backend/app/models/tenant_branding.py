"""§77 — Branding du bureau : le « waw » « PDF client avec MON logo ».

UNE ligne par tenant : nom affiché + logo. Le serveur vérifie les OCTETS
MAGIQUES (PNG/JPEG) et plafonne à 512 ko ; le SVG est REFUSÉ (un SVG peut
embarquer un script). Sans branding, le PDF reste le rapport standard —
rien n'est simulé, ni dans un sens ni dans l'autre.
"""

from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, Integer, String, Text, UniqueConstraint

from app.database import Base
from app.models.tenant_mixin import HasTenantColumn


class TenantBranding(HasTenantColumn, Base):
    __tablename__ = "tenant_brandings"

    id = Column(String, primary_key=True, default=lambda: f"brn-{uuid.uuid4().hex[:16]}")
    office_name = Column(String(120), nullable=True)
    logo_mime = Column(String(32), nullable=True)   # image/png | image/jpeg
    logo_b64 = Column(Text, nullable=True)          # base64 strict (≤ ~683 ko)
    logo_bytes = Column(Integer, nullable=True)     # taille binaire RÉELLE, affichée
    updated_by = Column(String, nullable=True)      # user_id — traçabilité sobre
    updated_at = Column(DateTime(timezone=True), nullable=True)  # posé par la route (déterministe)

    __table_args__ = (
        # Un seul branding par bureau, gravé en base.
        UniqueConstraint("tenant_id", name="uq_tenant_brandings_tenant"),
    )
