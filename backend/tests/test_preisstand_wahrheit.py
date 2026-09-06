"""Tests §97 — « Preisstand-Wahrheit » : NARCHI distingue 2018 / 2022 / 2026.

Réponse à la question client du 10.08.2026. Chaque prix porte SON
millésime (colonne CSV / année de l'assistant / année de réception de
l'offre) ; l'écran le montre, l'indexation Destatis le projette. Cette
tâche ajoute la garantie structurelle : **un millésime plus ancien ne
remplace JAMAIS un plus récent à OZ égale** (refus compté + OZ nommées),
et l'honnêteté pré-2020 : la série officielle chargée commence en 2020
→ la note le dit (« keine Indexierung möglich »…), jamais un « ×1 » muet.

Épinglé aussi (véridique, pas cosmétique) : le resolveur /quick utilise
un prix d'avant 2020 NON indexé (facteur 1) — comportement existant
rendu explicite par la note ; le Spiegel §96 sert désormais min/max des
Jahrgänge (valeurs brutes par année — différentes années = dit).
"""

import importlib.util
import os
import sys
import types
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

import app.api.collab_routes as collab_mod  # noqa: E402
from app.core.estimation.destatis_index import index_for_year  # noqa: E402
from app.core.estimation.office_price_import import (  # noqa: E402
    ImportResult,
    ImportedPrice,
)
from app.core.security import get_current_user  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.models.gaeb_offer import GaebOffer  # noqa: E402
from app.models.office_price import OfficePrice  # noqa: E402
from app.models.price_observation import PriceObservation  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.gaeb_lv_export import build_lv_gaeb_x31  # noqa: E402
from app.services.office_price_service import (  # noqa: E402
    commit_import,
    current_index_year,
    index_note,
    resolve_price_for_kg,
)
from app.services.price_observations import spiegel_for_tenant  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from decimal import Decimal  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]
ROOM = "notiz-buero"


def _load_office_routes():
    stub = types.ModuleType("app.middlewares.dos_guard")

    async def _no_dos_guard():
        return None

    stub.verify_dos_protection = _no_dos_guard  # type: ignore[attr-defined]
    sys.modules.setdefault("app.middlewares.dos_guard", stub)
    path = BACKEND / "app" / "api" / "office_price_routes.py"
    spec = importlib.util.spec_from_file_location(
        "office_price_routes_wahrheit", path,
    )
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _stack():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(
        bind=engine,
        tables=[User.__table__, OfficePrice.__table__, GaebOffer.__table__,
                PriceObservation.__table__],
    )
    session = sessionmaker(bind=engine)()
    alice = User(id="u-alice", email="alice@buero.de", hashed_password="x",
                 name="Alice A", role="owner", tenant_id="t1", is_active=True)
    session.add(alice)
    session.commit()
    office_mod = _load_office_routes()
    app = FastAPI()
    app.include_router(collab_mod.router)
    app.include_router(office_mod.router)
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[get_current_user] = lambda: alice
    with TestClient(app) as client:
        return client, session


def _import_result(oz: str, jahr: int, ep: str) -> ImportResult:
    return ImportResult(
        kind="csv",
        accepted=[ImportedPrice(
            oz=oz, kurztext=f"Beton {jahr}", einheit="m³",
            einheitspreis_netto=Decimal(ep), preisstand_jahr=jahr,
            kostengruppe="kg320_aussenwaende_rohbau", kg_confiance=0.9,
        )],
    )


# ----------------------- règle du millésime (commit_import) -------------------


def test_ancien_millesime_ne_remplace_jamais_le_recent():
    _, session = _stack()
    first = commit_import(db=session, tenant_id="t1", user_id="u-alice",
                          source_file="preise_2026.csv", result=_import_result("02.003", 2026, "200"))
    assert first.inserted == 1 and first.skipped_veraltet is None
    second = commit_import(db=session, tenant_id="t1", user_id="u-alice",
                           source_file="preise_2018.csv", result=_import_result("02.003", 2018, "120"))
    assert second.inserted == 0 and second.updated == 0
    assert second.skipped_veraltet == ["02.003"], "refus compté, OZ nommée"
    row = session.query(OfficePrice).filter_by(tenant_id="t1").one()
    assert row.preisstand_jahr == 2026, "le plus récent RESTE (jamais de régression)"
    assert row.einheitspreis_netto == Decimal("200")
    assert row.source_file == "preise_2026.csv"


def test_recent_remplace_ancien_et_egal_met_a_jour():
    _, session = _stack()
    commit_import(db=session, tenant_id="t1", user_id="u-alice",
                  source_file="p2022.csv", result=_import_result("02.003", 2022, "150"))
    newer = commit_import(db=session, tenant_id="t1", user_id="u-alice",
                          source_file="p2026.csv", result=_import_result("02.003", 2026, "200"))
    assert newer.updated == 1 and newer.skipped_veraltet is None
    row = session.query(OfficePrice).filter_by(tenant_id="t1").one()
    assert row.preisstand_jahr == 2026 and row.source_file == "p2026.csv"
    same = commit_import(db=session, tenant_id="t1", user_id="u-alice",
                         source_file="p2026-bis.csv", result=_import_result("02.003", 2026, "210"))
    assert same.updated == 1 and same.skipped_veraltet is None, \
        "même millésime = mise à jour (idempotence §50 inchangée)"
    assert session.query(OfficePrice).filter_by(tenant_id="t1").one().einheitspreis_netto == Decimal("210")


def test_lot_mixte_une_ligne_sautee_l_autre_prise():
    _, session = _stack()
    commit_import(db=session, tenant_id="t1", user_id="u-alice",
                  source_file="p2026.csv", result=_import_result("02.003", 2026, "200"))
    mixed = ImportResult(kind="csv", accepted=[
        ImportedPrice(oz="02.003", kurztext="vieux", einheit="m³",
                      einheitspreis_netto=Decimal("120"), preisstand_jahr=2018,
                      kostengruppe=None, kg_confiance=None),
        ImportedPrice(oz="02.004", kurztext="neuf", einheit="m³",
                      einheitspreis_netto=Decimal("99"), preisstand_jahr=2026,
                      kostengruppe=None, kg_confiance=None),
    ])
    stats = commit_import(db=session, tenant_id="t1", user_id="u-alice",
                          source_file="mixte.csv", result=mixed)
    assert stats.skipped_veraltet == ["02.003"]
    assert stats.inserted == 1 and stats.total_active == 2


def test_rest_import_rapporte_le_refus_veraltet_avec_oz():
    client, _ = _stack()
    csv_2026 = "oz;kurztext;einheit;ep;jahr\n02.003;Beton;m³;200,00;\n".encode()
    res1 = client.post("/api/v5/office-prices/import",
                       files={"file": ("p26.csv", csv_2026, "text/csv")},
                       data={"preisstand_jahr": "2026"})
    assert res1.status_code == 200, res1.text
    res2 = client.post("/api/v5/office-prices/import",
                       files={"file": ("p18.csv", csv_2026.replace(b"200,00", b"120,00"), "text/csv")},
                       data={"preisstand_jahr": "2018"})
    assert res2.status_code == 200
    body = res2.json()
    assert body["skipped_veraltet"] == 1
    assert any("ÄLTEREM Preisstand" in w and "02.003" in w for w in body["warnings"]), \
        "le rapport le DIT avec l'OZ"


# --------- offres (§95) : refusé en bibliothèque, MAIS observation gardée ----


def test_to_library_veraltet_refuse_la_ligne_mais_garde_l_observation():
    client, session = _stack()
    # Bibliothèque déjà à 2026 sur l'OZ.
    commit_import(db=session, tenant_id="t1", user_id="u-alice",
                  source_file="p2026.csv", result=_import_result("001.00001", 2026, "200"))
    # Offre « de 2018 » (created_at reculé — le millésime d'offre = réception).
    xml = build_lv_gaeb_x31(
        project_name="P",
        positions=[{"id": "p1", "oz": "01.001", "title": "Beton C25/30",
                    "qty": 1.0, "unit": "m³", "unit_price": 120.0,
                    "price_hint": "manuell", "gp": 120.0}],
        mit_preisen=True,
    ).encode("utf-8")
    offer_id = client.post(
        f"/api/v5/collab/{ROOM}/offers",
        files={"file": ("alt.x31", xml, "application/xml")},
        data={"firma": "Altbaupreis GmbH"},
    ).json()["offer"]["id"]
    row = session.get(GaebOffer, offer_id)
    row.created_at = datetime(2018, 5, 3, 10, 0)
    session.commit()
    res = client.post(f"/api/v5/collab/{ROOM}/offers/{offer_id}/to-library")
    body = res.json()
    assert body["skipped_veraltet"] == 1, "2018 ne remplace pas 2026"
    assert body["inserted"] == 0 and body["updated"] == 0
    assert session.query(OfficePrice).filter_by(tenant_id="t1").one().preisstand_jahr == 2026
    assert body["observations_added"] == 1, \
        "l'HISTOIRE est gardée : l'observation de 2018 alimente le Spiegel"
    assert session.query(PriceObservation).one().preisstand_jahr == 2018


# ------------------- indexation : honnêteté pré-2020 épinglée ----------------


def test_note_indexation_pre_2020_explicite_jamais_x1_muet():
    assert index_for_year(2018) is None, "périmètre officiel chargé : ab 2020"
    note = index_note(2018, Decimal("1"))
    assert note is not None and "keine Indexierung möglich" in note
    assert "2020" in note and "auffrischen" in note
    # Le cas normal reste inchangé (note classique avec facteur).
    note_2024 = index_note(2024, Decimal("1.0813"))
    assert note_2024 == f"indexiert 2024→{current_index_year()} (×1.0813)"
    assert index_note(current_index_year(), Decimal("1")) is None


def test_resolveur_epingle_prix_pre_2020_non_indexe():
    """Comportement VÉRIDIQUE du moteur aujourd'hui : un prix 2018 passe
    tel quel (facteur 1 — pas de série officielle chargée avant 2020) ;
    la note §97 le rend maintenant visible. Jamais présenté comme mesuré."""
    _, session = _stack()
    commit_import(db=session, tenant_id="t1", user_id="u-alice",
                  source_file="p2018.csv", result=_import_result("02.003", 2018, "120"))
    resolved = resolve_price_for_kg(db=session, tenant_id="t1",
                                    kostengruppe="kg320_aussenwaende_rohbau")
    assert resolved is not None
    assert resolved.preisstand_jahr == 2018
    assert resolved.index_faktor == Decimal("1.0000"), "épinglé : pas d'index 2018"
    assert resolved.einheitspreis_netto_indiziert == Decimal("120.00")


def test_spiegel_sert_les_jahrgaenge_min_max_bruts():
    client, session = _stack()
    # Deux offres, millésimes volontairement différents (histoire réelle).
    ids = []
    for firma, ep in (("A AG", 100.0), ("B AG", 200.0)):
        xml = build_lv_gaeb_x31(
            project_name="P",
            positions=[{"id": "p", "oz": "01.001", "title": "Beton C25/30",
                        "qty": 1.0, "unit": "m³", "unit_price": ep,
                        "price_hint": "manuell", "gp": ep}],
            mit_preisen=True,
        ).encode("utf-8")
        oid = client.post(f"/api/v5/collab/{ROOM}/offers",
                          files={"file": ("a.x31", xml, "application/xml")},
                          data={"firma": firma}).json()["offer"]["id"]
        ids.append(oid)
    session.get(GaebOffer, ids[0]).created_at = datetime(2018, 5, 3)
    session.get(GaebOffer, ids[1]).created_at = datetime(2026, 2, 1)
    session.commit()
    for oid in ids:
        client.post(f"/api/v5/collab/{ROOM}/offers/{oid}/to-library")
    data = spiegel_for_tenant(session, tenant_id="t1")
    item = data["items"][0]
    assert item["min_jahr"] == 2018 and item["max_jahr"] == 2026, \
        "les Jahrgänge sont servis — l'écran peut dire « valeurs brutes »"
    res = client.get("/api/v5/office-prices/spiegel")
    body_item = res.json()["items"][0]
    assert body_item["min_jahr"] == 2018 and body_item["max_jahr"] == 2026
