"""Curseurs opaques stables pour pagination keyset PostgreSQL."""

from __future__ import annotations

import base64
import binascii
import json
from datetime import datetime


def encode_cursor(created_at: datetime, entity_id: str) -> str:
    payload = json.dumps(
        {"created_at": created_at.isoformat(), "id": entity_id},
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        padding = "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(cursor + padding))
        created_at = datetime.fromisoformat(payload["created_at"])
        entity_id = str(payload["id"])
        if not entity_id:
            raise ValueError("empty id")
        return created_at, entity_id
    except (ValueError, KeyError, TypeError, json.JSONDecodeError, binascii.Error) as error:
        raise ValueError("Curseur de pagination invalide") from error
