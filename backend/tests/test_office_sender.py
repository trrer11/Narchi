"""§265 — Stammdaten Absender (sans FastAPI : le métier tient tout seul)."""
from __future__ import annotations

from app.services.office_sender import (
    compact_iban,
    group_iban,
    normalize_sender,
    sender_ready,
    sender_violations,
)


def test_iban_compact_and_group():
    assert compact_iban("de89 3704 0044 0532 0130 00") == "DE89370400440532013000"
    assert group_iban("DE89370400440532013000") == "DE89 3704 0044 0532 0130 00"


def test_empty_is_not_ready_and_named():
    v = sender_violations(normalize_sender({}))
    blob = "\n".join(v)
    assert "NARCHI-ABS-01" in blob
    assert "NARCHI-ABS-05" in blob
    assert "NARCHI-ABS-03" in blob
    assert sender_ready(normalize_sender({})) is False


def test_bad_iban_said_not_silently_fixed():
    row = normalize_sender({"iban": "DE00FAKE"})
    assert row["iban"] == "DE00FAKE"
    assert any(x.startswith("NARCHI-ABS-06") for x in sender_violations(row))


def test_complete_sender_ready():
    row = normalize_sender(
        {
            "name": "Atelier Nord",
            "street": "Lister Meile 1",
            "zip": "30161",
            "city": "Hannover",
            "vat_id": "DE123456789",
            "iban": "DE89 3704 0044 0532 0130 00",
            "email": "buero@atelier.de",
            "contact_name": "A. Muster",
        }
    )
    assert row["iban"] == "DE89370400440532013000"
    assert sender_violations(row) == []
    assert sender_ready(row) is True


def test_de_ust_wrong_length():
    row = normalize_sender(
        {
            "name": "X",
            "street": "A 1",
            "zip": "30159",
            "city": "Hannover",
            "vat_id": "DE12",
            "iban": "DE89370400440532013000",
            "email": "a@b.de",
            "contact_name": "A",
        }
    )
    assert any("ABS-04" in x for x in sender_violations(row))
