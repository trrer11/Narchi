"""§115 — Mängel serveur (étape 1 de la synchro inter-appareils).

Jusqu'§114, les Mängel créés depuis la page Baustelle vivaient
EXCLUSIVEMENT dans l'IndexedDB du navigateur (choix §103 « alles bleibt
auf diesem Gerät » — honnête mais en cul-de-sac : le PC du bureau et le
téléphone du chantier ne se connaissent pas). Cette table est la VÉRITÉ
PARTAGÉE multi-appareils, première brique de la synchro :

  - id fourni par le client (uuid local) → upsert idempotent ;
  - updated_at porté PAR LE CLIENT → dernier-écrivain-gagne, simple et
    prévisible (la ligne horodatée la plus récente l'écrase — dit dans
    la doc, jamais caché) ;
  - suppression = PIERRE TOMBALE (deleted_at mis à jour, ligne conservée)
    : une suppression DOIT se propager aux autres appareils au prochain
    delta — physiquement effacer rendrait le delta muet (un appareil
    garderait le Mangel « chez lui » pour toujours) ;
  - photos/vidéos : ici IDENTIFIANTS seulement. Les blobs restent sur
    l'appareil d'origine pour l'instant (étape 3 — transcients volumineux
    vs base) ; le Mangel qui référence une photo absente de l'appareil
    courant reste lisible, la tuile « pas sur cet appareil » est du
    ressort du frontend (honnêteté déjà éprouvée « nicht gefunden »).
"""

from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, Index, PrimaryKeyConstraint, String, func
from sqlalchemy.types import JSON

from app.database import Base
from app.models.tenant_mixin import HasTenantColumn


def generate_uuid() -> str:
    return str(uuid.uuid4())


class BaustelleIssue(HasTenantColumn, Base):
    __tablename__ = "baustelle_issues"

    # Clé composite (tenant_id, id) : un id client appartenant à un AUTRE
    # bureau ne peut ni entrer en collision ni fuiter (garde structurelle,
    # pas seulement un filtre applicatif — éprouvée par test).
    id = Column(String, nullable=False, default=generate_uuid)
    project_id = Column(String, nullable=False, index=True)
    day = Column(String, nullable=False)            # « AAAA-MM-JJ » (jour de visite)
    title = Column(String, nullable=False)
    description = Column(String, nullable=False, default="")
    zone = Column(String, nullable=False, default="")
    severity = Column(String, nullable=False)        # minor | major | critical
    status = Column(String, nullable=False, default="open")  # open | in-review | resolved (§117)
    photo_ids = Column(JSON, nullable=False, default=list)   # ids locaux de blobs
    video_ids = Column(JSON, nullable=False, default=list)
    created_by = Column(String, nullable=False)      # id utilisateur créateur
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(DateTime(timezone=True), nullable=False, index=True)

    __table_args__ = (
        PrimaryKeyConstraint("tenant_id", "id"),
        Index("ix_baustelle_issues_tenant_project", "tenant_id", "project_id"),
        Index("ix_baustelle_issues_tenant_updated", "tenant_id", "updated_at"),
    )
