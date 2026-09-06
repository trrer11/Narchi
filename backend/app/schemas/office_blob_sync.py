from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

OfficeBlobKind = Literal[
    "mahnwesen",
    "stunden",
    "entscheidungen",
    "bauteile",
    "szenarien",
    "absender",
    "abschlag",
    "worklog",
    "kalender",
    "impressum",
    "scope",
]
KINDS = frozenset(
    {
        "mahnwesen",
        "stunden",
        "entscheidungen",
        "bauteile",
        "szenarien",
        "absender",
        "abschlag",
        "worklog",
        "kalender",
        "impressum",
        "scope",
    }
)
MAX_PAYLOAD_CHARS = 80_000


class OfficeBlobPut(BaseModel):
    payload: dict[str, Any]
    updated_at: datetime

    @field_validator("payload")
    @classmethod
    def _taille(cls, v: dict[str, Any]) -> dict[str, Any]:
        raw = str(v)
        if len(raw) > MAX_PAYLOAD_CHARS:
            raise ValueError("payload trop grand")
        return v


class OfficeBlobOut(BaseModel):
    kind: str
    payload: dict[str, Any]
    updated_at: datetime
    empty: bool = False
