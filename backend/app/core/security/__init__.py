"""
NARCHI V5 — Security Package
Unified exports for authentication, authorization, and password management.
"""

# Configuration
from app.core.security.config import (
    hasher,
    SECRET_KEY,
    LEGACY_SHA256_SALT,
)

# Context (tenant_id, request_id, user_id)
from app.core.context import (
    tenant_id_context,
    request_id_context,
    user_id_context,
)

# Password hashing & verification
from app.core.security.passwords import (
    get_password_hash,
    verify_password,
    verify_legacy_sha256,
)

# JWT token management
from app.core.security.jwt import (
    create_access_token,
    decode_token,
    get_token_payload,
)

# FastAPI dependencies
from app.core.security.dependencies import (
    get_current_user,
    get_current_active_user,
    require_role,
    require_owner,
    require_architect_or_owner,
    CREDENTIALS_EXCEPTION,
)

# Admin & guest seeding
from app.core.security.admin import (
    ensure_ak_berlin_guest,
    ensure_default_admins,
    ensure_default_admin,  # alias compat
)

# Password migration (SHA-256 -> Argon2id)
from app.core.security.password_migration import (
    PasswordMigrationService,
    apply_migration_to_user,
    HashScheme,
)

# Cookie security adapter
from app.core.security.cookie_adapter import (
    cookie_adapter,
    CookieSecurityAdapter,
    CookieSecurityProfile,
)

__all__ = [
    # Config
    "hasher",
    "SECRET_KEY",
    "LEGACY_SHA256_SALT",
    # Context
    "tenant_id_context",
    "request_id_context",
    "user_id_context",
    # Passwords
    "get_password_hash",
    "verify_password",
    "verify_legacy_sha256",
    # JWT
    "create_access_token",
    "decode_token",
    "get_token_payload",
    # Dependencies
    "get_current_user",
    "get_current_active_user",
    "require_role",
    "require_owner",
    "require_architect_or_owner",
    "CREDENTIALS_EXCEPTION",
    # Admin
    "ensure_ak_berlin_guest",
    "ensure_default_admins",
    "ensure_default_admin",  # alias compat
    # Password migration
    "PasswordMigrationService",
    "apply_migration_to_user",
    "HashScheme",
    # Cookies
    "cookie_adapter",
    "CookieSecurityAdapter",
    "CookieSecurityProfile",
]