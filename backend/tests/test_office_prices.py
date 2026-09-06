"""Tests §50 de la bibliothèque de prix du bureau (Paket Crédibilité B).

Couvre : indices Destatis épinglés (officiels), parseurs CSV/GAEB X31
(accepté OU rejeté motivé, jamais fabriqué), upsert idempotent, priorité
prix-du-bureau dans l estimation éclair, cloisonnement tenant, et le
round-trip GAEB X31 (notre export relu par notre import).
"""

import importlib.util
import os
import sys
import types
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

from app.core.estimation.destatis_index import (  # noqa: E402
    INDEX_SOURCE,
    index_for_year,
    year_factor_for,
    yearly_index,
)
from app.core.estimation.gaeb_export import build_gaeb_x31  # noqa: E402
from app.core.estimation.office_price_import import (  # noqa: E402
    detect_kostengruppe,
    parse_csv_prices,
    parse_gaeb_x31_prices,
    parse_office_prices,
    sniff_kind,
)
from app.core.estimation.price_database import PriceRegion  # noqa: E402
from app.core.estimation.quick_estimate import QuickElement, estimate_quick  # noqa: E402
from app.database import Base  # noqa: E402
from app.models.office_price import OfficePrice  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.office_price_service import (  # noqa: E402
    ResolvedOfficePrice,
    commit_import,
    current_index_year,
    index_note,
    resolve_price_for_kg,
    tenant_price_map,
)

BACKEND = Path(__file__).resolve().parents[1]


def _load_routes(module_name: str):
    """Charge un routeur isolé (évite app/api/__init__ chaîne lourde) avec
    dos_guard bouchonné (redis/psutil non installables dans le sandbox)."""
    stub = types.ModuleType("app.middlewares.dos_guard")

    async def _no_dos_guard():
        return None

    stub.verify_dos_protection = _no_dos_guard  # type: ignore[attr-defined]
    sys.modules.setdefault("app.middlewares.dos_guard", stub)

    path = BACKEND / "app" / "api" / module_name
    spec = importlib.util.spec_from_file_location(f"{module_name}_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


TABLES = [User.__table__, OfficePrice.__table__]


def _mk_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine, tables=TABLES)
    return sessionmaker(bind=engine)()


def _mk_user(db, *, user_id: str, tenant: str) -> User:
    user = User(
        id=user_id, email=f"{user_id}@büro.de", hashed_password="x",
        name=user_id, role="owner", tenant_id=tenant,
    )
    db.add(user)
    db.commit()
    return user


# --------------------------------------------------------------------------
# Indices Destatis — valeurs officielles épinglées (miroir du test frontend)
# --------------------------------------------------------------------------

def test_index_officiel_epingle():
    assert index_for_year(2024) == Decimal("129.75")
    assert index_for_year(2025) == Decimal("133.88")
    assert index_for_year(2026) == Decimal("140.30")  # dernier point publié Q2/2026
    assert index_for_year(2023) == Decimal("115.63")
    assert index_for_year(2021) == Decimal("100.00")
    assert index_for_year(2020) == Decimal("88.73")   # rétrocédé ÷1,127
    assert index_for_year(2019) is None
    assert current_index_year() == 2026
    assert "61261-0002" in INDEX_SOURCE and "Basis 2021=100" in INDEX_SOURCE


def test_year_factor_officiel():
    # 2024 → 2026 = 140,3 / 129,75 = +8,13 % (l'ancien facteur interne
    # affirmait +6,3 % — l'audit §49 l'a corrigé, ce test le verrouille).
    factor = year_factor_for(2024, 2026)
    assert abs(float(factor) - 1.0813) < 0.001
    assert year_factor_for(2024, 2024) == Decimal("1")
    assert year_factor_for(2010, 2026) == Decimal("1")  # non supporté → neutre
    assert year_factor_for(2020, 2026) <= Decimal("1.4")  # plafond


def test_yearly_index_table():
    table = yearly_index()
    assert sorted(table.keys()) == [2020, 2021, 2022, 2023, 2024, 2025, 2026]
    assert table[2026] == Decimal("140.30")


# --------------------------------------------------------------------------
# Parseur CSV
# --------------------------------------------------------------------------

CSV_OK = (
    "OZ;Kurztext;Einheit;EP;Jahr\n"
    "02.003.1002;Außenwand Mauerwerk 36,5 cm;m²;189,50;2025\n"
    "03.001.0001;Bodenbelag Fliesen;m²;1.234,56;2024\n"
).encode("utf-8")


def test_csv_parse_allemand():
    result = parse_csv_prices(CSV_OK, 2024)
    assert result.kind == "csv"
    assert result.detected_headers["oz"] == "OZ"
    assert len(result.accepted) == 2
    first = result.accepted[0]
    assert first.oz == "02.003.1002"
    assert first.einheitspreis_netto == Decimal("189.50")
    assert first.preisstand_jahr == 2025          # la colonne Jahr prime
    assert first.kostengruppe == "kg320_aussenwaende_rohbau"
    second = result.accepted[1]
    assert second.einheitspreis_netto == Decimal("1234.56")  # format 1.234,56
    assert second.preisstand_jahr == 2024
    assert not result.rejected


def test_csv_rejets_motives_jamais_fabriques():
    bad = (
        "oz;kurztext;einheit;ep\n"
        "01.1;Wand;m²;abc\n"                 # prix illisible
        ";Wand ohne OZ;m²;100\n"             # OZ manquante
        "01.3;;m²;100\n"                     # Kurztext vide
        "01.4;Wand;;100\n"                   # Einheit manquante
        "01.5;Wand;m²;-50\n"                 # prix négatif
        "01.6;Wand;m²;2000000\n"             # prix absurde > 1 M€
        "01.7;Wand;m²;100\n"                 # seule ligne valide
    ).encode("utf-8")
    result = parse_csv_prices(bad, 2024)
    assert len(result.accepted) == 1
    assert len(result.rejected) == 6
    assert all(r.reason for r in result.rejected)
    assert {r.row for r in result.rejected} == {1, 2, 3, 4, 5, 6}


def test_csv_colonnes_obligatoires_manquantes():
    result = parse_csv_prices("a;b;c\n1;2;3\n".encode(), 2024)
    assert not result.accepted
    assert any("Pflichtspalte" in r.reason for r in result.rejected)


def test_csv_latin1_et_virgule_decimal():
    data = "oz;kurztext;einheit;ep\n1;Außenwände;m²;189,50\n".encode("latin-1")
    result = parse_csv_prices(data, 2024)
    assert len(result.accepted) == 1
    assert result.accepted[0].kurztext.startswith("Außenw")


def test_detection_kg_ambigue_reste_none():
    # « Wand » seul matche plusieurs familles (innen/außen) → pas d'assignation.
    kg, conf = detect_kostengruppe("Wand")
    assert kg is None and conf is None
    kg2, _ = detect_kostengruppe("Fenster 3-fach Verglasung")
    assert kg2 == "kg361_fenster_aussentueren"


# --------------------------------------------------------------------------
# Parseur GAEB X31 (+ round-trip avec notre propre export)
# --------------------------------------------------------------------------

def test_x31_roundtrip_export_puis_import():
    lines = [
        {"kostengruppe": "kg320_aussenwaende_rohbau", "titel": "Außenwand Mauerwerk",
         "menge": 12.5, "einheit": "m²", "einheitspreis_netto": 189.5,
         "anzahl_elemente": 3, "beispiele": ["AW"]},
        {"kostengruppe": "kg364_belaege_boden", "titel": "Bodenbelag Fliesen",
         "menge": 40.0, "einheit": "m²", "einheitspreis_netto": 95.0,
         "anzahl_elemente": 2, "beispiele": []},
    ]
    xml = build_gaeb_x31(project_name="Roundtrip", lines=lines, region="de_ni")
    result = parse_gaeb_x31_prices(xml.encode("utf-8"), 2024)
    assert result.kind == "x31"
    assert len(result.accepted) == 2
    prices = {p.kurztext: p for p in result.accepted}
    assert prices["Außenwand Mauerwerk"].einheitspreis_netto == Decimal("189.50")
    assert prices["Bodenbelag Fliesen"].einheitspreis_netto == Decimal("95.00")
    assert all(p.preisstand_jahr == 2024 for p in result.accepted)


def test_x31_rejet_xml_invalide():
    result = parse_gaeb_x31_prices(b"<pasxml", 2024)
    assert not result.accepted and result.rejected


def test_x31_sans_up_est_un_rejet_motive():
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?><GAEB><BoQ><Itemlist>'
        '<Item RNoPart="01.001"><Qty>5</Qty><QU>m2</QU>'
        "<ShortText><span>Hinweisposition ohne Preis</span></ShortText>"
        "</Item></Itemlist></BoQ></GAEB>"
    ).encode()
    result = parse_gaeb_x31_prices(xml, 2024)
    assert not result.accepted
    assert len(result.rejected) == 1
    assert "UP" in result.rejected[0].reason


def test_sniff_kind():
    assert sniff_kind("prix.x31", b"<GAEB/>") == "x31"
    assert sniff_kind("prix.csv", b"a;b") == "csv"
    assert sniff_kind("blob.bin", b"<GAEB/>") == "x31"  # contenu prime
    assert parse_office_prices("x.csv", CSV_OK, 2024).kind == "csv"


# --------------------------------------------------------------------------
# Service : upsert idempotent, priorité, indexation, cloisonnement
# --------------------------------------------------------------------------

def _importcsv(db, user, tenant="t1"):
    result = parse_csv_prices(CSV_OK, 2024)
    return commit_import(
        db, tenant_id=tenant, user_id=user.id, source_file="bibliothek.csv", result=result
    )


def test_commit_upsert_idempotent():
    db = _mk_session()
    user = _mk_user(db, user_id="u1", tenant="t1")
    stats1 = _importcsv(db, user)
    assert (stats1.inserted, stats1.updated, stats1.total_active) == (2, 0, 2)
    # Réimport du MÊME fichier : 0 insertion, 2 mises à jour, total inchangé.
    stats2 = _importcsv(db, user)
    assert (stats2.inserted, stats2.updated, stats2.total_active) == (0, 2, 2)


def test_tenant_price_map_indexe_vers_2026():
    db = _mk_session()
    user = _mk_user(db, user_id="u1", tenant="t1")
    _importcsv(db, user)
    price_map = tenant_price_map(db, tenant_id="t1")
    assert set(price_map) == {"kg320_aussenwaende_rohbau", "kg364_belaege_boden"}
    mauer = price_map["kg320_aussenwaende_rohbau"]
    assert mauer.preisstand_jahr == 2025
    # 189,50 € (2025) × (140,3 / 133,88) ≈ 198,58 € — PREUVI par l'index officiel.
    attendu = (Decimal("189.50") * Decimal("140.30") / Decimal("133.88")).quantize(Decimal("0.01"))
    assert mauer.einheitspreis_netto_indiziert == attendu
    assert (note := index_note(2025, mauer.index_faktor))
    assert "2025→2026" in note


def test_millesime_le_plus_recent_prime():
    """ÉVOLUÉ en §99 — la règle §50 « millésime le plus récent, OZ
    croissante » est REMPLACÉE : à 2 positions même Einheit, c'est la
    MÉDIANE des prix indexés qui prime (un Ausreißer récent ne devient
    plus jamais seul LE prix du bureau). Les attendus sont recalculés au
    centime depuis les indices officiels épinglés — pas « adaptés » au
    nouveau code."""
    db = _mk_session()
    user = _mk_user(db, user_id="u1", tenant="t1")
    ancien = parse_csv_prices(
        "oz;kurztext;einheit;ep;jahr\n01;Mauerwerk;m²;100;2022\n".encode(), 2024)
    recent = parse_csv_prices(
        "oz;kurztext;einheit;ep;jahr\n02;Mauerwerk;m²;120;2025\n".encode(), 2024)
    commit_import(db, tenant_id="t1", user_id=user.id, source_file="a", result=ancien)
    commit_import(db, tenant_id="t1", user_id=user.id, source_file="b", result=recent)
    resolved = resolve_price_for_kg(db, tenant_id="t1", kostengruppe="kg320_aussenwaende_rohbau")
    assert resolved is not None and resolved.auswahl == "median"
    # 2022 : 100 × 140,30/111,53 = 125,80 € · 2025 : 120 × 140,30/133,88 = 125,75 €
    HU = ROUND_HALF_UP  # arrondi COMMERCIAL comme _q2 du moteur — jamais le contexte par défaut
    moy_2022 = (Decimal("108.2") + Decimal("112.1") + Decimal("112.7") + Decimal("113.1")) / 4
    assert moy_2022 == Decimal("111.525") and moy_2022.quantize(Decimal("0.01"), rounding=HU) == Decimal("111.53")
    ep_a = (Decimal("100") * Decimal("140.30") / Decimal("111.53")).quantize(Decimal("0.01"), rounding=HU)
    ep_b = (Decimal("120") * Decimal("140.30") / Decimal("133.88")).quantize(Decimal("0.01"), rounding=HU)
    assert (ep_a, ep_b) == (Decimal("125.80"), Decimal("125.75"))
    assert resolved.einheitspreis_netto_indiziert == Decimal("125.78")  # (12580+12575)/2 Half-Up
    assert resolved.n_quellen == 2 and resolved.oz_quelle == ""
    assert resolved.quellen_jahr_von == 2022 and resolved.quellen_jahr_bis == 2025


def test_cloisonnement_tenant():
    db = _mk_session()
    user = _mk_user(db, user_id="u1", tenant="t1")
    autre = _mk_user(db, user_id="u2", tenant="t2")
    _importcsv(db, user, tenant="t1")
    assert tenant_price_map(db, tenant_id="t1")
    # Le voisin ne voit RIEN des prix de t1.
    assert tenant_price_map(db, tenant_id=autre.tenant_id) == {}
    assert resolve_price_for_kg(db, tenant_id="t2", kostengruppe="kg320_aussenwaende_rohbau") is None


# --------------------------------------------------------------------------
# Moteur d'estimation : priorité prix du bureau + provenance par ligne
# --------------------------------------------------------------------------

def test_estimate_quick_priorite_bureau_et_provenance():
    elements = [
        QuickElement(ifc_type="IfcWall", name="AW", material_hint="Mauerwerk",
                     net_area=Decimal("10"), count=1, confidence=0.9),
    ]
    sans_bureau = estimate_quick(elements, PriceRegion.NIEDERSACHSEN)
    (ligne_ref,) = sans_bureau["lines"]
    assert ligne_ref["preis_quelle"] == "richtwert"
    assert sans_bureau["office_quote"]["eigenpreis_quote"] == 0.0

    prix_bureau = ResolvedOfficePrice(
        einheitspreis_netto_indiziert=Decimal("250.00"),
        preisstand_jahr=2025, index_faktor=Decimal("1.0480"),
        oz_quelle="07.01", kurztext_quelle="Außenwand MW nach Büro",
    )
    avec_bureau = estimate_quick(
        elements, PriceRegion.NIEDERSACHSEN,
        tenant_price_resolver=lambda kg: prix_bureau,
    )
    (ligne_bureau,) = avec_bureau["lines"]
    assert ligne_bureau["preis_quelle"] == "büro"
    assert ligne_bureau["einheitspreis_netto"] == pytest.approx(250.0)
    assert ligne_bureau["gesamt_netto"] == pytest.approx(2500.0)
    detail = ligne_bureau["preis_quelle_detail"]
    assert detail["oz"] == "07.01" and detail["preisstand_jahr"] == 2025
    assert avec_bureau["office_quote"]["eigenpreis_quote"] == 1.0
    assert avec_bureau["office_quote"]["kgs_mit_bueropreis"] == 1
    # L'avertissement « Richtwerte » cède la place au message Büropreise.
    assert any("Büropreisen" in w for w in avec_bureau["warnings"])


def test_estimate_quick_resolver_partiel_fallback_honnete():
    """Prix du bureau sur une SEULE KG → l'autre retombe honnêtement au Richtwert."""
    elements = [
        QuickElement(ifc_type="IfcWall", name="AW", material_hint="Mauerwerk",
                     net_area=Decimal("10"), count=1),
        QuickElement(ifc_type="IfcSlab", name="Boden", material_hint="Fliesen",
                     net_area=Decimal("20"), count=1),
    ]
    bureau = ResolvedOfficePrice(
        einheitspreis_netto_indiziert=Decimal("300.00"),
        preisstand_jahr=2025, index_faktor=Decimal("1.0"),
        oz_quelle="09.9", kurztext_quelle="x",
    )
    only_wall = {"kg320_aussenwaende_rohbau": bureau}
    result = estimate_quick(
        elements, PriceRegion.NIEDERSACHSEN,
        tenant_price_resolver=only_wall.get,
    )
    sources = {line["kostengruppe"]: line["preis_quelle"] for line in result["lines"]}
    assert sources["kg320_aussenwaende_rohbau"] == "büro"
    assert "richtwert" in sources.values()
    assert 0.0 < result["office_quote"]["eigenpreis_quote"] < 1.0


# --------------------------------------------------------------------------
# Endpoints API : preview (rien d'écrit), import (écrit), purge
# --------------------------------------------------------------------------

@pytest.fixture()
def api_client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.core.security import get_current_user
    from app.database import get_db

    routes = _load_routes("office_price_routes.py")
    app = FastAPI()
    app.include_router(routes.router)

    db = _mk_session()
    user = _mk_user(db, user_id="chef", tenant="büro-a")
    autre = _mk_user(db, user_id="fremd", tenant="büro-b")

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    client.state = {"user": user, "autre": autre, "db": db, "get_current_user": get_current_user, "app": app}
    return client


def test_preview_necrit_rien_puis_import_ecrit(api_client):
    files = {"file": ("bib.csv", CSV_OK, "text/csv")}
    preview = api_client.post("/api/v5/office-prices/preview", files=files,
                              data={"preisstand_jahr": "2024"})
    assert preview.status_code == 200
    body = preview.json()
    assert body["accepted_count"] == 2 and body["rejected_count"] == 0
    assert body["kind"] == "csv"
    # RIEN n'a été persisté à l'étape preview :
    assert api_client.get("/api/v5/office-prices/stats").json()["total"] == 0

    commit = api_client.post("/api/v5/office-prices/import", files=files,
                             data={"preisstand_jahr": "2024"})
    assert commit.status_code == 200
    rapport = commit.json()
    assert (rapport["inserted"], rapport["updated"]) == (2, 0)
    assert api_client.get("/api/v5/office-prices/stats").json()["total"] == 2

    # Idempotence end-to-end : réimport identique → 0 insertion.
    commit2 = api_client.post("/api/v5/office-prices/import", files=files,
                              data={"preisstand_jahr": "2024"})
    assert commit2.json()["inserted"] == 0 and commit2.json()["updated"] == 2


def test_search_isole_par_tenant(api_client):
    files = {"file": ("bib.csv", CSV_OK, "text/csv")}
    api_client.post("/api/v5/office-prices/import", files=files,
                    data={"preisstand_jahr": "2024"})

    found = api_client.get("/api/v5/office-prices/search", params={"q": "Mauerwerk"})
    assert found.status_code == 200
    assert found.json()["total"] == 1
    item = found.json()["items"][0]
    assert item["einheitspreis_netto"] == pytest.approx(189.5)
    assert item["index_note"] and "2025→2026" in item["index_note"]

    # Changement d'utilisateur → autre tenant → bibliothèque vide.
    state = api_client.state
    state["app"].dependency_overrides[state["get_current_user"]] = lambda: state["autre"]
    empty = api_client.get("/api/v5/office-prices/search")
    assert empty.json()["total"] == 0


def test_purge_uniquement_son_tenant(api_client):
    files = {"file": ("bib.csv", CSV_OK, "text/csv")}
    api_client.post("/api/v5/office-prices/import", files=files,
                    data={"preisstand_jahr": "2024"})
    purge = api_client.delete("/api/v5/office-prices/purge")
    assert purge.status_code == 200 and purge.json()["deleted"] == 2
    assert api_client.get("/api/v5/office-prices/stats").json()["total"] == 0


def test_upload_vide_refuse(api_client):
    files = {"file": ("vide.csv", b"", "text/csv")}
    res = api_client.post("/api/v5/office-prices/import", files=files,
                          data={"preisstand_jahr": "2024"})
    assert res.status_code == 422


# --------------------------------------------------------------------------
# §73 V2.6 — Historique des imports + alerte de fraîcheur (> 12 mois)
# --------------------------------------------------------------------------

def test_verlauf_vide_honnete(api_client):
    body = api_client.get("/api/v5/office-prices/verlauf").json()
    assert body["imports"] == []
    assert body["veraltet"] is None
    assert body["alter_tage"] is None
    assert body["schwellwert_monate"] == 12


def test_verlauf_frais_apres_import(api_client):
    files = {"file": ("bib.csv", CSV_OK, "text/csv")}
    api_client.post("/api/v5/office-prices/import", files=files,
                    data={"preisstand_jahr": "2024"})
    body = api_client.get("/api/v5/office-prices/verlauf").json()
    assert body["veraltet"] is False
    assert body["alter_monate"] == 0
    assert len(body["imports"]) == 1
    batch = body["imports"][0]
    assert batch["source_file"] == "bib.csv"
    assert batch["source_kind"] == "csv"
    assert batch["positionen"] == 2
    assert (batch["preisstand_von"], batch["preisstand_bis"]) == (2024, 2025)
    assert batch["erst_import"] and batch["letzte_aktualisierung"]


def test_verlauf_veraltet_seuil_honnête(api_client):
    from datetime import datetime as _dt, timedelta as _td, timezone as _tz
    from sqlalchemy import select as _sel
    files = {"file": ("bib.csv", CSV_OK, "text/csv")}
    api_client.post("/api/v5/office-prices/import", files=files,
                    data={"preisstand_jahr": "2024"})
    db = api_client.state["db"]

    # 400 jours sans mise à jour → alerte VRAIE
    vieux = _dt.now(_tz.utc).replace(tzinfo=None) - _td(days=400)
    for row in db.execute(_sel(OfficePrice)).scalars().all():
        row.updated_at = vieux
    db.commit()
    body = api_client.get("/api/v5/office-prices/verlauf").json()
    assert body["veraltet"] is True
    assert body["alter_tage"] >= 400
    assert body["alter_monate"] >= 13

    # 300 jours → PAS d'alerte (le seuil n'est pas théâtral)
    frais = _dt.now(_tz.utc).replace(tzinfo=None) - _td(days=300)
    for row in db.execute(_sel(OfficePrice)).scalars().all():
        row.updated_at = frais
    db.commit()
    body2 = api_client.get("/api/v5/office-prices/verlauf").json()
    assert body2["veraltet"] is False


def test_verlauf_cloisonne_par_tenant(api_client):
    files = {"file": ("bib.csv", CSV_OK, "text/csv")}
    api_client.post("/api/v5/office-prices/import", files=files,
                    data={"preisstand_jahr": "2024"})
    # Le tenant « fremd » ne doit voir AUCUN historique du tenant « chef ».
    app = api_client.state["app"]
    app.dependency_overrides[api_client.state["get_current_user"]] =         lambda: api_client.state["autre"]
    body = api_client.get("/api/v5/office-prices/verlauf").json()
    assert body["imports"] == []
    assert body["veraltet"] is None

# --------------------------------------------------------------------------
# §76 — Suppression CHIRURGICALE d'un lot d'import. Née d'un retour réel :
# un X31 d'essai validé à l'étape 3 ne doit plus exiger « tout effacer ».
# --------------------------------------------------------------------------

CSV_B = (
    "OZ;Kurztext;Einheit;EP;Jahr\n"
    "05.001.0001;Innenputz Kalk-Zement 15 mm;m²;24,80;2024\n"
    "06.002.0002;Türblatt Innentür CPL;Stk;189,00;2024\n"
).encode("utf-8")


def _import_file(api_client, name: str, payload: bytes, jahr: str = "2024"):
    res = api_client.post("/api/v5/office-prices/import",
                          files={"file": (name, payload, "application/octet-stream")},
                          data={"preisstand_jahr": jahr})
    assert res.status_code == 200, res.text
    return res


def test_delete_batch_nur_dieses_los(api_client):
    """Deux lots distincts : seul le lot demandé disparaît, l'autre reste
    INTÉGRALEMENT — et le compte rendu est exact."""
    _import_file(api_client, "essai-test.csv", CSV_OK)          # 2 lignes
    _import_file(api_client, "echte-buero-preise.csv", CSV_B)   # 2 lignes, OZ différents
    assert api_client.get("/api/v5/office-prices/stats").json()["total"] == 4

    res = api_client.delete("/api/v5/office-prices/verlauf/essai-test.csv")
    assert res.status_code == 200
    assert res.json() == {"deleted": 2, "source_file": "essai-test.csv"}

    assert api_client.get("/api/v5/office-prices/stats").json()["total"] == 2
    verlauf = api_client.get("/api/v5/office-prices/verlauf").json()
    assert [i["source_file"] for i in verlauf["imports"]] == ["echte-buero-preise.csv"]
    assert verlauf["imports"][0]["positionen"] == 2
    assert verlauf["veraltet"] is False  # lot restant frais — effet de bord honnête


def test_delete_batch_lot_inconnu_404_honnete(api_client):
    """Supprimer un lot absent = 404 explicite, jamais un « succès » à 0."""
    _import_file(api_client, "echte-buero-preise.csv", CSV_B)
    res = api_client.delete("/api/v5/office-prices/verlauf/jamais-importe.csv")
    assert res.status_code == 404
    assert "jamais-importe.csv" in res.json()["detail"]
    # bibliothèque NON touchée :
    assert api_client.get("/api/v5/office-prices/stats").json()["total"] == 2


def test_delete_batch_cloisonne_par_tenant(api_client):
    """Un tenant ne peut pas supprimer le lot d'un autre tenant, même avec
    un nom de fichier identique."""
    _import_file(api_client, "essai-test.csv", CSV_OK)
    state = api_client.state
    state["app"].dependency_overrides[state["get_current_user"]] = \
        lambda: state["autre"]
    res = api_client.delete("/api/v5/office-prices/verlauf/essai-test.csv")
    assert res.status_code == 404
    state["app"].dependency_overrides[state["get_current_user"]] = \
        lambda: state["user"]
    assert api_client.get("/api/v5/office-prices/stats").json()["total"] == 2


def test_delete_batch_nom_avec_espaces_url_encodes(api_client):
    """Cas réel : « mon essai preise.csv » contient des espaces → le client
    URL-encode (%20), le serveur décode et retrouve le lot (sinon le bouton
    serait muet précisément sur les noms humains)."""
    _import_file(api_client, "mon essai preise.csv", CSV_OK)
    res = api_client.delete("/api/v5/office-prices/verlauf/mon essai preise.csv")
    assert res.status_code == 200
    assert res.json() == {"deleted": 2, "source_file": "mon essai preise.csv"}
    verlauf = api_client.get("/api/v5/office-prices/verlauf").json()
    assert verlauf["imports"] == []
    assert verlauf["veraltet"] is None


def test_delete_batch_x31_reel_comme_dans_l_incident(api_client):
    """Le chemin EXACT de l'incident réel : notre propre export .x31 (contenu
    GAEB DA XML, extension .x31) est importé via l'assistant, puis supprimé
    chirurgicalement — bibliothèque à nouveau vide."""
    from datetime import datetime as _dt

    from app.core.estimation.gaeb_export import build_gaeb_x31_kostengruppen

    xml = build_gaeb_x31_kostengruppen(
        project_name="Essai X31", din276="2018",
        created=_dt(2026, 8, 9, 13, 17),
        kostengruppen=[{
            "code": "300", "label": "Bauwerk",
            "lines": [{"code": "320", "label": "Außenwände", "amount": 341373.4}],
        }],
    )
    _import_file(api_client, "essai-lv.x31", xml.encode("utf-8"), jahr="2026")
    verlauf = api_client.get("/api/v5/office-prices/verlauf").json()
    assert len(verlauf["imports"]) == 1
    assert verlauf["imports"][0]["source_kind"] == "x31"

    res = api_client.delete("/api/v5/office-prices/verlauf/essai-lv.x31")
    assert res.status_code == 200
    assert res.json() == {"deleted": 1, "source_file": "essai-lv.x31"}
    assert api_client.get("/api/v5/office-prices/stats").json()["total"] == 0
