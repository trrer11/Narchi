"""§86 — Historique de versions des notes co-éditées (Notiz CRDT).

Deux mécanismes, aucune promesse cachée :

1. SNAPSHOTS : instantanés binaires COMPLETS de l'état `collab_docs`
   (le même format d'update `yrs` que la persistance §81 — rejouable à
   l'identique). Déclencheurs : manuel (bouton Verlauf) et automatique à
   la fermeture de la salle (dernier client parti), rate-limité à
   1 auto / 30 min. Rétention bornée à 25 par salle — le plafond est
   renvoyé dans chaque réponse, jamais de purge silencieuse.

2. RESTAURATION : deux chemins honnêtes.
   - Salle OUVERTE (des clients connectés) : le serveur applique le DIFF
     texte (clear + insert du contenu du snapshot) en UNE transaction sur
     sa réplique vivante → les trames Yjs normales se diffusent aux
     clients connectés et au pont Redis inter-workers. Vérifié par test :
     un client ayant l'historique complet converge vers le texte restauré
     (le cas « client qui aurait raté l'historique » n'existe pas en
     production : le handshake step1 livre toujours l'état intégral).
   - Salle FERMÉE : l'état stocké est REMPLACÉ — la prochaine ouverture
     recharge le texte restauré (step1 = état intégral, convergence
     garantie, vérifiée par test aussi).
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from pycrdt import Doc, Text

TEXT_KEY = "notiz"  # contrat gravé avec le frontend (collabDoc.ts)
MAX_SNAPSHOTS_PER_DOC = 25                       # bornage affiché dans l'UI
AUTO_SNAPSHOT_MIN_INTERVAL = timedelta(minutes=30)  # 1 auto max par fenêtre
_WHITESPACE_RE = re.compile(r"\s+")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def text_of_state(state: bytes, key: str = TEXT_KEY) -> str:
    """Texte en clair contenu dans un état binaire CRDT (lecture seule)."""
    doc = Doc()
    doc.apply_update(bytes(state))
    return str(doc.get(key, type=Text))


def preview_of(text: str, limit: int = 90) -> str:
    """Aperçu compact mono-ligne (espaces normalisés), tronqué honnêtement."""
    flat = _WHITESPACE_RE.sub(" ", text).strip()
    if len(flat) <= limit:
        return flat
    return flat[: max(0, limit - 1)].rstrip() + "…"


def make_snapshot_row(
    db,
    doc_row,
    trigger: str,
    label: Optional[str] = None,
    author=None,
    now: Optional[datetime] = None,
):
    """Fabrique la ligne snapshot depuis la ligne collab_docs (état PG).

    `trigger` ∈ {"manual", "auto"} — tout autre libellé est rejeté ici,
    pas silencieusement accepté.
    """
    from app.models.collab_doc_snapshot import CollabDocSnapshot

    if trigger not in ("manual", "auto"):
        raise ValueError(f"trigger inconnu : {trigger!r}")
    state = bytes(doc_row.state)
    text = text_of_state(state)
    stamp = now or _utcnow()
    row = CollabDocSnapshot(
        id=uuid.uuid4().hex,
        doc_id=doc_row.id,
        tenant_id=doc_row.tenant_id,
        room=doc_row.room,
        state=state,
        bytes=len(state),
        chars=len(text),
        preview=preview_of(text),
        trigger=trigger,
        label=label or None,
        created_by=getattr(author, "id", None) if trigger == "manual" else None,
        created_by_name=(getattr(author, "name", None) or getattr(author, "id", None))
        if trigger == "manual"
        else None,
        created_at=stamp,
    )
    db.add(row)
    db.flush()  # id disponible + INSERT validé avant le prune
    prune_old_snapshots(db, doc_row.id)
    return row


def prune_old_snapshots(db, doc_id: str, keep: int = MAX_SNAPSHOTS_PER_DOC) -> int:
    """Garde les `keep` plus récents, supprime le reste. Retourne le compte
    supprimé — la rétention bornée est un fait mesurable, pas un oubli."""
    from app.models.collab_doc_snapshot import CollabDocSnapshot

    rows = (
        db.query(CollabDocSnapshot)
        .filter(CollabDocSnapshot.doc_id == doc_id)
        .order_by(CollabDocSnapshot.created_at.desc(), CollabDocSnapshot.id.desc())
        .all()
    )
    removed = 0
    for stale in rows[keep:]:
        db.delete(stale)
        removed += 1
    return removed


def restore_doc_state(ydoc: Doc, snapshot_state: bytes, key: str = TEXT_KEY) -> List[bytes]:
    """Applique le contenu du snapshot sur la réplique VIVANTE.

    Diff honnête en UNE transaction (`clear` + `insert`) : les clients
    connectés reçoivent des updates Yjs NORMALES — aucun chemin spécial,
    aucune divergence possible (convergence vérifiée par test de bout en
    bout). Retourne les updates émises (pour republication pont Redis) ;
    liste vide si le contenu est déjà celui du snapshot (idempotent).
    """
    target = text_of_state(snapshot_state, key)
    live = ydoc.get(key, type=Text)
    if str(live) == target:
        return []
    updates: List[bytes] = []
    subscription = ydoc.observe(lambda event: updates.append(event.update))
    try:
        with ydoc.transaction():
            live.clear()
            if target:
                live.insert(0, target)
    finally:
        ydoc.unobserve(subscription)
    return updates
