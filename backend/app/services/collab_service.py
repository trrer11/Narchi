"""§78 — V2.7 étape 1 : présence live + verrous doux (soft locks), RÉELS.

Deux primitives honnêtes sur Redis :

- PRÉSENCE : clés à TTL (45 s) rafraîchies par heartbeat (15 s côté client).
  « En ligne » est donc VRAI à ±45 s ; un onglet fermé disparaît tout seul,
  jamais de fantôme persistant.
- VERROUX DOUX : `SET NX PX` atomique — un seul détenteur par cible, TTL
  15 min, libération réservée au détenteur. « Doux » = affiché et discutable
  (Rücksprache) ; PAS un verrou transactionnel dur, et PAS de fusion de
  texte : le CRDT Yjs arrive en étape 2 avec son serveur dédié. Toute la
  sémantique est dite, rien n'est survendu.

Cloisonnement : chaque clé est préfixée par le TENANT — deux bureaux avec
une salle « buero » ne se voient jamais.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from typing import Optional

PRESENCE_TTL_S = 45          # heartbeat client = 15 s → marge ×3 honnête
LOCK_TTL_S = 15 * 60         # 15 min — une importation de prix ne dure pas plus

_PALETTE = ["#0ea5e9", "#f59e0b", "#10b981", "#8b5cf6",
            "#ef4444", "#14b8a6", "#f97316", "#6366f1"]


def color_for(user_id: str) -> str:
    """Couleur STABLE par utilisateur (source unique : le serveur)."""
    idx = int(hashlib.md5(user_id.encode("utf-8")).hexdigest()[:8], 16) % len(_PALETTE)
    return _PALETTE[idx]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class CollabService:
    """Moteur injectable (tests : fakeredis ; prod : client Redis réel)."""

    def __init__(self, client):
        self._r = client

    def _base(self, tenant_id: str, room: str) -> str:
        # Le tenant fait PARTIE de la clé — jamais confié au filtre applicatif.
        return f"collab:{tenant_id}:{room}"

    # ------------------------------ présence ------------------------------

    def join(self, tenant: str, room: str, user_id: str, name: str) -> None:
        self._write_presence(tenant, room, user_id, name, joined_at=None)

    def heartbeat(self, tenant: str, room: str, user_id: str, name: str) -> None:
        key = f"{self._base(tenant, room)}:presence:{user_id}"
        raw = self._r.get(key)
        joined_at = json.loads(raw)["joined_at"] if raw else None
        self._write_presence(tenant, room, user_id, name, joined_at=joined_at)

    def _write_presence(self, tenant, room, user_id, name, joined_at):
        key = f"{self._base(tenant, room)}:presence:{user_id}"
        now = _now()
        self._r.set(key, json.dumps({
            "user_id": user_id,
            "name": name,
            "color": color_for(user_id),
            "joined_at": joined_at or now,
            "last_seen": now,
        }), ex=PRESENCE_TTL_S)

    def leave(self, tenant: str, room: str, user_id: str) -> None:
        self._r.delete(f"{self._base(tenant, room)}:presence:{user_id}")

    def presence(self, tenant: str, room: str) -> list:
        members = []
        for key in self._r.scan_iter(f"{self._base(tenant, room)}:presence:*"):
            raw = self._r.get(key)
            if raw:
                members.append(json.loads(raw))
        members.sort(key=lambda m: (m["name"].lower(), m["user_id"]))
        return members

    # ---------------------------- verrous doux ----------------------------

    def claim_lock(self, tenant: str, room: str, target: str,
                   user_id: str, name: str) -> dict:
        key = f"{self._base(tenant, room)}:locks:{target}"
        payload = {"owner_id": user_id, "owner_name": name, "since": _now()}
        if self._r.set(key, json.dumps(payload), nx=True, px=LOCK_TTL_S * 1000):
            return {"acquired": True,
                    "lock": {"target": target, **payload, "expires_in_s": LOCK_TTL_S}}
        raw = self._r.get(key)
        holder = json.loads(raw) if raw else {}
        ttl_ms = self._r.pttl(key) if raw else 0
        return {"acquired": False,
                "held_by": {"target": target, **holder,
                            "expires_in_s": max(0, ttl_ms // 1000)}}

    def release_lock(self, tenant: str, room: str, target: str,
                     user_id: str) -> dict:
        """Libération RÉSERVÉE au détenteur — jamais de casse du verrou d'autrui."""
        key = f"{self._base(tenant, room)}:locks:{target}"
        raw = self._r.get(key)
        if not raw:
            return {"released": False, "reason": "absent"}
        if json.loads(raw).get("owner_id") != user_id:
            return {"released": False, "reason": "not_owner"}
        self._r.delete(key)
        return {"released": True, "reason": "ok"}

    def list_locks(self, tenant: str, room: str) -> list:
        locks = []
        for key in self._r.scan_iter(f"{self._base(tenant, room)}:locks:*"):
            raw = self._r.get(key)
            if raw:
                target = key.rsplit(":locks:", 1)[1]
                holder = json.loads(raw)
                locks.append({"target": target, **holder,
                              "expires_in_s": max(0, self._r.pttl(key) // 1000)})
        locks.sort(key=lambda l: l["target"])
        return locks


_SINGLETON: Optional[CollabService] = None


def get_collab_service() -> CollabService:
    """Client Redis RÉEL, un par process (lazy). Injectable pour les tests."""
    global _SINGLETON
    if _SINGLETON is None:
        import redis  # import tardif : garde le cold start léger

        client = redis.from_url(
            os.getenv("REDIS_URL", "redis://redis:6379/0"), decode_responses=True
        )
        _SINGLETON = CollabService(client)
    return _SINGLETON
