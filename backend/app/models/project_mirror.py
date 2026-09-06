"""§118 — Miroir serveur des Projets (synchro inter-appareils).

Plainte client : « quand j'importe un projet je ne peux pas le voir sur
l'autre compte ». Jusqu'ici les Projets vivaient EXCLUSIVEMENT dans le
navigateur de chaque appareil (zustand persisté) : le Mangel §115/§117
synchronisé arrivait sur un appareil… sans son projet (cas « geparkt »
honnêtement compté, mais impuissant à afficher). Cette table est la même
vérité partagée que baustelle_issues, pour les projets :

  - id fourni par le client (uuid local) → upsert idempotent ;
  - updated_at porté PAR L'APPAREIL (dernier-écrivain-gagne, limite dite) ;
  - suppression = pierre tombale (delete du cockpit §projets ou retrait) ;
  - payload JSON = fiche d'affichage complète (locaux riches : budget,
    équipe, accent…) ; un appareil restaure la fiche TELLE QUELLE —
    seuls `id` et `name` sont des colonnes (validation/recherche), le
    reste reste opaque au serveur par construction.
"""

from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, Index, PrimaryKeyConstraint, String, func
from sqlalchemy.types import JSON

from app.database import Base
from app.models.tenant_mixin import HasTenantColumn


def generate_uuid() -> str:
    return str(uuid.uuid4())


class ProjectMirror(HasTenantColumn, Base):
    __tablename__ = "project_mirrors"

    id = Column(String, nullable=False, default=generate_uuid)
    name = Column(String(300), nullable=False)
    payload = Column(JSON, nullable=False, default=dict)
    created_by = Column(String, nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(DateTime(timezone=True), nullable=False, index=True)

    __table_args__ = (
        PrimaryKeyConstraint("tenant_id", "id"),
        Index("ix_project_mirrors_tenant_updated", "tenant_id", "updated_at"),
    )
