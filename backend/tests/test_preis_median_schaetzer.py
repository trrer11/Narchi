"""Tests §99 — Median-Büropreis im Schnell-Schätzer.

AVANT §99 (règle §50) : UNE position par Kostengruppe était choisie —
« millésime le plus récent, puis OZ croissante ». Un prix aberrant récent
(Ausreißer) devenait ainsi SEUL LE prix du bureau pour toute la KG.

§99 : ≥ 2 positions de la KG partageant la MÊME Einheit → médiane (règle
§96, centimes arrondis Half-Up) des prix CHACUN indexé de SON millésime
vers l'année cible — jamais de médiane de valeurs brutes de plusieurs
années. Les positions d'une AUTRE Einheit ne sont JAMAIS mélangées
(€/m² et €/St ne font pas une statistique) : elles sont écartées, comptées
et dites (n_nicht_gemischt). n = 1 → comportement §50 inchangé.

Indices officiels épinglés (Destatis §49, Stand 10.07.2026) :
2024 = 129,75 · 2025 = 133,88 · 2026 = 140,30 · 2022 = 111,53 ·
avant 2020 : pas de série chargée → facteur 1 (vérité §97).
"""

import os
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

from app.core.estimation.price_database import PriceRegion  # noqa: E402
from app.core.estimation.quick_estimate import QuickElement, estimate_quick  # noqa: E402
from app.database import Base  # noqa: E402
from app.models.office_price import OfficePrice  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.office_price_service import (  # noqa: E402
    current_index_year,
    resolve_price_for_kg,
    tenant_price_map,
)

KG320 = "kg320_aussenwaende_rohbau"
KG364 = "kg364_belaege_boden"


def _mk_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine, tables=[User.__table__, OfficePrice.__table__])
    db = sessionmaker(bind=engine)()
    db.add(User(id="u1", email="a@buero.de", hashed_password="x", name="A",
                role="owner", tenant_id="t1", is_active=True))
    db.commit()
    return db


def _row(db, *, oz, ep, jahr, einheit="m²", kg=KG320, tenant="t1",
         source="fixture.csv"):
    db.add(OfficePrice(
        id=uuid.uuid4().hex, tenant_id=tenant, uploaded_by="u1",
        oz=oz, kurztext=f"Betonprobe OZ {oz}", einheit=einheit,
        einheitspreis_netto=Decimal(ep), preisstand_jahr=jahr,
        kostengruppe=kg, kg_confiance=0.9,
        source_file=source, source_kind="csv",
    ))
    db.commit()


# --------------------------------------------------------------------------
# La règle médiane elle-même
# --------------------------------------------------------------------------

def test_median_fait_barrage_a_un_ausreisser():
    """Trois prix propres même année : 120 / 135 / 9 000 € (saisie folle).
    La MOYENNE tirerait le devis à 3 085 € — la médiane reste à 135 €."""
    db = _mk_session()
    _row(db, oz="01", ep="120.00", jahr=2026)
    _row(db, oz="02", ep="135.00", jahr=2026)
    _row(db, oz="03", ep="9000.00", jahr=2026)
    resolved = resolve_price_for_kg(db, tenant_id="t1", kostengruppe=KG320)
    assert resolved is not None
    assert resolved.auswahl == "median" and resolved.n_quellen == 3
    assert resolved.einheitspreis_netto_indiziert == Decimal("135.00")
    # Jamais une fausse pièce unique comme provenance.
    assert resolved.oz_quelle == ""
    assert resolved.index_faktor is None
    assert resolved.preisstand_jahr == 2026  # les 3 prix sont déjà 2026
    assert resolved.quellen_jahr_von == 2026 and resolved.quellen_jahr_bis == 2026


def test_median_des_prix_INDEXES_jamais_de_valeurs_brutes_melangees():
    """Mélange de millésimes : chacun est d'abord indexé vers 2026, PUIS
    la médiane est prise — sinon les années fausseraient la statistique."""
    db = _mk_session()
    _row(db, oz="01", ep="100.00", jahr=2018)  # pré-2020 : facteur 1 (§97)
    _row(db, oz="02", ep="130.00", jahr=2024)
    _row(db, oz="03", ep="140.00", jahr=2026)
    resolved = resolve_price_for_kg(db, tenant_id="t1", kostengruppe=KG320)
    assert resolved is not None and resolved.auswahl == "median"
    # Preuve du calcul :
    #   2018 → facteur 1,0000 (série ab 2020)        → 100,00 €
    #   2024 → 130 × 140,30/129,75 = 140,57 €
    #   2026 → facteur 1,0000                         → 140,00 €
    #   tri [100,00 · 140,00 · 140,57] → médiane 140,00 €
    cent_2024 = (Decimal("130.00") * Decimal("140.30") / Decimal("129.75")).quantize(
        Decimal("0.01")
    )
    assert cent_2024 == Decimal("140.57")
    assert resolved.einheitspreis_netto_indiziert == Decimal("140.00")
    assert resolved.quellen_jahr_von == 2018 and resolved.quellen_jahr_bis == 2026
    assert resolved.preisstand_jahr == 2026  # médiane DÉJÀ au niveau 2026


def test_median_pair_moyenne_des_deux_centraux_half_up():
    """n pair : moyenne des deux valeurs centrales, arrondie Half-Up au
    centime — la règle EXACTE du Preisspiegel §96 est réutilisée."""
    db = _mk_session()
    _row(db, oz="01", ep="100.01", jahr=2026)   # 10001 centimes
    _row(db, oz="02", ep="100.02", jahr=2026)   # 10002 centimes
    resolved = resolve_price_for_kg(db, tenant_id="t1", kostengruppe=KG320)
    # (10001 + 10002) / 2 = 10001,5 → Half-Up 10002 → 100,02 €
    assert resolved.einheitspreis_netto_indiziert == Decimal("100.02")
    assert resolved.n_quellen == 2


# --------------------------------------------------------------------------
# Einheit : jamais mélangée
# --------------------------------------------------------------------------

def test_autre_einheit_jamais_melangee_mais_comptee():
    """2 prix en m² + 1 prix en St : la médiane se fait sur les m² SEULS ;
    la position St est écartée et comptée (dite à l'écran)."""
    db = _mk_session()
    _row(db, oz="01", ep="140.00", jahr=2026, einheit="m²")
    _row(db, oz="02", ep="130.00", jahr=2024, einheit="m²")
    _row(db, oz="03", ep="500.00", jahr=2026, einheit="St")
    resolved = resolve_price_for_kg(db, tenant_id="t1", kostengruppe=KG320)
    assert resolved.auswahl == "median" and resolved.n_quellen == 2
    assert resolved.einheit_quelle == "m²"
    # 140,00 € (2026) et 140,57 € (2024 indexé) → (14000+14057)/2 = 14028,5
    # → Half-Up 14029 centimes.
    assert resolved.einheitspreis_netto_indiziert == Decimal("140.29")
    assert resolved.n_nicht_gemischt == 1  # le prix « St » est dit, pas mélangé


def test_egalite_einheiten_regle_deterministe():
    """1×m² contre 1×St : le groupe au millésime le plus récent gagne ;
    à millésime égal, l'unité alphabétiquement dernière (« m² » > « St »)."""
    db = _mk_session()
    _row(db, oz="01", ep="111.00", jahr=2025, einheit="m²")
    _row(db, oz="02", ep="222.00", jahr=2026, einheit="St")
    resolved = resolve_price_for_kg(db, tenant_id="t1", kostengruppe=KG320)
    assert resolved.auswahl == "einzelpreis" and resolved.oz_quelle == "02"
    assert resolved.einheit_quelle == "St" and resolved.n_nicht_gemischt == 1

    db2 = _mk_session()
    _row(db2, oz="01", ep="111.00", jahr=2026, einheit="m²")
    _row(db2, oz="02", ep="222.00", jahr=2026, einheit="St")
    resolved2 = resolve_price_for_kg(db2, tenant_id="t1", kostengruppe=KG320)
    assert resolved2.oz_quelle == "01" and resolved2.einheit_quelle == "m²"


# --------------------------------------------------------------------------
# Boucle par KG (tenant_price_map) + estimation éclair de bout en bout
# --------------------------------------------------------------------------

def test_tenant_price_map_par_kg_et_sans_kg_ignoree():
    db = _mk_session()
    _row(db, oz="01", ep="120.00", jahr=2026)
    _row(db, oz="02", ep="135.00", jahr=2026)
    _row(db, oz="09", ep="88.00", jahr=2026, kg=KG364)
    _row(db, oz="99", ep="1.00", jahr=2026, kg=None)  # sans KG : jamais dans la carte
    price_map = tenant_price_map(db, tenant_id="t1")
    assert set(price_map) == {KG320, KG364}
    assert price_map[KG320].auswahl == "median" and price_map[KG320].n_quellen == 2
    assert price_map[KG320].einheitspreis_netto_indiziert == Decimal("127.50")
    assert price_map[KG364].auswahl == "einzelpreis"
    assert price_map[KG364].einheitspreis_netto_indiziert == Decimal("88.00")


def test_cloisonnement_tenant_inchange():
    db = _mk_session()
    _row(db, oz="01", ep="120.00", jahr=2026)
    _row(db, oz="02", ep="135.00", jahr=2026)
    assert tenant_price_map(db, tenant_id="t2") == {}
    assert resolve_price_for_kg(db, tenant_id="t2", kostengruppe=KG320) is None


def test_quick_estimate_detail_median_et_avertissement():
    """De bout en bout : bibliothèque → carte §50 → /quick — la ligne porte
    la MÉDIANE, son détail honnête, et l'avertissement la compte."""
    db = _mk_session()
    _row(db, oz="01", ep="100.00", jahr=2018)
    _row(db, oz="02", ep="130.00", jahr=2024)
    _row(db, oz="03", ep="140.00", jahr=2026)
    _row(db, oz="04", ep="999.00", jahr=2026, einheit="St")
    price_map = tenant_price_map(db, tenant_id="t1")
    assert price_map[KG320].auswahl == "median"

    elements = [
        QuickElement(ifc_type="IfcWall", name="AW", material_hint="Mauerwerk",
                     net_area=Decimal("10"), count=1, confidence=0.9),
    ]
    result = estimate_quick(elements, PriceRegion.NIEDERSACHSEN,
                            tenant_price_resolver=price_map.get)
    (ligne,) = result["lines"]
    assert ligne["preis_quelle"] == "büro"
    assert ligne["einheitspreis_netto"] == pytest.approx(140.0)  # médiane, pas le St à 999 €
    detail = ligne["preis_quelle_detail"]
    assert detail["auswahl"] == "median"
    assert detail["n_quellen"] == 3 and detail["einheit"] == "m²"
    assert detail["median_steht_auf"] == current_index_year()
    assert detail["jahr_von"] == 2018 and detail["jahr_bis"] == 2026
    assert detail["nicht_vermischt"] == 1
    warnings = " ".join(result["warnings"])
    assert "MEDIAN" in warnings and "Ausreißer" in warnings


def test_quick_estimate_detail_einzelpreis_inchange():
    """n = 1 : la forme historique du détail reste (OZ, Stand, Faktor) —
    simplement marquée auswahl=einzelpreis pour l'écran."""
    db = _mk_session()
    _row(db, oz="07.01", ep="250.00", jahr=2025)
    price_map = tenant_price_map(db, tenant_id="t1")
    elements = [
        QuickElement(ifc_type="IfcWall", name="AW", material_hint="Mauerwerk",
                     net_area=Decimal("10"), count=1, confidence=0.9),
    ]
    result = estimate_quick(elements, PriceRegion.NIEDERSACHSEN,
                            tenant_price_resolver=price_map.get)
    (ligne,) = result["lines"]
    detail = ligne["preis_quelle_detail"]
    assert detail["auswahl"] == "einzelpreis"
    assert detail["oz"] == "07.01" and detail["preisstand_jahr"] == 2025
    assert detail["index_faktor"] == pytest.approx(140.30 / 133.88, abs=1e-4)
    assert "MEDIAN" not in " ".join(result["warnings"])
