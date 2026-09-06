"""§118 — Schémas de la synchro Projets (miroir serveur).

Même discipline que §115 : identifiants fournis par l'appareil, payload
COMPLET mais contrôlé en taille et en types (jamais de texte déployé en
la base partagée), suppression = pierre tombale.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator

_MAX_PAYLOAD_CHAMPS = 40
_MAX_LONGUEUR_TEXTE = 2000


class ProjectSyncItem(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=300)
    # Fiche complète (code, client, startDate…) : validée en FORME seule —
    # le serveur n'a pas à connaître la finance du bureau, juste à relayer.
    payload: Dict[str, Any] = Field(default_factory=dict)
    updated_at: datetime

    @field_validator("payload")
    @classmethod
    def _payload_propre(cls, v: Dict[str, Any]) -> Dict[str, Any]:
        if len(v) > _MAX_PAYLOAD_CHAMPS:
            raise ValueError(f"payload: {_MAX_PAYLOAD_CHAMPS} champs max (reçu {len(v)})")
        for cle, val in v.items():
            if not isinstance(cle, str) or not cle or len(cle) > 64:
                raise ValueError("payload: clé vide ou démesurée")
            if isinstance(val, str) and len(val) > _MAX_LONGUEUR_TEXTE:
                raise ValueError(f"payload.{cle}: texte > {_MAX_LONGUEUR_TEXTE} signes")
            if isinstance(val, list):
                for el in val:
                    if not isinstance(el, str) or len(el) > 200:
                        raise ValueError(f"payload.{cle}: liste = textes courts uniquement")
            elif not isinstance(val, (str, int, float, bool)) and val is not None:
                raise ValueError(f"payload.{cle}: type non relais ({type(val).__name__})")
        return v


class ProjectSyncBatchRequest(BaseModel):
    items: List[ProjectSyncItem] = Field(min_length=1, max_length=100)


class ProjectSyncApplied(BaseModel):
    id: str
    applied: bool
    server_updated_at: datetime


class ProjectSyncBatchResponse(BaseModel):
    results: List[ProjectSyncApplied]


class ProjectSyncOut(BaseModel):
    id: str
    name: str
    payload: Dict[str, Any]
    created_by: str
    created_at: Optional[datetime]
    updated_at: datetime
    deleted_at: Optional[datetime]


class ProjectSyncListResponse(BaseModel):
    projects: List[ProjectSyncOut]
    server_time: datetime
    truncated: bool
