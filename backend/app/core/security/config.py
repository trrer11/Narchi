"""NARCHI V5 — Paramètres cryptographiques fail-closed."""

from __future__ import annotations

import os
import secrets

from argon2 import PasswordHasher

hasher = PasswordHasher(
    time_cost=3,
    memory_cost=32768,
    parallelism=2,
    hash_len=32,
    salt_len=16,
    encoding="utf-8",
)

_ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
SECRET_KEY = os.getenv("SECRET_KEY", "").strip()

if len(SECRET_KEY) < 64:
    if _ENVIRONMENT == "production":
        raise RuntimeError(
            "SECRET_KEY doit contenir au moins 64 caractères aléatoires en production"
        )
    # Clé éphémère autorisée uniquement en développement/test.
    SECRET_KEY = secrets.token_hex(64)

LEGACY_SHA256_SALT = os.getenv("LEGACY_SHA256_SALT", "").strip()
if _ENVIRONMENT == "production" and len(LEGACY_SHA256_SALT) < 32:
    raise RuntimeError(
        "LEGACY_SHA256_SALT doit être configuré pendant la migration des mots de passe"
    )
