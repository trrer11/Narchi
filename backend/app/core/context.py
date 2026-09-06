"""
NARCHI V5 — Shared Context Variables
Neutral module for context variables used across the application.
This module has ZERO dependencies on other app modules.
"""

from contextvars import ContextVar

# Context variable for propagating tenant_id from JWT to ORM session
tenant_id_context: ContextVar[str | None] = ContextVar("tenant_id", default=None)

# Context variable for propagating request_id for logging correlation
request_id_context: ContextVar[str | None] = ContextVar("request_id", default=None)

# Context variable for propagating user_id for logging correlation
user_id_context: ContextVar[str | None] = ContextVar("user_id", default=None)