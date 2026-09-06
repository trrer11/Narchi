"""NARCHI V5 — Tests du marché allemand pour le moteur d'estimation DIN 276.

Ces tests verrouillent les invariants réglementaires et commerciaux :
- USt 19 % (§ 12 UStG), jamais de taux français
- zones tarifaires = Bundesländer/métropoles, jamais de régions françaises
- référence surfacique BGF (DIN 277)
- Kostengruppen DIN 276 à la place des lots français
"""
from __future__ import annotations

import asyncio
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest

from app.core.estimation.estimation_engine import (
    EstimationEngine, UST_SATZ_STANDARD,
)
from app.core.estimation.german_price_seed import (
    GERMAN_REFERENCE_PRICES, iter_price_items_for_region,
)
from app.core.estimation.ifc_quantifier import ElementQuantity, ProjectQuantities
from app.core.estimation.price_database import PriceRegion, WorkCategory


def _engine_without_db() -> EstimationEngine:
    """Moteur avec session factice : retombe sur les prix paramétriques."""
    session = AsyncMock()
    result = AsyncMock()
    result.scalar_one_or_none = lambda: None
    session.execute = AsyncMock(return_value=result)
    return EstimationEngine(session)


def _project_quantities() -> ProjectQuantities:
    wall = ElementQuantity(
        element_id="wall-1",
        element_type="IfcWall",
        element_name="Außenwand EG",
        level="EG",
        material="Stahlbeton",
        net_area=Decimal("120.0"),
        net_volume=Decimal("28.8"),
    )
    slab = ElementQuantity(
        element_id="slab-1",
        element_type="IfcSlab",
        element_name="Decke EG",
        level="EG",
        material="Stahlbeton",
        net_area=Decimal("200.0"),
        net_volume=Decimal("40.0"),
    )
    window = ElementQuantity(
        element_id="win-1",
        element_type="IfcWindow",
        element_name="Fenster 3-fach",
        level="EG",
        material="Kunststoff",
        net_area=Decimal("18.0"),
    )
    return ProjectQuantities(
        project_id="proj-1",
        project_name="MFH Berlin-Mitte",
        quantities_by_type={
            "IfcWall": [wall],
            "IfcSlab": [slab],
            "IfcWindow": [window],
        },
        totals={
            "IfcWall_area_m2": Decimal("120.0"),
            "IfcWall_volume_m3": Decimal("28.8"),
            "IfcSlab_area_m2": Decimal("200.0"),
            "IfcSlab_volume_m3": Decimal("40.0"),
            "IfcWindow_area_m2": Decimal("18.0"),
        },
        warnings=[],
        missing_data=[],
        total_elements=3,
    )


class TestGermanTaxAndRegions:
    def test_standard_vat_is_german_19_percent(self):
        assert UST_SATZ_STANDARD == Decimal("19.00")

    def test_no_french_regions_remain(self):
        codes = {r.value for r in PriceRegion}
        french = {"ile_de_france", "paca", "bretagne", "normandie",
                  "grand_est", "corse", "occitanie"}
        assert not (codes & french), f"Régions françaises restantes: {codes & french}"

    def test_berlin_factor_premium(self):
        factors = EstimationEngine.REGIONAL_COEFFICIENTS
        assert factors[PriceRegion.BERLIN] > factors[PriceRegion.SACHSEN]
        assert factors[PriceRegion.MUENCHEN] == Decimal("1.142")

    def test_parametric_prices_are_kg_coded(self):
        for category in EstimationEngine.PARAMETRIC_PRICES_EUR:
            assert category.startswith("kg"), f"Catégorie non-KG: {category}"


class TestGermanEstimationComputation:
    def test_netto_brutto_consistency_19_percent(self):
        engine = _engine_without_db()
        summary = asyncio.run(engine.compute_estimation(
            _project_quantities(), region=PriceRegion.BERLIN
        ))
        expected_ust = (summary.total_netto * Decimal("0.19"))
        # ±1 € de tolérance d'arrondi ligne par ligne
        assert abs(summary.total_ust - expected_ust) < Decimal("1.00")
        assert summary.total_brutto == summary.total_netto + summary.total_ust

    def test_bgf_cost_reference_not_shon(self):
        engine = _engine_without_db()
        quantities = _project_quantities()
        summary = asyncio.run(engine.compute_estimation(
            quantities, region=PriceRegion.BERLIN
        ))
        bgf = quantities.totals["IfcSlab_area_m2"]
        expected = (summary.total_netto / bgf).quantize(Decimal("0.01"))
        assert summary.kosten_pro_m2_bgf == expected
        assert summary.kosten_pro_m2_bgf > Decimal("0")

    def test_concrete_wall_priced_by_volume_vob_rule(self):
        """KG 310/320/340 : la règle VOB facture le béton au m³, pas au m²."""
        engine = _engine_without_db()
        category = engine._get_category("IfcWall", "Stahlbeton")
        wall = _project_quantities().quantities_by_type["IfcWall"][0]
        quantity, unit = engine._get_primary_quantity(wall, category)
        assert unit == "m³"
        assert quantity == Decimal("28.8")

    def test_window_maps_to_kg361(self):
        engine = _engine_without_db()
        assert engine._get_category("IfcWindow", "Kunststoff") == WorkCategory.KG361_FENSTER

    def test_backward_compatible_aliases(self):
        engine = _engine_without_db()
        summary = asyncio.run(engine.compute_estimation(
            _project_quantities(), region=PriceRegion.MUENCHEN
        ))
        assert summary.total_ht == summary.total_netto
        assert summary.total_ttc == summary.total_brutto
        assert summary.cost_per_m2_shon == summary.kosten_pro_m2_bgf


class TestGermanSeedData:
    def test_reference_prices_cover_main_kg_ranges(self):
        kgs = {row[2] for row in GERMAN_REFERENCE_PRICES}
        # Couverture minimale : structure (300) + technique (400) + extérieur (500)
        assert any(k.startswith("kg3") for k in kgs)
        assert any(k.startswith("kg4") for k in kgs)
        assert any(k.startswith("kg500") for k in kgs)

    def test_all_reference_prices_are_19_percent_and_positive(self):
        for item in iter_price_items_for_region(PriceRegion.BERLIN):
            assert str(item.tva_rate) in ("19.00", "19")
            assert Decimal(str(item.unit_price_ht)) > 0
            assert item.tenant_id is None  # bibliothèque de référence partagée

    def test_regional_factor_changes_price(self):
        berlin = {i.reference_code.split("-")[0] + "-" + i.reference_code.split("-")[1]: Decimal(str(i.unit_price_ht))
                  for i in iter_price_items_for_region(PriceRegion.BERLIN)}
        sachsen = {i.reference_code.split("-")[0] + "-" + i.reference_code.split("-")[1]: Decimal(str(i.unit_price_ht))
                   for i in iter_price_items_for_region(PriceRegion.SACHSEN)}
        code = next(iter(berlin))
        assert berlin[code] > sachsen[code]
