"""
NARCHI V5 — Révision des prix selon le Baupreisindex Destatis.

Synchronise les indices officiels du marché allemand via l'API GENESIS
du Statistisches Bundesamt (tables 61261 : Preisindizes für die
Bauwirtschaft, base 2021 = 100).
"""
from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal
from typing import Dict

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from .price_database import PriceIndexHistory

logger = logging.getLogger("narchi.price_revision")


class DestatisIndexSynchronizer:
    """Synchronise les Baupreisindizes officiels depuis GENESIS-Online.

    Codes d'indices suivis (table 61261 du Destatis) :
      - WOHNBAU      : Wohngebäudebau (Bauleistungen am Bauwerk)
      - BUEROBAU     : Bürogebäude
      - BETRIEBSBAU  : Gewerbliche Betriebsgebäude
      - STRASSENBAU  : Tiefbau Straßen (contrats VOB relevant)
    """

    GENESIS_API_BASE = "https://www-genesis.destatis.de/genesisWS/rest/2020"
    GENESIS_TABLE = "61261"
    INDEX_SERIES: Dict[str, str] = {
        "WOHNBAU": "61261-0001",
        "BUEROBAU": "61261-0002",
        "BETRIEBSBAU": "61261-0003",
        "STRASSENBAU": "61261-0004",
    }

    def __init__(self, genesis_token: str, session: AsyncSession):
        # Jeton GENESIS-Online (inscription gratuite au Destatis requise).
        self.token = genesis_token
        self.session = session

    async def sync_all_indices(self) -> Dict[str, int]:
        results: Dict[str, int] = {}
        async with httpx.AsyncClient(timeout=30) as client:
            for index_code, series_id in self.INDEX_SERIES.items():
                try:
                    count = await self._sync_single_index(client, index_code, series_id)
                    results[index_code] = count
                    logger.info("Baupreisindex %s : %d Werte synchronisiert", index_code, count)
                except Exception as error:  # réseau/quota : un indice ne bloque pas les autres
                    logger.error("Fehler beim Sync %s: %s", index_code, error)
                    results[index_code] = -1
        return results

    async def _sync_single_index(
        self, client: httpx.AsyncClient, index_code: str, series_id: str
    ) -> int:
        start_year = date.today().year - 5
        response = await client.get(
            f"{self.GENESIS_API_BASE}/data/timeseries",
            params={
                "username": self.token,
                "name": series_id,
                "startyear": str(start_year),
                "language": "de",
            },
        )
        response.raise_for_status()
        payload = response.json()

        # Structure GENESIS : content -> time slices avec year/month.
        timeseries = payload.get("Object", {})
        count = 0
        for quarter in timeseries.get("Content", "").split(";"):
            try:
                period, value = quarter.split(",")
                year, month = period.split("-")
                ref_date = date(int(year), int(month), 1)
                existing = await self.session.get(
                    PriceIndexHistory,
                    {"index_code": index_code, "reference_date": ref_date},
                )
                if not existing:
                    entry = PriceIndexHistory(
                        index_code=index_code,
                        index_name=f"Baupreisindex {index_code}",
                        reference_date=ref_date,
                        index_value=Decimal(str(value)),
                    )
                    self.session.add(entry)
                    count += 1
            except (ValueError, TypeError) as error:
                logger.warning("Beobachtung %r übersprungen: %s", quarter, error)
        await self.session.commit()
        return count


def apply_price_revision(
    base_price: Decimal,
    base_index: Decimal,
    current_index: Decimal,
) -> Decimal:
    """Formule de révision allemande : P = P0 × (I / I0).

    Usage contractuel : Preisgleitklausel selon VOB/B § 7 et BGB § 650f
    pour les marchés > 4 mois (Vertragslaufzeit).
    """
    if base_index <= 0:
        return base_price
    return (base_price * (current_index / base_index)).quantize(Decimal("0.0001"))
