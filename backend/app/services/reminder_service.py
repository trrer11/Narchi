"""
NARCHI V5 — Serverseitige Terminerinnerungen (§46) : worker asynchrone.

Boucle toutes les REMINDER_POLL_SECONDS (défaut 60 s) dans le MÊME conteneur
backend (pas de service supplémentaire à maintenir) :
1. déclenche les rappels dûs (e-mail si SMTP configuré + statut « fired ») ;
2. purge les rappels expirés (événement passé sans déclenchement) et les
   « fired » de plus de 14 jours.

Robustesse : chaque itération est enfermée — une panne SMTP/dB ne tue
jamais la boucle ; arrêt propre à l'extinction via asyncio.Event.
"""

from __future__ import annotations

import asyncio
from datetime import timedelta

from app.core.logging import get_logger
from app.core.reminder_engine import (
    STATUS_FIRED,
    STATUS_PENDING,
    base_url_hint,
    dispatch_reminder,
    due_reminders,
    expired_reminders,
    smtp_config_from_settings,
    utcnow,
)
from app.database import SessionLocal
from app.models.reminder import Reminder
from app.models.user import User

logger = get_logger("reminders")

# Mémoire de purge : les « fired » (pull in-app de secours) vivent 14 jours max.
FIRED_RETENTION_DAYS = 14


def run_reminder_cycle(settings, mailer=None) -> dict:
    """
    UN cycle de traitement (synchrone, appelé depuis la boucle ou les tests).
    Retourne des compteurs AUDITABLES (jamais d'envoi muet).
    """
    counters = {"due": 0, "email": 0, "inapp": 0, "email_failed": 0, "expired": 0, "purged": 0}
    db = SessionLocal()
    try:
        now = utcnow()
        cfg = smtp_config_from_settings(settings)
        app_url = base_url_hint(settings)

        pending = db.query(Reminder).filter(Reminder.status == STATUS_PENDING).all()
        users = {u.id: u for u in db.query(User).filter(User.id.in_({r.user_id for r in pending})).all()} if pending else {}

        kwargs = {"cfg": cfg, "now": now, "app_url": app_url}
        if mailer is not None:
            kwargs["mailer"] = mailer

        for row in due_reminders(pending, now):
            user = users.get(row.user_id)
            channel = dispatch_reminder(row, user_email=(user.email if user else None), **kwargs)
            counters["due"] += 1
            counters[channel] = counters.get(channel, 0) + 1

        for row in expired_reminders(pending, now):
            db.delete(row)
            counters["expired"] += 1

        cutoff = now - timedelta(days=FIRED_RETENTION_DAYS)
        for row in db.query(Reminder).filter(Reminder.status == STATUS_FIRED, Reminder.fired_at.isnot(None), Reminder.fired_at < cutoff).all():
            db.delete(row)
            counters["purged"] += 1

        db.commit()
    except Exception:
        db.rollback()
        logger.exception("reminder_cycle_failed", extra={"event_code": "REMINDER_CYCLE_FAILED"})
        raise
    finally:
        db.close()
    return counters


async def reminder_worker_loop(settings, stop: asyncio.Event) -> None:
    """Boucle infinie propre : premier passage après 15 s de démarrage."""
    poll = max(10, int(getattr(settings, "REMINDER_POLL_SECONDS", 60)))
    logger.info("reminder_worker_started", extra={"event_code": "REMINDER_WORKER_STARTED", "poll_seconds": poll})
    try:
        await asyncio.wait_for(stop.wait(), timeout=15)
        return  # arrêt pendant la fenêtre de démarrage
    except asyncio.TimeoutError:
        pass
    while not stop.is_set():
        try:
            counters = await asyncio.to_thread(run_reminder_cycle, settings)
            if counters["due"] or counters["expired"] or counters["purged"]:
                logger.info("reminder_cycle_done", extra={"event_code": "REMINDER_CYCLE_DONE", **counters})
        except Exception:
            # run_reminder_cycle a déjà journalisé — la boucle SURVIT toujours.
            pass
        try:
            await asyncio.wait_for(stop.wait(), timeout=poll)
        except asyncio.TimeoutError:
            continue
    logger.info("reminder_worker_stopped", extra={"event_code": "REMINDER_WORKER_STOPPED"})
