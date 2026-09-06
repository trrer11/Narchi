"""
NARCHI V5 — Password Hashing & Verification
Argon2id (primary) with SHA-256 legacy fallback for zero-downtime migration.
"""

import hashlib
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.core.security.config import hasher, LEGACY_SHA256_SALT


def get_password_hash(password: str) -> str:
    """Generate a robust Argon2id hash with cryptographic salt."""
    return hasher.hash(password)


def verify_legacy_sha256(plain_password: str, hashed_password: str) -> bool:
    """Verify a password hashed with the legacy single-round salted SHA-256 method."""
    expected = hashlib.sha256(f"{LEGACY_SHA256_SALT}{plain_password}".encode("utf-8")).hexdigest()
    return expected == hashed_password


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify password accepting Argon2id (primary) and tolerating SHA-256 (legacy)
    for zero-downtime hot migration.
    """
    if not hashed_password:
        return False

    if hashed_password.startswith("$argon2id$"):
        try:
            hasher.verify(hashed_password, plain_password)
            return True
        except VerifyMismatchError:
            return False
    else:
        # Legacy SHA-256 fallback
        return verify_legacy_sha256(plain_password, hashed_password)