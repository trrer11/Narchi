"""
NARCHI V5 — Serverseitige Terminerinnerungen (§46) API Router.

Le frontend « Mein Kalender » synchronise ici les entrées AVEC rappel :
le serveur devient la source — les rappels sonnent même onglet fermé
(e-mail si SMTP configuré + pull in-app à la réouverture, multi-appareils).
Rien n'est semé : seules les entrées réelles du bureau transitent.
"""

from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.reminder_engine import (
    STATUS_FIRED,
    ensure_aware,
    mask_email,
    schedule_changed,
    smtp_config_from_settings,
    utcnow,
)
from app.core.security import get_current_user
from app.database import get_db
from app.models.reminder import Reminder
from app.models.user import User
from app.schemas.reminder import (
    ChannelStatus,
    ReminderOut,
    ReminderSyncRequest,
    ReminderSyncResult,
)

router = APIRouter(prefix="/api/v5/reminders", tags=["Serverseitige Terminerinnerungen"])

# Rappels « fired » récupérables (pull in-app) pendant 48 h par défaut.
DUE_WINDOW_DEFAULT_H = 48


def channel_status(user: User) -> ChannelStatus:
    """État HONNÊTE des canaux pour l'UI : SMTP ? destinataire ? in-app."""
    from app.config import settings  # import tardif : les tests peuvent surcharger settings

    cfg = smtp_config_from_settings(settings)
    email = (user.email or "").strip() if user else ""
    return ChannelStatus(
        email_enabled=cfg is not None and bool(email),
        email_recipient=mask_email(email) if email else None,
        inapp_enabled=True,
    )


@router.post("/sync", response_model=ReminderSyncResult)
def sync_reminders(
    req: ReminderSyncRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Remplacement des rappels FUTURS du user (upsert idempotent sur entry_id) :
    - nouveau → insert « pending » ;
    - modifié (titre/heure/notiz) → ré-armé « pending », e-mail réinitialisé ;
    - identique → intact ;
    - absent de la liste → supprimé SEULEMENT s'il est encore « pending »
      (un rappel déjà déclenché reste consultable 48 h : transparence).
    """
    now = utcnow()
    incoming = {r.entry_id: r for r in req.reminders}

    existing = (
        db.query(Reminder)
        .filter(Reminder.user_id == current_user.id)
        .all()
    )
    by_id = {row.id: row for row in existing}

    retired = 0
    for row in existing:
        if row.id not in incoming and row.status != STATUS_FIRED:
            db.delete(row)
            retired += 1

    for entry_id, item in incoming.items():
        starts = ensure_aware(item.starts_at)
        row = by_id.get(entry_id)
        if row is None:
            db.add(
                Reminder(
                    id=entry_id,
                    user_id=current_user.id,
                    title=item.title,
                    kind=item.kind,
                    starts_at=starts,
                    remind_before_h=item.remind_before_h,
                    note=item.note,
                )
            )
        elif schedule_changed(
            row,
            title=item.title,
            kind=item.kind,
            starts_at=starts,
            remind_before_h=item.remind_before_h,
            note=item.note,
        ):
            row.title = item.title
            row.kind = item.kind
            row.starts_at = starts
            row.remind_before_h = item.remind_before_h
            row.note = item.note
            # Ré-armement HONNÊTE : la nouvelle programmation re-sonnera.
            row.status = "pending"
            row.fired_at = None
            row.email_sent = False

    db.commit()
    return ReminderSyncResult(synced=len(incoming), retired=retired, channels=channel_status(current_user))


@router.get("/due", response_model=List[ReminderOut])
def due_reminders(
    hours: int = Query(default=DUE_WINDOW_DEFAULT_H, ge=1, le=24 * 14),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Pull in-app : rappels DÉCLENCHÉS dans la fenêtre (défaut 48 h) — c'est
    le canal qui fonctionne « NARCHI fermé » dès la réouverture, tous
    appareils confondus. Le navigateur déduplique par (entry_id, fired_at).
    """
    since = utcnow() - timedelta(hours=hours)
    rows = (
        db.query(Reminder)
        .filter(
            Reminder.user_id == current_user.id,
            Reminder.status == STATUS_FIRED,
            Reminder.fired_at.isnot(None),
            Reminder.fired_at >= since,
        )
        .order_by(Reminder.fired_at.desc())
        .limit(200)
        .all()
    )
    return [
        ReminderOut(
            entry_id=row.id,
            title=row.title,
            kind=row.kind,
            starts_at=ensure_aware(row.starts_at),
            remind_before_h=row.remind_before_h,
            note=row.note,
            fired_at=ensure_aware(row.fired_at or since),
            email_sent=row.email_sent,
        )
        for row in rows
    ]


@router.get("/channels", response_model=ChannelStatus)
def get_channels(current_user: User = Depends(get_current_user)):
    """Badge honnête du header : « E-Mail aktiv » ou « E-Mail nicht konfiguriert »."""
    return channel_status(current_user)
