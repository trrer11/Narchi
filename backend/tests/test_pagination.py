from datetime import datetime, timezone

import pytest

from app.core.pagination import decode_cursor, encode_cursor


def test_cursor_roundtrip_and_invalid_input():
    created_at = datetime(2026, 7, 15, 12, 0, tzinfo=timezone.utc)
    cursor = encode_cursor(created_at, "entity-42")
    decoded_date, decoded_id = decode_cursor(cursor)
    assert decoded_date == created_at
    assert decoded_id == "entity-42"

    with pytest.raises(ValueError, match="Curseur"):
        decode_cursor("%%%invalid%%")
