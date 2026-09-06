"""§92 — Angebotsvergleich : la matrice de comparaison (logique PURE).

Entrées : positions LV internes (§89) + offres importées (§91). Sortie :
UNE structure JSON prête à rendre — positions triées, meilleure offre
par ligne, écart vs EP interne, totaux et « vollständig » par offre.

Règles d'honnêteté gravées ici :

- **Matching par OZ normalisée numériquement** : l'offre padde
  (« 001.003.00010 »), le LV interne non (« 01.003.010 ») — même position,
  clés normalisées identiques. Une OZ vide ne matche jamais (pas de
  fausse fusion).
- **Position « nur im Angebot » AFFICHÉE**, jamais cachée (une entreprise
  ajoute une ligne ? Le bureau doit la voir — flag explicite).
- **Best = min EP** parmi les offres qui ONT un prix sur la ligne ;
  une seule offre chiffrée → pas de « best » (rien à comparer).
- **Total d'offre** = somme des IT présents (centimes), avec
  ``complete=False`` dès qu'une position interne n'a pas d'EP : le total
  partiel est montré mais MARQUÉ — jamais prétendu comparable.
- **Écart vs EP interne** en % à 1 décimale, seulement si l'interne a un
  prix (kein Prozent ohne Basis).
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

from app.services.money import to_cents


def normalize_oz_for_match(oz: str) -> Optional[tuple[int, ...]]:
    """OZ → tuple numérique de segments (« 001.003.00010 » → (1, 3, 10) ;
    « 01.2 » → (1, 2)). None si vide/non numérique → jamais de faux match."""
    segments = [s for s in str(oz).strip().split(".") if s != ""]
    if not segments or not all(s.isdigit() for s in segments):
        return None
    return tuple(int(s) for s in segments)


def _delta_pct(up_cents: int, internal_cents: Optional[int]) -> Optional[float]:
    if internal_cents is None or internal_cents <= 0:
        return None
    return round((up_cents - internal_cents) / internal_cents * 100, 1)


def build_comparison(
    internal_positions: Iterable[dict[str, Any]],
    offers: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    """Renvoie {rows, offers} — `offers` résumé + `rows` la matrice.

    Row : {oz, title, qty, unit, internal_up_cents, only_in_offer,
           cells: {offer_id: {up_cents, it_cents, delta_pct}},
           best_offer_id}.
    """
    internal_positions = list(internal_positions)
    offers = list(offers)

    # Index interne : clé normalisée → position (la 1re gagne si doublon —
    # dit honnêtement dans via_duplicate, jamais d'écrasement silencieux).
    internal_by_key: dict[tuple[int, ...], dict[str, Any]] = {}
    duplicates = 0
    for pos in internal_positions:
        key = normalize_oz_for_match(str(pos.get("oz", "")))
        if key is None:
            continue
        if key in internal_by_key:
            duplicates += 1
            continue
        internal_by_key[key] = pos

    # Cellules par OZ : offre_id → valeurs.
    row_map: dict[tuple[int, ...], dict[str, dict[str, Any]]] = {}
    display: dict[tuple[int, ...], dict[str, Any]] = {}
    for offer in offers:
        for item in offer["items"]:
            key = normalize_oz_for_match(str(item.get("oz", "")))
            if key is None:
                continue
            row_map.setdefault(key, {})[offer["id"]] = {
                "up_cents": item.get("up_cents"),
                "it_cents": item.get("it_cents"),
            }
            display.setdefault(key, item)

    rows = []
    for key in sorted(set(internal_by_key) | set(row_map)):
        internal = internal_by_key.get(key)
        source = internal if internal is not None else (display.get(key) or {})
        internal_up_cents = None
        if internal is not None and internal.get("unit_price") is not None:
            # §145 — centimes HALF_UP, jamais banker's rounding : 12,345 →
            # 1235 (pas 1234), 0,025 → 3 (pas 2). La décision « meilleure
            # offre » ne dérive plus d'un centime.
            internal_up_cents = to_cents(internal["unit_price"])
        cells = row_map.get(key, {})
        for offer_id, cell in cells.items():
            cell["delta_pct"] = (
                _delta_pct(cell["up_cents"], internal_up_cents)
                if cell.get("up_cents") is not None
                else None
            )
        priced = [
            (offer_id, cell["up_cents"])
            for offer_id, cell in cells.items()
            if cell.get("up_cents") is not None
        ]
        best_offer_id = None
        if len(priced) >= 2:
            best_offer_id = min(priced, key=lambda pair: pair[1])[0]
        rows.append({
            "oz": str(source.get("oz", ".".join(str(s) for s in key))),
            "title": str(source.get("title", ""))[:300],
            "qty": float(source.get("qty", 0) or 0),
            "unit": str(source.get("unit", ""))[:12],
            "internal_up_cents": internal_up_cents,
            "only_in_offer": internal is None,
            "cells": cells,
            "best_offer_id": best_offer_id,
        })

    offer_summary: list[dict[str, Any]] = []
    for offer in offers:
        items_by_key: dict[tuple[int, ...], dict[str, Any]] = {}
        for item in offer["items"]:
            key = normalize_oz_for_match(str(item.get("oz", "")))
            if key is not None:
                items_by_key.setdefault(key, item)
        missing = 0
        for key in internal_by_key:
            matched = items_by_key.get(key)
            if matched is None or matched.get("up_cents") is None:
                missing += 1
        ohne = sum(1 for it in offer["items"] if it.get("up_cents") is None)
        offer_summary.append({
            "id": offer["id"],
            "company_name": offer["company_name"],
            "dp": (offer.get("dp") or "").strip()[:4],
            "ohne_ep": ohne,
            "missing_internal": missing,
            "complete": ohne == 0 and missing == 0,
            "total_cents": sum(it.get("it_cents") or 0 for it in offer["items"]),
        })

    return {"rows": rows, "offers": offer_summary, "duplicate_internal_oz": duplicates}
