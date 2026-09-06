"""§260 — KoSIT Docker sidecar: pins, compose, client honnête."""
from __future__ import annotations

from pathlib import Path

from app.services.kosit_client import sidecar_ready, sidecar_url, validate_xml

ROOT = Path(__file__).resolve().parents[2]


def test_pins_match_shell_script():
    pins = (ROOT / "infra/kosit/pins.env").read_text(encoding="utf-8")
    sh = (ROOT / "scripts/valider-xrechnung-kosit.sh").read_text(encoding="utf-8")
    jar = "244978514ad48f67c7573acfffc8f4fd73d81feda6f276710033f9913579857e"
    cfg = "6a5a5911a421b25fbc423f62f93f894df7b236f5d73ca4f84bb222a945082704"
    assert jar in pins and jar in sh
    assert cfg in pins and cfg in sh
    assert "v1.6.2" in pins and "xrechnung-3.0.2" in pins


def test_compose_is_profile_not_default_and_not_agpl():
    overlay = (ROOT / "docker-compose.kosit.yml").read_text(encoding="utf-8")
    default = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    assert 'profiles: ["kosit"]' in overlay
    assert "infra/kosit" in overlay
    assert "KOSIT_SIDECAR_URL" in overlay
    assert "loki" not in overlay.lower()
    assert "narchi-kosit" in overlay
    assert "narchi-kosit" not in default
    assert "eclipse-temurin" not in default


def test_sidecar_absent_is_honest():
    assert sidecar_url() == ""
    assert sidecar_ready() is False
    out = validate_xml("<Invoice/>")
    assert out["ok"] is False
    assert out["verdict"] == "UNAVAILABLE"


def test_detect_syntax_and_pair_stops_if_sidecar_missing():
    from app.services.kosit_client import detect_syntax, validate_pair

    assert detect_syntax("<rsm:CrossIndustryInvoice>") == "cii"
    assert detect_syntax('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">') == "ubl"
    pair = validate_pair("<rsm:CrossIndustryInvoice/>", "<Invoice/>")
    assert pair["verdict"] == "UNAVAILABLE"
    assert pair["ubl"] is None
    assert pair["peppol_network"] is False


def test_validate_pair_both_legs_mocked(monkeypatch):
    from app.services import kosit_client as kc

    calls: list[str] = []

    def fake(xml: str) -> dict:
        calls.append(kc.detect_syntax(xml) if "Cross" in xml or "Invoice" in xml else xml[:20])
        ok = "GOOD" in xml
        return {"ok": ok, "verdict": "ACCEPTABLE" if ok else "REJECTED", "excerpt": "x" * 2000}

    monkeypatch.setattr(kc, "validate_xml", fake)
    monkeypatch.setattr(kc, "sidecar_url", lambda: "http://kosit:18080")
    out = kc.validate_pair("<CrossIndustryInvoice>GOOD</CrossIndustryInvoice>", "<Invoice>BAD</Invoice>")
    assert out["ok"] is False
    assert out["cii"]["ok"] is True
    assert out["ubl"]["ok"] is False
    assert out["ubl"]["syntax"] == "ubl"
    assert len(out["ubl"]["excerpt"] or "") <= 1500


def test_server_parse_kosit_stdout():
    import importlib.util

    path = ROOT / "infra/kosit/server.py"
    spec = importlib.util.spec_from_file_location("kosit_server", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    ok = mod.parse_kosit_stdout("Validation successful!\nRejected:  0\n", 0)
    assert ok["ok"] is True
    assert ok["verdict"] == "ACCEPTABLE"
    bad = mod.parse_kosit_stdout("Rejected:  2\n", 0)
    assert bad["ok"] is False
    assert bad["verdict"] == "REJECTED"
