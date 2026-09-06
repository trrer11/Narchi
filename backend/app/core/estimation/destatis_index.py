"""
§50 — Indice Destatis officiel (61261-0002, bpr110), base 2021 = 100, inkl. USt.
Publication du 10.07.2026.

Miroir backend de la même série que le frontend (src/data/destatisIndex.ts) —
UNE série par couche, épinglée par des tests des DEUX côtés avec les mêmes
valeurs officielles. Sert à indexer les prix du bureau (Preisstand JJJJ) vers
l'année courante : méthode standard des ingénieurs coûts (Preisspiegelung).
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, List, Optional, Tuple

# (année, trimestre) → indice officiel, 1 décimale. Stand 10.07.2026.
_QUARTERLY: List[Tuple[int, int, Decimal]] = [
    (2021, 1, Decimal("96.7")), (2021, 2, Decimal("99.5")),
    (2021, 3, Decimal("101.6")), (2021, 4, Decimal("102.2")),
    (2022, 1, Decimal("108.2")), (2022, 2, Decimal("112.1")),
    (2022, 3, Decimal("112.7")), (2022, 4, Decimal("113.1")),
    (2023, 1, Decimal("114.7")), (2023, 2, Decimal("115.7")),
    (2023, 3, Decimal("115.9")), (2023, 4, Decimal("116.2")),
    (2024, 1, Decimal("128.5")), (2024, 2, Decimal("129.4")),
    (2024, 3, Decimal("130.3")), (2024, 4, Decimal("130.8")),
    (2025, 1, Decimal("132.6")), (2025, 2, Decimal("133.6")),
    (2025, 3, Decimal("134.3")), (2025, 4, Decimal("135.0")),
    (2026, 1, Decimal("137.0")), (2026, 2, Decimal("140.3")),
]

INDEX_STAND = "10.07.2026"
INDEX_SOURCE = "Destatis 61261-0002 (bpr110), Basis 2021=100, inkl. USt"

# Facteur de rétrocétion base 2021 → base 2020 (Wechsel Genesis,
# Jahresdurchschnitt 2021 base 2020 = 112,7).
_RETRO_2021_TO_2020 = Decimal("1.127")

_CENT = Decimal("0.01")


def _q2(value: Decimal) -> Decimal:
    return value.quantize(_CENT, rounding=ROUND_HALF_UP)


def index_for_year(year: int) -> Optional[Decimal]:
    """Indice annuel : moyenne des 4 trimestres si complets, dernier point
    publié pour l'année en cours, 2020 rétrocédé ; None avant 2020."""
    if year < 2020:
        return None
    if year == 2020:
        return _q2(Decimal("100") / _RETRO_2021_TO_2020)  # 88,73
    points = [v for (y, _q, v) in _QUARTERLY if y == year]
    if len(points) >= 4:
        return _q2(sum(points) / Decimal(len(points)))
    if points:
        return points[-1]
    return None


def yearly_index() -> Dict[int, Decimal]:
    """Table annuelle 2020..(dernière année couverte)."""
    out: Dict[int, Decimal] = {}
    last_year = max(y for (y, _q, _v) in _QUARTERLY)
    for year in range(2020, last_year + 1):
        value = index_for_year(year)
        if value is not None:
            out[year] = value
    return out


def year_factor_for(base_year: int, target_year: int) -> Decimal:
    """Facteur multiplicatif base → cible, plafonné ±40 % (au-delà le
    référentiel est trop vieux : l'estimation doit le dire, pas extrapoler).
    Retourne 1 si une année n'est pas supportée."""
    base = index_for_year(base_year)
    target = index_for_year(target_year)
    if base is None or target is None or base <= 0:
        return Decimal("1")
    factor = target / base
    return max(Decimal("0.6"), min(Decimal("1.4"), factor))
