"""Tests §92 — Angebotsvergleich (matrice de comparaison).

Logique PURE (pas de mock DB) + REST : matching OZ paddée↔interne par
tuple numérique, tri numérique des lignes, best = min EP SEULEMENT si ≥
2 offres chiffrées, écart % vs EP interne (1 décimale, jamais sans
base), « nur im Angebot » affiché, offre incomplète marquée (total =
Teilsumme, jamais prétendu comparable), doublons internes comptés,
isolation inter-bureaux indifférenciable.
"""

import json
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pycrdt import Array, Doc, Map

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

import app.api.collab_routes as routes_mod  # noqa: E402
from app.core.security import get_current_user  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.models.collab_doc import CollabDoc  # noqa: E402
from app.models.gaeb_offer import GaebOffer  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.collab_history import _utcnow  # noqa: E402
from app.services.gaeb_lv_export import build_lv_gaeb_x31  # noqa: E402
from app.services.offer_compare import (  # noqa: E402
    build_comparison,
    normalize_oz_for_match,
)
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402


def _internal(oz, qty, up, title="Intern"):
    return {
        "id": f"i-{oz}", "oz": oz, "title": title, "qty": float(qty),
        "unit": "m³", "unit_price": up, "price_hint": "manuell",
        "gp": round(float(qty) * up, 2) if up is not None else None,
    }


def _item(oz, up_cents, it_cents=None, title="Angebot", qty=1.0):
    return {"oz": oz, "title": title, "qty": qty, "unit": "m³",
            "up_cents": up_cents, "it_cents": it_cents}


def _offer(oid, name, items):
    return {"id": oid, "company_name": name, "dp": "83", "items": items}


# ----------------------------- logique pure ---------------------------------


def test_normalize_oz_paddage_et_refus_des_non_numeriques():
    assert normalize_oz_for_match("001.003.00010") == (1, 3, 10)
    assert normalize_oz_for_match("01.3.10") == (1, 3, 10), "même position, padding sans effet"
    assert normalize_oz_for_match("") is None
    assert normalize_oz_for_match("01.A.2") is None, "lettre → jamais de faux match"
    assert normalize_oz_for_match("..1..2..") == (1, 2)


def test_matrice_union_triee_best_et_deltas():
    internal = [_internal("01.001", 12.5, 100.0), _internal("01.010", 3, None)]
    a = _offer("A", "Bauer", [_item("001.00001", 9500, 118750), _item("001.00010", 50, 150)])
    b = _offer("B", "Müller", [_item("001.00001", 9000, 112500)])  # ligne 010 non chiffrée
    matrix = build_comparison(internal, [a, b])
    rows = matrix["rows"]
    assert [r["oz"] for r in rows] == ["01.001", "01.010"], "tri numérique, union affichée"
    ligne1, ligne2 = rows
    assert ligne1["best_offer_id"] == "B", "min EP gagne (90,00 < 95,00)"
    assert ligne1["internal_up_cents"] == 10000
    assert ligne1["cells"]["A"]["delta_pct"] == -5.0, "95 < 100 interne → -5,0 %"
    assert ligne1["cells"]["B"]["delta_pct"] == -10.0
    assert ligne2["best_offer_id"] is None, "une seule offre chiffrée → rien à comparer"
    assert "B" not in ligne2["cells"], "Müller n'a PAS chiffré 01.010 → pas de cellule"
    assert ligne2["internal_up_cents"] is None
    assert ligne2["cells"]["A"]["delta_pct"] is None, "kein Prozent ohne interne Basis"

    resume = {o["id"]: o for o in matrix["offers"]}
    assert resume["A"]["complete"] is True
    assert resume["A"]["total_cents"] == 118750 + 150
    assert resume["B"]["complete"] is False and resume["B"]["missing_internal"] == 1


def test_nur_im_angebot_affiche_et_doublons_comptes():
    internal = [_internal("01.001", 1, 10.0), _internal("01.001", 2, 20.0)]  # doublon honnête
    a = _offer("A", "Bauer", [_item("001.00001", 500, 500), _item("009.00001", 700, 700, title="Extra-Firma")])
    matrix = build_comparison(internal, [a])
    assert matrix["duplicate_internal_oz"] == 1
    oz_set = [r["oz"] for r in matrix["rows"]]
    assert "01.001" in oz_set and any(r["only_in_offer"] for r in matrix["rows"]), \
        "ligne ajoutée par l'entreprise : affichée, flaguée, jamais cachée"
    extra = next(r for r in matrix["rows"] if r["only_in_offer"])
    assert extra["title"] == "Extra-Firma" and extra["best_offer_id"] is None


def test_dp_leer_nicht_als_31_erfunden():
    a = _offer("A", "Bauer", [_item("001.00001", 500, 500)])
    a["dp"] = ""
    matrix = build_comparison([], [a])
    assert matrix["offers"][0]["dp"] == ""


def test_oz_non_numerique_de_loffre_ne_cree_pas_de_ligne_fantome():
    a = _offer("A", "Bauer", [_item("ABC", 500, 500)])
    matrix = build_comparison([], [a])
    assert matrix["rows"] == [], "OZ non numérique ignorée — pas de fausse position"


# --------------------------------- REST -------------------------------------


def _lv_state(positions: list) -> bytes:
    doc = Doc()
    yarr = doc.get("lv", type=Array)
    with doc.transaction():
        for p in positions:
            yarr.append(Map({
                "id": p["id"], "oz": p["oz"], "title": p["title"], "qty": p["qty"],
                "unit": p["unit"], "unit_price": p["unit_price"], "price_hint": "manuell",
            }))
    return doc.get_update()


def _seed_offer(session, tenant, room, company, items):
    import uuid as _uuid
    xml = build_lv_gaeb_x31(project_name="X", positions=[
        {"id": "p", "oz": "01.001", "title": "T", "qty": 1.0, "unit": "Stk",
         "unit_price": 1.0, "price_hint": "manuell", "gp": 1.0},
    ], mit_preisen=True)
    row = GaebOffer(
        id=_uuid.uuid4().hex, tenant_id=tenant, room=room, company_name=company,
        filename="a.x31", dp="83", cur="EUR", xml_raw=xml.encode(), bytes=len(xml),
        items_json=json.dumps(items, ensure_ascii=False), item_count=len(items),
        ohne_preis_count=sum(1 for i in items if i["up_cents"] is None),
        gp_total_cents=sum(i["it_cents"] or 0 for i in items),
        created_by="u", created_by_name="U", created_at=_utcnow(),
    )
    session.add(row)
    session.commit()
    return row


def test_rest_compare_422_sans_offres_puis_200_avec_interne():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(
        bind=engine,
        tables=[User.__table__, GaebOffer.__table__, CollabDoc.__table__],
    )
    session = sessionmaker(bind=engine)()
    alice = User(id="u-alice", email="alice@buero.de", hashed_password="x",
                 name="Alice A", role="owner", tenant_id="t1", is_active=True)
    fred = User(id="u-fred", email="fred@ander.de", hashed_password="x",
                name="Fred F", role="owner", tenant_id="t2", is_active=True)
    session.add_all([alice, fred])
    session.commit()
    app = FastAPI()
    app.include_router(routes_mod.router)
    app.dependency_overrides[get_db] = lambda: session
    current = {"user": alice}
    app.dependency_overrides[get_current_user] = lambda: current["user"]
    client = TestClient(app)

    res = client.get("/api/v5/collab/notiz-buero/offers/compare/matrix")
    assert res.status_code == 422 and "keine Angebote" in res.json()["detail"]

    # LV interne (2 positions, une sans EP) + 2 offres paddées.
    session.add(CollabDoc(id="t1:notiz-buero", tenant_id="t1", room="notiz-buero",
                          state=_lv_state([
                              _internal("01.001", 12.5, 100.0),
                              _internal("01.002", 3, None),
                          ]), version=1, updated_at=_utcnow()))
    _seed_offer(session, "t1", "notiz-buero", "Bauer",
                [_item("001.00001", 9500, 118750), _item("001.00002", 50, 150)])
    _seed_offer(session, "t1", "notiz-buero", "Müller",
                [_item("001.00001", 9000, 112500), _item("001.00002", 55, 165)])

    res = client.get("/api/v5/collab/notiz-buero/offers/compare/matrix")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["hinweis"]
    rows = {r["oz"]: r for r in body["rows"]}
    assert rows["01.001"]["best_offer_id"] is not None
    assert rows["01.001"]["internal_up_cents"] == 10000
    summary = {o["company_name"]: o for o in body["offers"]}
    assert summary["Bauer"]["complete"] is True
    assert summary["Müller"]["total_cents"] == 112500 + 165

    # Invisibilité inter-bureaux : Fred = même 422 que « rien ».
    current["user"] = fred
    res = client.get("/api/v5/collab/notiz-buero/offers/compare/matrix")
    assert res.status_code == 422 and "keine Angebote" in res.json()["detail"]
