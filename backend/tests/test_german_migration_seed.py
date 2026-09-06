"""NARCHI V6 — Intégrité des données de la migration 20260805_02.

PostgreSQL n'est pas requis ici : on vérifie purement la cohérence des
données embarquées (codes, facteurs, couverture KG) avec le moteur.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic" / "versions" / "20260805_02_german_price_engine_seed.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("migration_20260805_02", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


class TestMigrationChain:
    def test_revision_links_to_live_head(self):
        migration = _load_migration()
        assert migration.revision == "20260805_02"
        assert migration.down_revision == "20260715_01"


class TestRegionSeeds:
    def test_every_orm_region_is_seeded_once(self):
        from app.core.estimation.price_database import PriceRegion
        migration = _load_migration()
        seeded = {row[1] for row in migration.DE_REGIONS}
        assert seeded == {r.value for r in PriceRegion}

    def test_region_codes_fit_varchar10(self):
        migration = _load_migration()
        for row in migration.DE_REGIONS:
            code = row[0]
            assert len(code) <= 10, f"Code trop long pour VARCHAR(10): {code}"

    def test_cost_indices_match_engine_coefficients(self):
        from decimal import Decimal
        from app.core.estimation.estimation_engine import EstimationEngine
        from app.core.estimation.price_database import PriceRegion
        migration = _load_migration()
        factors = {
            region.value: coeff
            for region, coeff in EstimationEngine.REGIONAL_COEFFICIENTS.items()
        }
        for (_code, region_orm, _bl, _st, _nd, _nf, cost, *_rest) in migration.DE_REGIONS:
            assert region_orm in factors
            assert Decimal(cost) == factors[PriceRegion(region_orm)], (
                f"Divergence {region_orm}: migration {cost} vs moteur {factors[region_orm]}"
            )

    def test_no_french_region_codes(self):
        migration = _load_migration()
        codes = {row[0] for row in migration.DE_REGIONS}
        assert not (codes & {"IDF", "PACA", "BRETAGNE", "NORMANDIE"})


class TestKgAndPriceSeeds:
    def test_every_seed_category_has_kg_display(self):
        from app.core.estimation.german_price_seed import GERMAN_REFERENCE_PRICES
        migration = _load_migration()
        for row in GERMAN_REFERENCE_PRICES:
            category = row[2]
            assert category in migration.KG_DISPLAY, f"KG_DISPLAY manquant: {category}"
            assert migration.KG_DISPLAY[category][0].startswith("KG ")

    def test_engine_covers_all_seeded_categories(self):
        from app.core.estimation.estimation_engine import EstimationEngine
        from app.core.estimation.german_price_seed import GERMAN_REFERENCE_PRICES
        for row in GERMAN_REFERENCE_PRICES:
            category = row[2]
            assert category in EstimationEngine.PARAMETRIC_PRICES_EUR, (
                f"Catégorie seedée sans prix paramétrique moteur: {category}"
            )
