"""§81 — Persistance des documents CRDT co-édités (V2.7 étape 2).

UNE ligne par salle : l'état binaire COMPLET du document Yjs (le format
d'update `yrs` rejouable à l'identique — convergence garantie). La clé
primaire EST la salle cloisonnée « tenant:salle » : impossible d'avoir
deux lignes concurrentes pour la même note d'un même bureau.

Ce n'est PAS un journal d'archivage (pas d'historique des versions, pas
de restauration point-dans-le-temps) : seul le dernier état survit. C'est
délibéré — le modèle CRDT rend la fusion sans perte ; l'historique de
versions est une vague à part, jamais annoncée pour cette étape.
"""

from __future__ import annotations

from sqlalchemy import Column, DateTime, Integer, LargeBinary, String

from app.database import Base


class CollabDoc(Base):
    __tablename__ = "collab_docs"

    id = Column(String(256), primary_key=True)   # "{tenant}:{room}"
    tenant_id = Column(String(64), nullable=False, index=True)
    room = Column(String(80), nullable=False)
    state = Column(LargeBinary, nullable=False)  # update CRDT complète
    version = Column(Integer, nullable=False, default=1)  # compteur de flushes (vérifiable)
    updated_at = Column(DateTime, nullable=False)
