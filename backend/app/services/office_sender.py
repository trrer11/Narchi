"""§265 — Stammdaten Absender (XRechnung). Normalisation + trous honnêtes."""
from __future__ import annotations

import re

_IBAN = re.compile(r"^[A-Z]{2}[0-9]{2}[0-9A-Z]{11,30}$")
_VAT_DE = re.compile(r"^DE[0-9]{9}$")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def compact_iban(raw: str) -> str:
    return re.sub(r"\s+", "", (raw or "").upper())


def group_iban(raw: str) -> str:
    c = compact_iban(raw)
    return " ".join(c[i : i + 4] for i in range(0, len(c), 4)) if c else ""


def normalize_sender(data: dict) -> dict:
    def s(key: str, n: int) -> str:
        return (str(data.get(key) or "")).strip()[:n]

    iban = compact_iban(s("iban", 42))
    return {
        "name": s("name", 300),
        "street": s("street", 300),
        "zip": s("zip", 20),
        "city": s("city", 120),
        "country": (s("country", 2).upper() or "DE"),
        "vat_id": compact_iban(s("vat_id", 30)).replace(" ", ""),
        "iban": iban,
        "bic": s("bic", 11).upper(),
        "account_name": s("account_name", 300),
        "email": s("email", 300),
        "contact_name": s("contact_name", 300),
        "contact_phone": s("contact_phone", 100),
        "contact_email": s("contact_email", 300),
    }


def sender_violations(row: dict) -> list[str]:
    """Codes stables — pas un 'invalide' muet."""
    out: list[str] = []
    if not row.get("name"):
        out.append("NARCHI-ABS-01: Büroname fehlt")
    if not row.get("street") or not row.get("zip") or not row.get("city"):
        out.append("NARCHI-ABS-02: Anschrift unvollständig (Straße, PLZ, Ort)")
    vat = row.get("vat_id") or ""
    if not vat:
        out.append("NARCHI-ABS-03: USt-IdNr fehlt (BT-31)")
    elif vat.startswith("DE") and not _VAT_DE.match(vat):
        out.append("NARCHI-ABS-04: USt-IdNr DE muss DE + 9 Ziffern sein — nichts erfunden")
    iban = row.get("iban") or ""
    if not iban:
        out.append("NARCHI-ABS-05: IBAN fehlt (BG-16 / BR-DE-1)")
    elif not _IBAN.match(iban):
        out.append("NARCHI-ABS-06: IBAN unleserlich (Format ISO) — nicht still korrigiert")
    if not row.get("email") or not _EMAIL.match(row["email"]):
        out.append("NARCHI-ABS-07: Büro-E-Mail (BT-34) fehlt oder unleserlich")
    if not row.get("contact_name"):
        out.append("NARCHI-ABS-08: Kontaktperson fehlt (BG-6 / BR-DE-2)")
    return out


def sender_ready(row: dict) -> bool:
    return len(sender_violations(row)) == 0
