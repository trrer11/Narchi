#!/usr/bin/env python3
"""Provisionne migrations, abonnements et référentiel allemand sans shell externe."""

from __future__ import annotations

from alembic import command
from alembic.config import Config

from app.config import settings
from app.database import SessionLocal
from app.models.german_price import (
    DeBuildingBenchmark2026,
    DeLaborRate2026,
    DeMaterialPrice2026,
    DePriceIndex2026,
    DePriceItem2026,
    DeRegion2026,
)
from app.models.subscription import SubscriptionPlan
from app.scripts.import_german_prices_2026 import import_all
from app.scripts.seed_subscriptions import seed_subscriptions


def main() -> None:
    alembic_config = Config(str(settings.BASE_DIR / "alembic.ini"))
    command.upgrade(alembic_config, "head")
    seed_subscriptions()
    import_all()

    db = SessionLocal()
    try:
        counts = {
            "regions": db.query(DeRegion2026).count(),
            "indices": db.query(DePriceIndex2026).count(),
            "labor_rates": db.query(DeLaborRate2026).count(),
            "materials": db.query(DeMaterialPrice2026).count(),
            "benchmarks": db.query(DeBuildingBenchmark2026).count(),
            "price_items": db.query(DePriceItem2026).count(),
            "plans": db.query(SubscriptionPlan).count(),
        }
    finally:
        db.close()

    print("NARCHI V5 — Référentiel allemand prêt")
    for label, count in counts.items():
        print(f"  {label}: {count}")


if __name__ == "__main__":
    main()
