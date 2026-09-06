"""
NARCHI V5 — Serverseitige Terminerinnerungen (§46) Pydantic Schemas.
"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class ReminderIn(BaseModel):
    """Une entrée « Mein Kalender » avec rappel, côté client."""

    entry_id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=300)
    kind: str = Field(default="termin", max_length=30)
    starts_at: datetime  # ISO 8601 avec fuseau
    remind_before_h: float = Field(default=0.0, ge=0.0, le=24 * 60)
    note: Optional[str] = Field(default=None, max_length=2000)


class ReminderSyncRequest(BaseModel):
    """Remplacement complet (upsert idempotent) des rappels FUTURS du user."""

    reminders: List[ReminderIn] = Field(default_factory=list, max_length=500)


class ChannelStatus(BaseModel):
    """État HONNÊTE des canaux — affiché tel quel dans l'app."""

    email_enabled: bool
    email_recipient: Optional[str] = None  # masqué : « ar***@buero.de »
    inapp_enabled: bool = True


class ReminderSyncResult(BaseModel):
    synced: int
    retired: int
    channels: ChannelStatus


class ReminderOut(BaseModel):
    entry_id: str
    title: str
    kind: str
    starts_at: datetime
    remind_before_h: float
    note: Optional[str]
    fired_at: datetime
    email_sent: bool
