"""Tests du chaînon « pivot → Kostengruppen » (estimation éclair DIN 276).

Vérifie le mapping IFC → KG, l'agrégation « bulk link », la régionalisation
des prix, la TVA 19 %, la fourchette et le score de plausibilité — le tout
sans base (chemin synchrone).
"""

from decimal import Decimal

import pytest

from app.core.estimation.price_database import PriceRegion, WorkCategory
from app.core.estimation.quick_estimate import QuickElement, estimate_quick


def wall(**overrides) -> QuickElement:
    base = dict(
        ifc_type="IfcWall",
        name="AW Stahlbeton 24cm",
        level="EG",
        material_hint="Stahlbeton",
        net_area=Decimal("10.0"),
        net_volume=Decimal("2.4"),
        net_length=None,
        count=1,
        confidence=0.9,
    )
    base.update(overrides)
    return QuickElement(**base)


def test_mur_beton_kg320_volume_et_prix_regionalise():
    result = estimate_quick([wall()], PriceRegion.MUENCHEN)
    (line,) = result["lines"]
    assert line["kostengruppe"] == WorkCategory.KG320_ROHBAU_WAENDE
    assert line["einheit"] == "m³"  # règle VOB : le béton au m³
    assert line["menge"] == pytest.approx(2.4)
    # 178 €/m³ × Regionalfaktor München 1.142 = 203.28 €/m³
    assert line["einheitspreis_netto"] == pytest.approx(203.28, abs=0.01)
    assert line["gesamt_netto"] == pytest.approx(2.4 * 203.28, abs=0.02)


def test_agregation_bulk_link_n_elements_une_position():
    elements = [wall(name="AW-1"), wall(name="AW-2"), wall(name="AW-3")]
    result = estimate_quick(elements, PriceRegion.NIEDERSACHSEN)
    (line,) = result["lines"]
    assert line["anzahl_elemente"] == 3
    assert line["menge"] == pytest.approx(3 * 2.4)
    assert line["beispiele"] == ["AW-1", "AW-2", "AW-3"]


def test_cloison_trockenbau_kg330_a_la_surface():
    trockenbau = wall(
        ifc_type="IfcWall", name="Trennwand Gipskarton", material_hint="Gipskarton",
        net_area=Decimal("12.5"), net_volume=Decimal("1.6"),
    )
    result = estimate_quick([trockenbau], PriceRegion.BERLIN)
    (line,) = result["lines"]
    assert line["kostengruppe"] == WorkCategory.KG330_INNENWAENDE
    assert line["einheit"] == "m²"  # cloison : règle surface, pas volume
    assert line["menge"] == pytest.approx(12.5)


def test_totaux_tva_19_et_fourchette():
    result = estimate_quick([wall()], PriceRegion.NIEDERSACHSEN)
    totals = result["totals"]
    assert totals["ust_satz"] == pytest.approx(19.0)
    assert totals["ust"] == pytest.approx(totals["netto"] * 0.19, abs=0.02)
    assert totals["brutto"] == pytest.approx(totals["netto"] + totals["ust"], abs=0.02)
    assert result["range"]["low"] == pytest.approx(totals["netto"] * 0.86, abs=0.02)
    assert result["range"]["high"] == pytest.approx(totals["netto"] * 1.14, abs=0.02)


def test_score_plausibilite_borne_et_ordre():
    bon = estimate_quick([wall(confidence=0.95)], PriceRegion.NIEDERSACHSEN)
    assert 0 <= bon["score"]["value"] <= 100
    assert bon["score"]["value"] >= 85  # mapping précis + métré exploitable
    assert bon["score"]["grade"] == "A"

    inconnu = QuickElement(ifc_type="IfcBidon", name="???", net_area=None, count=0, confidence=0.3)
    degrade = estimate_quick([inconnu, wall()], PriceRegion.NIEDERSACHSEN)
    assert degrade["score"]["value"] < bon["score"]["value"]
    assert any("übersprungen" in w for w in degrade["warnings"])


def test_kosten_pro_m2_quand_bgf_fourni():
    result = estimate_quick([wall()], PriceRegion.NIEDERSACHSEN, bgf_m2=Decimal("120"))
    assert result["totals"]["kosten_pro_m2"] == pytest.approx(
        result["totals"]["netto"] / 120, abs=0.02
    )


def test_sans_bgf_pas_de_reference_surfacique():
    result = estimate_quick([wall()], PriceRegion.NIEDERSACHSEN)
    assert result["totals"]["kosten_pro_m2"] is None


def test_type_inconnu_agregat_kg300_et_avertissement():
    inconnu = QuickElement(
        ifc_type="IfcWhatever", name="Mystère", net_area=Decimal("5.0"), count=1
    )
    result = estimate_quick([inconnu], PriceRegion.NIEDERSACHSEN)
    (line,) = result["lines"]
    assert line["kostengruppe"] == WorkCategory.KG300_BAUWERK
    assert any("KG 300" in w for w in result["warnings"])
