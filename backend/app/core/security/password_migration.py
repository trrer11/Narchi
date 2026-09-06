"""
NARCHI V5 — Service de migration de hachage SHA-256 → Argon2id (OWASP 2026).
Zero-downtime : migration transparente à la première connexion réussie.
"""

from __future__ import annotations

import os
import hashlib
import hmac
import logging
from datetime import datetime
from enum import Enum
from typing import Optional, Tuple

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

logger = logging.getLogger("narchi.security.password")

ARGON2_HASHER = PasswordHasher(
    time_cost=3,
    memory_cost=32768,
    parallelism=2,
    hash_len=32,
    salt_len=16,
    encoding="utf-8",
)

def _get_legacy_salt() -> str:
    salt = os.environ.get("LEGACY_SHA256_SALT", "")
    if not salt:
        raise RuntimeError(
            "[Security] LEGACY_SHA256_SALT est requis en variable d'environnement. "
            "Ne jamais coder ce secret en dur dans le source."
        )
    return salt


class HashScheme(str, Enum):
    SHA256_LEGACY = "sha256_legacy"
    ARGON2ID = "argon2id"
    UNKNOWN = "unknown"


class PasswordMigrationService:
    """
    Service de migration "online" des mots de passe.
    Détecte le schéma, vérifie et rehash en Argon2id si nécessaire.
    """

    @staticmethod
    def detect_scheme(stored_hash: str) -> HashScheme:
        if stored_hash.startswith("$argon2id$"):
            return HashScheme.ARGON2ID
        if stored_hash.startswith("$argon2i$"):
            return HashScheme.ARGON2ID
        if len(stored_hash) == 64 and all(c in "0123456789abcdef" for c in stored_hash):
            return HashScheme.SHA256_LEGACY
        if stored_hash.startswith("sha256:"):
            return HashScheme.SHA256_LEGACY
        return HashScheme.UNKNOWN

    @staticmethod
    def hash_legacy_sha256(password: str, salt: str = None) -> str:
        if salt is None:
            salt = _get_legacy_salt()
        return hmac.new(
            salt.encode("utf-8"),
            password.encode("utf-8"),
            hashlib.sha256
        ).hexdigest()

    @staticmethod
    def hash_argon2id(password: str) -> str:
        return ARGON2_HASHER.hash(password)

    @classmethod
    def verify_and_migrate(
        cls,
        plain_password: str,
        stored_hash: str,
        legacy_salt: str = None,
    ) -> Tuple[bool, Optional[str]]:
        if legacy_salt is None:
            legacy_salt = _get_legacy_salt()
        """
        Retourne (verified, new_hash).
        new_hash est non-None si une migration a eu lieu.
        """
        scheme = cls.detect_scheme(stored_hash)

        if scheme == HashScheme.ARGON2ID:
            try:
                ARGON2_HASHER.verify(stored_hash, plain_password)
                if ARGON2_HASHER.check_needs_rehash(stored_hash):
                    return True, cls.hash_argon2id(plain_password)
                return True, None
            except VerifyMismatchError:
                return False, None
            except (InvalidHashError, VerificationError) as e:
                logger.error(f"Erreur vérification Argon2id: {e}")
                return False, None

        if scheme == HashScheme.SHA256_LEGACY:
            computed = cls.hash_legacy_sha256(plain_password, legacy_salt)
            is_valid = hmac.compare_digest(computed.encode(), stored_hash.encode())
            if is_valid:
                new_hash = cls.hash_argon2id(plain_password)
                logger.info("Migration SHA-256 → Argon2id effectuée.")
                return True, new_hash
            return False, None

        logger.error(
            "Schéma de hash de mot de passe inconnu",
            extra={"event_code": "AUTH_PASSWORD_HASH_UNKNOWN"},
        )
        return False, None


def apply_migration_to_user(user, plain_password: str) -> bool:
    """Applique la migration au modèle User et retourne True si migré."""
    is_valid, new_hash = PasswordMigrationService.verify_and_migrate(
        plain_password, user.hashed_password or ""
    )
    if is_valid and new_hash:
        user.hashed_password = new_hash
        user.password_migrated_at = datetime.utcnow()
        return True
    return False
