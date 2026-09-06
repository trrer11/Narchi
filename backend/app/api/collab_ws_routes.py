"""§81 — V2.7 étape 2 : WebSocket CRDT (co-édition temps réel RÉELLE).

Authentification = le MÊME cookie HttpOnly `narchi_session` que le chat
§61 (jamais de token en URL : il finirait dans les logs du proxy). Le
tenant vient de la session — le client choisit juste le NOM de salle ;
le cloisonnement est fait côté serveur (clé `tenant:salle`).

Protocole : Yjs / y-websocket v1 (sync + awareness) via cœur Rust `yrs`
(pycrdt). Le relayeur multi-worker est dans `services.crdt_room_hub` —
sans lui, deux collègues sur deux workers gunicorn divergeraient en
silence. Ce qui n'est PAS livré dans cette étape (dit honnêtement dans
le CHANGELOG) : curseurs graphiques dans le texte, historique de
versions, co-édition des quantités structurées (vague suivante).
"""

import re

from fastapi import APIRouter, Depends, WebSocket
from sqlalchemy.orm import Session

from app.api.chat_routes import _authenticate_ws_cookie  # §61 — commune au chat
from app.database import get_db
from app.services.collab_service import color_for
from app.services.crdt_room_hub import get_crdt_hub

router = APIRouter(prefix="/api/v5/collab", tags=["Coédition CRDT (étape 2)"])

_ROOM_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$")
_RESERVED = {"ws"}  # « ws » est le segment de CE endpoint


@router.websocket("/ws/{room}")
async def collab_doc_ws(websocket: WebSocket, room: str, db: Session = Depends(get_db)):
    if not _ROOM_RE.match(room) or room in _RESERVED:
        await websocket.close(code=4422)
        return
    try:
        current_user = _authenticate_ws_cookie(websocket, db)
    except Exception:
        await websocket.close(code=4401)
        return

    hub = get_crdt_hub()
    await hub.serve(
        websocket,
        tenant_id=current_user.tenant_id,
        room=room,
        user_id=current_user.id,
        name=current_user.name or current_user.id,
        color=color_for(current_user.id),
    )
