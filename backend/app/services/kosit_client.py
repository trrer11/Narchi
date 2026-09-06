"""§260 — Client du sidecar KoSIT (JAR officiel). Sidecar absent = dit."""
from __future__ import annotations

import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

MAX_XML = 2 * 1024 * 1024


def sidecar_url() -> str:
    from app.config import settings

    return (getattr(settings, "KOSIT_SIDECAR_URL", "") or "").strip().rstrip("/")


def sidecar_ready() -> bool:
    base = sidecar_url()
    if not base:
        return False
    try:
        with urlopen(base + "/health", timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return bool(data.get("ready"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, OSError):
        return False


def validate_xml(xml: str) -> dict:
    """Poste le XML CII au sidecar. N'invente pas un ACCEPTABLE local."""
    base = sidecar_url()
    if not base:
        return {
            "ok": False,
            "verdict": "UNAVAILABLE",
            "detail": "KoSIT-Sidecar nicht konfiguriert (Profil kosit, 10_START_KOSIT.bat).",
        }
    raw = xml.encode("utf-8")
    if len(raw) > MAX_XML:
        return {"ok": False, "verdict": "TOO_LARGE", "detail": "XML groesser als 2 MiB"}
    req = Request(
        base + "/validate",
        data=raw,
        headers={"Content-Type": "application/xml; charset=utf-8"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=95) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            return {
                "ok": False,
                "verdict": "ERROR",
                "detail": f"KoSIT HTTP {exc.code}",
                "excerpt": body[-2000:],
            }
    except URLError:
        return {
            "ok": False,
            "verdict": "UNAVAILABLE",
            "detail": "KoSIT-Sidecar nicht erreichbar. Profil kosit starten, dann Backend neu.",
        }
    if not isinstance(payload, dict):
        return {"ok": False, "verdict": "ERROR", "detail": "KoSIT-Antwort kein JSON"}
    return payload


def detect_syntax(xml: str) -> str:
    head = xml[:4000]
    if "CrossIndustryInvoice" in head:
        return "cii"
    if "Invoice-2" in head or "ubl:Invoice" in head:
        return "ubl"
    return "unknown"


def slim_kosit(result: dict) -> dict:
    excerpt = result.get("excerpt")
    if isinstance(excerpt, str) and len(excerpt) > 1500:
        excerpt = excerpt[-1500:]
    return {
        "ok": bool(result.get("ok")),
        "verdict": str(result.get("verdict") or "ERROR"),
        "rejected": result.get("rejected"),
        "detail": result.get("detail"),
        "excerpt": excerpt,
        "syntax": result.get("syntax"),
    }


def validate_pair(cii_xml: str, ubl_xml: str) -> dict:
    """Deux appels JAR. Si le sidecar manque, UBL n'est pas inventé ACCEPTABLE."""
    cii = validate_xml(cii_xml)
    cii["syntax"] = "cii"
    if cii.get("verdict") == "UNAVAILABLE":
        return {
            "ok": False,
            "verdict": "UNAVAILABLE",
            "detail": cii.get("detail"),
            "cii": slim_kosit(cii),
            "ubl": None,
            "peppol_network": False,
        }
    ubl = validate_xml(ubl_xml)
    ubl["syntax"] = "ubl"
    ok = bool(cii.get("ok") and ubl.get("ok"))
    return {
        "ok": ok,
        "verdict": "ACCEPTABLE" if ok else "REJECTED",
        "detail": None if ok else "CII oder UBL vom offiziellen KoSIT abgelehnt",
        "cii": slim_kosit(cii),
        "ubl": slim_kosit(ubl),
        "peppol_network": False,
    }
