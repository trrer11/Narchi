"""§86 — Historique de versions des notes co-éditées (snapshots CRDT).

Complète `CollabDoc` (§81) qui ne garde que le DERNIER état : ici, des
instantanés (état binaire CRDT complet, rejouable à l'identique) donnent
un vrai retour-arrière — sans prétendre plus : 25 snapshots max par
salle constamment affiché, previews en clair, restauration propagée à
tous les clients connectés (diff-txn sur la réplique vivante → trames
Yjs normales), ou remplacement direct de l'état si la salle est fermée.
"""

from __future__ import annotations

from sqlalchemy import Column, DateTime, Integer, LargeBinary, String

from app.database import Base


class CollabDocSnapshot(Base):
    __tablename__ = "collab_doc_snapshots"

    id = Column(String(40), primary_key=True)      # uuid4 hex
    doc_id = Column(String(256), nullable=False, index=True)  # "{tenant}:{room}"
    tenant_id = Column(String(64), nullable=False, index=True)
    room = Column(String(80), nullable=False)
    state = Column(LargeBinary, nullable=False)    # update CRDT complète
    bytes = Column(Integer, nullable=False)        # taille état (vérifiable)
    chars = Column(Integer, nullable=False)        # longueur texte au snapshot
    preview = Column(String(120), nullable=False, default="")  # début du texte (clair)
    trigger = Column(String(8), nullable=False)    # "manual" | "auto" (auto = fermeture de salle)
    label = Column(String(120), nullable=True)     # libellé libre (manual)
    created_by = Column(String(64), nullable=True)
    created_by_name = Column(String(140), nullable=True)
    created_at = Column(DateTime, nullable=False)
