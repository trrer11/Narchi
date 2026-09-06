"""Tests §90 — Export GAEB X31 du LV co-édité (cadrage : essentiel,
excellence, rien de cosmétique).

Vérifié en RE-PARSANT le XML produit (namespace réel DA XML 3.2 phase
31, pas des chaînes) : squelette obligatoire (GAEBInfo 3.2/DP=31/Cur
EUR/ProgSystem honnête), OZ reconstituée avec padding REB 23.003
(01.003.010 → 001.003.00010), groupements BoQCtgy par segments COMMUNS
(imbrication ≤ profondeur des OZ), BoQBkdn déclarée ≥ contenu, tri OZ
numérique, modes sans prix (Ausschreibung : AUCUN UP/IT, les EP manuels
ne fuient pas) / avec prix (UP/IT arrondis + hINWEIS « manuelle
Eingabe » DANS le fichier), refus 0,00 € (« ohne EP » → LvExportError
triée), échappement XML &, <, >, Qty ≤ 3 décimales.
REST : 422 « noch keine Positionen » INDIFFÉRENCIABLE document absent /
vide (invisibilité inter-bureaux), 422 liste des OZ, 200 attachment +
en-têtes honnêtes X-Narchi-Lv-*.
"""

import os
import xml.etree.ElementTree as ET

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

import app.api.collab_routes as routes_mod  # noqa: E402
from app.core.estimation.gaeb_export import GAEB_NS  # noqa: E402
from app.core.security import get_current_user  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.models.collab_doc import CollabDoc  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.gaeb_lv_export import (  # noqa: E402
    LvExportError,
    build_lv_gaeb_x31,
)
from pycrdt import Array, Doc, Map  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.services.collab_history import _utcnow  # noqa: E402

NS = {"g": GAEB_NS}


def _pos(oz: str, qty: str, unit_price, title: str = "Position", unit: str = "m³") -> dict:
    return {
        "id": f"p-{oz}", "oz": oz, "title": title, "qty": float(qty),
        "unit": unit, "unit_price": unit_price, "price_hint": "manuell",
        "gp": round(float(qty) * unit_price, 2) if unit_price is not None else None,
    }


def _parse(xml: str) -> ET.Element:
    return ET.fromstring(xml.encode("utf-8"))


def _walk_oz(root: ET.Element) -> list:
    """(chemin RNoPart, tag) de chaque nœud BoQCtgy/Item — l'OZ GAEB est
    la concaténation paddée des RNoPart du chemin (REB 23.003)."""
    out = []

    def rec(node: ET.Element, path: list):
        for child in node:
            tag = child.tag.split("}")[-1]
            if tag in ("BoQCtgy", "Item"):
                new_path = path + [child.attrib.get("RNoPart", "")]
                out.append((".".join(new_path), tag, child))
                rec(child, new_path)
            elif tag in ("BoQBody", "Itemlist", "BoQ", "Award"):
                rec(child, path)

    rec(root, [])
    return out


# ------------------------------ builder pur ---------------------------------


def test_structure_obligatoire_et_padding_oz():
    xml = build_lv_gaeb_x31(project_name="Muster", positions=[
        _pos("01.003.010", "12.5", None),
    ])
    root = _parse(xml)
    assert root.tag == f"{{{GAEB_NS}}}GAEB"
    assert root.findtext("g:GAEBInfo/g:Version", namespaces=NS) == "3.2"
    assert root.find("g:GAEBInfo/g:ProgSystem", namespaces=NS).text.startswith("NARCHI")
    assert root.findtext("g:PrjInfo/g:Cur", namespaces=NS) == "EUR"
    award = root.find("g:Award", namespaces=NS)
    assert award.findtext("g:DP", namespaces=NS) == "31"
    oz_paths = [p for p, tag, _ in _walk_oz(award)]
    assert ("001.003.00010", "Item") in [(p, t) for p, t, _ in _walk_oz(award)], \
        f"OZ GAEB paddée REB 23.003 attendue — obtenu {oz_paths}"
    # BoQBkdn déclarée couvre TOUJOURS le contenu.
    bkdns = award.findall("g:BoQ/g:BoQInfo/g:BoQBkdn", namespaces=NS)
    lengths = {b.findtext("g:Type", namespaces=NS): int(b.findtext("g:Length", namespaces=NS)) for b in bkdns}
    assert lengths["BoQLevel"] >= 3 and lengths["Item"] >= 5


def test_sans_prix_aucun_up_it_les_ep_manuels_ne_fuient_pas():
    xml = build_lv_gaeb_x31(
        project_name="Datenschutz", positions=[_pos("01.001", "3", 189.9)],
        mit_preisen=False,
    )
    root = _parse(xml)
    assert root.findall(".//g:UP", namespaces=NS) == []
    assert root.findall(".//g:IT", namespaces=NS) == []
    assert "189.9" not in xml, "l'EP manuel ne doit JAMAIS fuir en mode Ausschreibung"
    qty = root.find(".//g:Item/g:Qty", namespaces=NS).text
    assert qty == "3"


def test_mit_preisen_up_it_arrondis_et_hinweis_36_dans_le_fichier():
    xml = build_lv_gaeb_x31(
        project_name="Intern", positions=[_pos("01.001", "12.5", 189.9)],
        mit_preisen=True,
    )
    root = _parse(xml)
    item = root.find(".//g:Item", namespaces=NS)
    assert item.findtext("g:UP", namespaces=NS) == "189.90"
    assert item.findtext("g:IT", namespaces=NS) == "2373.75"
    spans = [s.text for s in item.findall(".//g:DetailTxt//g:span", namespaces=NS)]
    assert any("manuelle Eingabe" in (s or "") for s in spans), \
        "charte §36 DANS le fichier échangé, pas seulement dans l'UI"


def test_oz_tree_groupe_segments_communs_et_imbrique():
    xml = build_lv_gaeb_x31(project_name="Baum", positions=[
        _pos("01.003.010", "1", None),
        _pos("01.003.020", "2", None),
        _pos("01.004.005", "3", None),
        _pos("02.001", "4", None),
    ])
    award = _parse(xml).find("g:Award", namespaces=NS)
    chemins = [(p, t) for p, t, _ in _walk_oz(award)]
    assert ("001", "BoQCtgy") in chemins
    assert chemins.count(("001", "BoQCtgy")) == 1, "un segment commun = UNE catégorie"
    assert ("001.003.00010", "Item") in chemins
    assert ("001.003.00020", "Item") in chemins
    assert ("001.004.00005", "Item") in chemins
    assert ("002.00001", "Item") in chemins
    # Tri OZ NUMÉRIQUE dans la sortie, pas l'ordre d'insertion :
    xml2 = build_lv_gaeb_x31(project_name="Tri", positions=[
        _pos("01.10", "1", None, title="zehn"),
        _pos("01.2", "1", None, title="zwei"),
    ])
    assert xml2.index("zwei") < xml2.index("zehn"), "01.2 AVANT 01.10 (tri numérique)"


def test_refus_ohne_ep_liste_triee_jamais_de_zero_invente():
    with pytest.raises(LvExportError) as err:
        build_lv_gaeb_x31(project_name="X", positions=[
            _pos("01.010", "1", None),
            _pos("01.002", "1", None),
            _pos("01.001", "1", 5.0),
        ], mit_preisen=True)
    assert err.value.oz == ["01.002", "01.010"], "liste des OZ triée pour le message"


def test_echappement_xml_et_qty_decimales():
    xml = build_lv_gaeb_x31(project_name="A & B <C>", positions=[
        _pos("01.001", "1.2345", None, title='Wände & "Türen" <Sonder>'),
    ])
    root = _parse(xml)  # parse OK = échappement correct
    assert root.findtext("g:PrjInfo/g:NamePrj", namespaces=NS) == "A & B <C>"
    title = root.find(".//g:TextOutlTxt/g:span", namespaces=NS).text
    assert title == 'Wände & "Türen" <Sonder>'
    assert root.find(".//g:Item/g:Qty", namespaces=NS).text == "1.235"  # 4e déc. arrondie


# --------------------------------- REST -------------------------------------


def _lv_state(positions: list) -> bytes:
    doc = Doc()
    yarr = doc.get("lv", type=Array)
    with doc.transaction():
        for p in positions:
            yarr.append(Map(p))
    return doc.get_update()


def _make_stack():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=[User.__table__, CollabDoc.__table__])
    session = sessionmaker(bind=engine)()
    alice = User(id="u-alice", email="alice@buero.de", hashed_password="x",
                 name="Alice A", role="owner", tenant_id="t1", is_active=True)
    session.add(alice)
    session.commit()
    app = FastAPI()
    app.include_router(routes_mod.router)
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[get_current_user] = lambda: alice
    with TestClient(app) as client:
        return client, session


def test_rest_gaeb_telechargement_et_422_honnetes():
    client, session = _make_stack()
    # Sans document ET avec document vide : MÊME 422 (invisibilité).
    res = client.get("/api/v5/collab/notiz-buero/lv/gaeb.x31")
    assert res.status_code == 422 and "keine LV-Positionen" in res.json()["detail"]
    session.add(CollabDoc(id="t1:notiz-buero", tenant_id="t1", room="notiz-buero",
                          state=_lv_state([
                              _pos("01.002", "3", None, title="Schalung"),
                              _pos("01.001", "12.5", 189.9, title="Beton C25/30 & Armierung"),
                          ]), version=1, updated_at=_utcnow()))
    session.commit()

    # Mode prix avec une position « ohne EP » → 422 + OZ citée, 0 inventé.
    res = client.get("/api/v5/collab/notiz-buero/lv/gaeb.x31?preise=1&projekt=Wasserwerk")
    assert res.status_code == 422
    assert "01.002" in res.json()["detail"] and "Kein Preis wird erfunden" in res.json()["detail"]

    # Ausschreibung (défaut) : fichier joint, XML conforme, tri OZ.
    res = client.get("/api/v5/collab/notiz-buero/lv/gaeb.x31?projekt=Wasserwerk")
    assert res.status_code == 200, res.text
    assert "attachment" in res.headers["content-disposition"]
    assert res.headers["content-disposition"].endswith('.x31"')
    assert res.headers["x-narchi-lv-positionen"] == "2"
    assert res.headers["x-narchi-lv-preise"] == "ohne-preise"
    root = _parse(res.text)
    assert root.find("g:Award/g:DP", namespaces=NS).text == "31"
    assert res.text.index("Beton C25/30 &amp; Armierung") < res.text.index("Schalung"), \
        "tri numérique : 01.001 avant 01.002 dans le fichier"

    # Mode prix complet quand TOUT est chiffré.
    session.query(CollabDoc).filter_by(id="t1:notiz-buero").update({
        "state": _lv_state([_pos("01.001", "12.5", 189.9, title="Beton")]),
    })
    session.commit()
    res = client.get("/api/v5/collab/notiz-buero/lv/gaeb.x31?preise=1")
    assert res.status_code == 200 and res.headers["x-narchi-lv-preise"] == "mit-ep"
    item = _parse(res.text).find(".//g:Item", namespaces=NS)
    assert item.findtext("g:IT", namespaces=NS) == "2373.75"


def test_rest_gaeb_invisibilite_inter_bureaux():
    client, session = _make_stack()
    # Document d'un AUTRE tenant (t2) → Alice voit le MÊME 422 que « rien ».
    session.add(CollabDoc(id="t2:notiz-buero", tenant_id="t2", room="notiz-buero",
                          state=_lv_state([_pos("01.001", "1", 2.0)]), version=1,
                          updated_at=_utcnow()))
    session.commit()
    res = client.get("/api/v5/collab/notiz-buero/lv/gaeb.x31")
    assert res.status_code == 422 and "keine LV-Positionen" in res.json()["detail"]
