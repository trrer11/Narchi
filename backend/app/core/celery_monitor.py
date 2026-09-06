"""Celery app légère pour Flower, sans import des tâches BIM/PDF."""

import os

from celery import Celery

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

celery_app = Celery(
    "narchi_monitor",
    broker=REDIS_URL,
    backend=REDIS_URL,
)
celery_app.conf.update(
    timezone="Europe/Paris",
    enable_utc=True,
)
