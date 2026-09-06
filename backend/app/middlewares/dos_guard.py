"""
NARCHI V5 — Logic DoS Guard & Hardware Circuit Breaker (SecOps Edition).
Intercepts and rate-limits resource-intensive REST operations (DIN 276 compute, PDF compilation)
using dual-key Redis Sliding Windows (User & Tenant keys) and a container-aware CPU Circuit Breaker.

FIX: Remplace psutil.cpu_percent(interval=None) peu fiable en conteneur par lecture cgroups v2.
"""

import time
import os
import threading
import psutil
import redis
from fastapi import Depends, HTTPException, status, Request

from app.core.security import get_current_user
from app.core.logging import get_logger

logger = get_logger("dos_guard")

# Configuration du client de cache Redis
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
try:
    r_client = redis.from_url(REDIS_URL, socket_timeout=2, decode_responses=True)
except Exception as e:
    logger.warning("Redis unavailable, sliding window protection disabled", extra={"error": str(e)})
    r_client = None


_cpu_sample_lock = threading.Lock()
_last_cpu_sample: tuple[int, float] | None = None


def _cgroup_cpu_capacity() -> float:
    try:
        quota, period = open("/sys/fs/cgroup/cpu.max", encoding="utf-8").read().split()
        if quota != "max":
            return max(float(quota) / float(period), 0.1)
    except (OSError, ValueError, ZeroDivisionError):
        pass
    return float(os.cpu_count() or 1)


def _get_container_cpu_percent() -> float:
    """Calcule un delta cgroups v2, jamais le compteur cumulatif brut."""
    global _last_cpu_sample
    try:
        usage_usec = 0
        with open("/sys/fs/cgroup/cpu.stat", encoding="utf-8") as stat_file:
            for line in stat_file:
                key, value = line.split()
                if key == "usage_usec":
                    usage_usec = int(value)
                    break
        now = time.monotonic()
        with _cpu_sample_lock:
            previous = _last_cpu_sample
            _last_cpu_sample = (usage_usec, now)
        if previous is None:
            return 0.0
        delta_cpu_seconds = max(0, usage_usec - previous[0]) / 1_000_000
        delta_wall_seconds = max(now - previous[1], 1e-6)
        capacity = _cgroup_cpu_capacity()
        return min(100.0, delta_cpu_seconds / (delta_wall_seconds * capacity) * 100)
    except (OSError, ValueError):
        try:
            one_minute_load = os.getloadavg()[0]
            return min(100.0, one_minute_load / (os.cpu_count() or 1) * 100)
        except (OSError, AttributeError):
            return psutil.cpu_percent(interval=None)


async def verify_dos_protection(
    request: Request,
    current_user = Depends(get_current_user)
):
    """
    Dépendance FastAPI d'interception et de protection contre le déni de service logique.
    1. Circuit Breaker : Avorte les requêtes lourdes si la charge CPU du conteneur dépasse 80%.
    2. Double Rate-Limit distribué (Redis ZSET) : Limite à 10 appels/minute par utilisateur,
       et 30 appels/minute consolidés par tenant d'agence d'architecture.
    """
    # ------------------------------------------------------------------
    # 1. HARDWARE CIRCUIT BREAKER (CPU Guard - Container Aware)
    # ------------------------------------------------------------------
    cpu_usage = _get_container_cpu_percent()
    if cpu_usage > 80.0:
        logger.warning("Circuit breaker triggered: CPU threshold exceeded",
                       extra={"cpu_usage_percent": cpu_usage, "threshold": 80.0})
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Le serveur est temporairement surchargé de calculs structurels. Veuillez patienter quelques instants."
        )

    # ------------------------------------------------------------------
    # 2. DOUBLE SLIDING WINDOW RATE-LIMIT (User & Tenant)
    # ------------------------------------------------------------------
    if r_client is None:
        return  # Dégradation gracieuse si Redis down

    user_key = f"ratelimit:heavy:user:{current_user.id}"
    tenant_key = f"ratelimit:heavy:tenant:{current_user.tenant_id}"
    now = time.time()
    window_seconds = 60

    try:
        pipe = r_client.pipeline()

        # --- Limite Individuelle Utilisateur (max 10 requêtes lourdes par minute) ---
        pipe.zremrangebyscore(user_key, 0, now - window_seconds)
        pipe.zcard(user_key)
        pipe.zadd(user_key, {str(now): now})
        pipe.expire(user_key, window_seconds + 5)

        # --- Limite Collective Agence/Tenant (max 30 requêtes lourdes par minute) ---
        pipe.zremrangebyscore(tenant_key, 0, now - window_seconds)
        pipe.zcard(tenant_key)
        pipe.zadd(tenant_key, {str(now): now})
        pipe.expire(tenant_key, window_seconds + 5)

        response_payload = pipe.execute()

        user_attempts = response_payload[1]
        tenant_attempts = response_payload[5]

        if user_attempts >= 10:
            logger.warning("User rate limit exceeded",
                           extra={"user_id": current_user.id, "attempts": user_attempts, "limit": 10})
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Limite d'appels intensifs atteinte. Maximum 10 calculs/exports autorisés par minute."
            )

        if tenant_attempts >= 30:
            logger.warning("Tenant rate limit exceeded",
                           extra={"tenant_id": current_user.tenant_id, "attempts": tenant_attempts, "limit": 30})
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Limite d'appels collectifs de votre agence atteinte. Maximum 30 calculs collectifs par minute."
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Rate-limit Redis error, security bypass",
                     extra={"error": str(e), "user_id": current_user.id})
        pass