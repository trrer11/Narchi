"""§163 — Schémas de la synchro VE-Varianten (miroir serveur).

Même discipline que §118 : identifiants fournis par l'appareil, payload
COMPLET mais contrôlé en FORME (taille, types — jamais de texte démesuré
déployé en base partagée), suppression = pierre tombale.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator

_MAX_PAYLOAD_CHAMPS = 40
_MAX_LONGUEUR_TEXTE = 2000


class VEVariantSyncItem(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=300)
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


class VEVariantSyncBatchRequest(BaseModel):
    items: List[VEVariantSyncItem] = Field(min_length=1, max_length=100)


class VEVariantSyncApplied(BaseModel):
    id: str
    applied: bool
    server_updated_at: datetime


class VEVariantSyncBatchResponse(BaseModel):
    results: List[VEVariantSyncApplied]


class VEVariantSyncOut(BaseModel):
    id: str
    name: str
    payload: Dict[str, Any]
    created_by: str
    created_at: Optional[datetime]
    updated_at: datetime
    deleted_at: Optional[datetime]


class VEVariantSyncListResponse(BaseModel):
    variants: List[VEVariantSyncOut]
    server_time: datetime
    truncated: bool
