"""
NARCHI V5 — Serverseitige Terminerinnerungen (§46) ORM Model.

Les rappels « Mein Kalender » ne sonnaient jusqu'ici QUE si l'onglet NARCHI
était ouvert. Cette table est la source côté serveur : le frontend sync ses
entrées avec rappel, un worker (REMINDER_WORKER_ENABLED) déclenche au bon
moment — canal e-mail (si SMTP configuré, jamais un « activé » muet) et
canal in-app récupéré à la réouverture (multi-appareils inclus).
"""

from sqlalchemy import Boolean, Column, DateTime, Float, Index, String, func

from app.database import Base


class Reminder(Base):
    __tablename__ = "reminders"

    # id = entry_id côté client (stable par événement → upsert idempotent)
    id = Column(String, primary_key=True)
    user_id = Column(String, index=True, nullable=False)
    title = Column(String, nullable=False)
    kind = Column(String, default="termin", nullable=False)  # aufgabe|termin|urlaub|...
    starts_at = Column(DateTime(timezone=True), nullable=False, index=True)
    remind_before_h = Column(Float, default=0.0, nullable=False)
    note = Column(String, nullable=True)

    # pending → fired (déclenché, même si l'e-mail n'est pas configuré :
    # le statut « fired » alimente le pull in-app — honnêtement distingué).
    status = Column(String, default="pending", nullable=False, index=True)
    fired_at = Column(DateTime(timezone=True), nullable=True)
    email_sent = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


Index("ix_reminders_user_status", Reminder.user_id, Reminder.status)
