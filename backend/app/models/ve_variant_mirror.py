"""§163 — Miroir serveur des VE-Varianten (synchro inter-appareils).

Les VE-Varianten (§160) vivaient EXCLUSIVEMENT dans le navigateur de
chaque appareil (localStorage). Même maladie que les Projets avant §118 :
une variante soignée (« Holzbau ») n'existait que sur UN poste. Cette
table est la même vérité partagée que `project_mirrors`/`baustelle_issues`,
pour les VE-Varianten :

  - id fourni par l'appareil (uuid local) → upsert idempotent ;
  - updated_at porté PAR L'APPAREIL (dernier-écrivain-gagne, limite dite) ;
  - suppression = pierre tombale (delete du cockpit VE-Studio) ;
  - payload JSON = la variante complète (sélection + totaux dérivés) ;
    seuls `id` et `name` (le libellé) sont des colonnes, le reste reste
    opaque au serveur par construction — même philosophie que §118.

Modèle de synchro (SIMPLE, dit honnêtement) : contrairement aux Projets
(§118) qui ont une file hors-ligne + delta à curseur, les variantes
utilisent un « pull au chargement + push best-effort à l'enregistrement »
— suffisant pour une exploration de conception, sans la complexité du
moteur complet.
"""

from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, Index, PrimaryKeyConstraint, String, func
from sqlalchemy.types import JSON

from app.database import Base
from app.models.tenant_mixin import HasTenantColumn


def generate_uuid() -> str:
    return str(uuid.uuid4())


class VEVariantMirror(HasTenantColumn, Base):
    __tablename__ = "ve_variant_mirrors"

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
        Index("ix_ve_variant_mirrors_tenant_updated", "tenant_id", "updated_at"),
    )
