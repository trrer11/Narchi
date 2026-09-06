"""§115 — Schémas de l'API Mängel (synchro inter-appareils).

Validation stricte côté serveur : la base partagée ne doit JAMAIS porter
un Mangel sans jour, avec une gravité inventée ou un horodatage
illisible — sinon le delta-sync semerait le doute sur tous les appareils.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

_SEVERITIES = ("minor", "major", "critical")
_STATUSES = ("open", "in-review", "resolved")  # §117 : « in-review » existe au cockpit
_JOUR = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class IssueSyncItem(BaseModel):
    """Un Mangel poussé par un appareil (horodatage CLIENT = LWW)."""

    id: str = Field(min_length=1, max_length=64)
    project_id: str = Field(min_length=1, max_length=64)
    day: str
    title: str = Field(min_length=1, max_length=300)
    description: str = Field(default="", max_length=4000)
    zone: str = Field(default="", max_length=300)
    severity: Literal["minor", "major", "critical"]
    status: Literal["open", "in-review", "resolved"] = "open"
    photo_ids: List[str] = Field(default_factory=list, max_length=500)
    video_ids: List[str] = Field(default_factory=list, max_length=500)
    updated_at: datetime

    @field_validator("day")
    @classmethod
    def _jour_iso(cls, v: str) -> str:
        if not _JOUR.match(v):
            raise ValueError(f"day doit être « AAAA-MM-JJ », reçu « {v} »")
        return v

    @field_validator("photo_ids", "video_ids")
    @classmethod
    def _ids_propres(cls, v: List[str]) -> List[str]:
        for i in v:
            if not i or len(i) > 128:
                raise ValueError("identifiant de média vide ou démesuré")
        return v


class IssueBatchRequest(BaseModel):
    items: List[IssueSyncItem] = Field(min_length=1, max_length=200)


class IssueApplied(BaseModel):
    id: str
    applied: bool                 # True = écrit ; False = ignoré (serveur plus récent)
    server_updated_at: datetime   # horodatage gagnant, toujours dit


class IssueBatchResponse(BaseModel):
    results: List[IssueApplied]


class IssueOut(BaseModel):
    id: str
    project_id: str
    day: str
    title: str
    description: str
    zone: str
    severity: str
    status: str
    photo_ids: List[str]
    video_ids: List[str]
    created_by: str
    created_at: Optional[datetime]
    updated_at: datetime
    deleted_at: Optional[datetime]


class IssueListResponse(BaseModel):
    issues: List[IssueOut]
    server_time: datetime         # curseur du prochain delta — dit, jamais deviné
    truncated: bool = False       # honnêteté si la limite a tranché
