"""§60 — Rate limiter distribué partagé (fenêtre glissante Redis + repli local).

Extrait de ``app/api/auth_routes.py`` après audit : ce limiteur n'y couvrait
QUE ``/token`` (login) ; le reste de la surface sensible (register,
guest-login, reset-password, upload IFC, envoi de messages chat) n'avait
AUCUNE limitation — trou réel remonté par un audit cybersécurité externe.

Désormais chaque endpoint sensible instancie son limiteur avec un
``namespace`` propre : les clés Redis ``ratelimit:{namespace}:{subject}:{ip}``
sont isolées par surface d'attaque (un quota épuisé sur le chat ne bride
pas le login, et réciproquement). Le comportement du namespace ``login``
est strictement identique à l'historique (mêmes clés, mêmes codes
d'événement ``AUTH_RATE_LIMITED`` pour ne pas casser l'observabilité).

Aucune confiance dans ``X-Forwarded-For`` : l'IP lu vient strictement de la
connexion ASGI (anti IP-spoofing, dogme SEC-003 déjà appliqué au login).
"""
from __future__ import annotations

import os
import time
from collections import defaultdict
from threading import Lock

import redis

from app.core.logging import anonymize_identifier, get_logger

logger = get_logger("rate_limit")

# Client distribué (identique à l'historique : ping + repli local silencieux).
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
try:
    # Initialisation robuste avec socket_timeout pour éviter tout blocage d'API
    redis_client = redis.from_url(REDIS_URL, socket_timeout=2, decode_responses=True)
    redis_client.ping()
    logger.info(
        "Distributed rate limiter connected to Redis",
        extra={"event_code": "AUTH_REDIS_CONNECTED"},
    )
except Exception as error:
    logger.warning(
        "Redis unavailable for rate limiting; using local fallback",
        extra={
            "event_code": "AUTH_REDIS_FALLBACK",
            "error_type": type(error).__name__,
        },
    )
    redis_client = None


# Compatibilité observabilité : le namespace historique « login » conserve
# EXACTEMENT ses codes d'événement d'origine ; les nouvelles surfaces ont
# des codes génériques propres (traçables dans COLLECT_DIAGNOSTICS).
_CODES = {
    "limited": ("AUTH_RATE_LIMITED", "RATE_LIMITED"),
    "limited_local": ("AUTH_RATE_LIMITED_LOCAL", "RATE_LIMITED_LOCAL"),
    "redis_fallback": ("AUTH_REDIS_RUNTIME_FALLBACK", "RATE_LIMIT_REDIS_FALLBACK"),
}


class RedisSlidingWindowRateLimiter:
    """
    Rate limiter distribué en production basé sur une fenêtre glissante Redis (ZSET).
    Clé composite : 'ratelimit:{namespace}:{subject}:{ip_address}'.
    Comprend un repli local (fallback) en mémoire vive en cas de panne de Redis.
    """

    def __init__(self, max_attempts: int = 5, window_seconds: int = 60, *, namespace: str = "login"):
        if not namespace or not namespace.replace("-", "").replace("_", "").isalnum():
            raise ValueError(f"namespace de limiteur invalide: {namespace!r}")
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self.namespace = namespace

        # Fallback local (Single-instance high-availability)
        self.local_attempts = defaultdict(list)
        self.local_lock = Lock()

    def _event_code(self, kind: str) -> str:
        login_code, generic_code = _CODES[kind]
        return login_code if self.namespace == "login" else generic_code

    def check_and_record(self, subject: str, ip_address: str) -> bool:
        """
        Vérifie et enregistre une tentative de manière distribuée.
        Retourne True si l'appel est autorisé, False si le quota du sujet
        est épuisé dans la fenêtre courante (l'appelant répond alors 429).
        """
        key = f"ratelimit:{self.namespace}:{subject.strip().lower()}:{ip_address}"
        now = time.time()

        # 1. Utilisation du stockage distribué Redis (Multi-instances répliquées)
        if redis_client is not None:
            try:
                pipe = redis_client.pipeline()
                pipe.zremrangebyscore(key, 0, now - self.window_seconds)
                pipe.zcard(key)
                pipe.zadd(key, {str(now): now})
                pipe.expire(key, self.window_seconds + 5)

                _, current_attempts, _, _ = pipe.execute()

                if current_attempts >= self.max_attempts:
                    logger.warning(
                        "Distributed rate limit reached",
                        extra={
                            "event_code": self._event_code("limited"),
                            "subject_ref": anonymize_identifier(subject),
                            "limiter_namespace": self.namespace,
                            "attempt_count": current_attempts,
                        },
                    )
                    return False
                return True

            except Exception as error:
                logger.warning(
                    "Redis rate limiter failed; switching to local fallback",
                    extra={
                        "event_code": self._event_code("redis_fallback"),
                        "limiter_namespace": self.namespace,
                        "error_type": type(error).__name__,
                    },
                )

        # 2. Fallback de secours local en mémoire vive (Thread-Safe & Résilient)
        with self.local_lock:
            self.local_attempts[key] = [t for t in self.local_attempts[key] if now - t < self.window_seconds]
            if len(self.local_attempts[key]) >= self.max_attempts:
                logger.warning(
                    "Local rate limit reached",
                    extra={
                        "event_code": self._event_code("limited_local"),
                        "subject_ref": anonymize_identifier(subject),
                        "limiter_namespace": self.namespace,
                        "attempt_count": len(self.local_attempts[key]),
                    },
                )
                return False
            self.local_attempts[key].append(now)
            return True
