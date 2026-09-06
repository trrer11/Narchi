"""§96 — Preisspiegel : écrire les observations, calculer min/médiane/max.

Deux responsabilités, zéro magie :

1. ``record_observations`` est appelé par §95 (to-library) avec les
   lignes ACCEPETÉES du pipeline §50 — une position « ohne EP » ne
   produit JAMAIS d'observation (on n'observe pas un prix absent).
   Idempotent via la contrainte (tenant_id, offer_id, oz).
2. ``spiegel_for_tenant`` regroupe par OZ et calcule n / min / médiane /
   max. La médiane d'un nombre PAIR d'observations est la moyenne des
   deux valeurs centrales arrondie au centime **Half-Up** (usage
   commercial, jamais l'arrondi bancaire silencieux) — règle épinglée
   par test. Le tri d'affichage est NUMÉRIQUE par segments d'OZ (même
   convention que §92), les OZ non numériques à la fin par ordre
   alphabétique — dit dans le hinweis servi.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.estimation.office_price_import import ImportedPrice
from app.models.price_observation import PriceObservation
from app.services.offer_compare import normalize_oz_for_match

MAX_OBSERVATIONS_READ = 20_000   # borne de lecture — un bureau n'a pas 20 001 prix
SPIEGEL_CAP = 200                # lignes max servies à l'écran — dit dans le hinweis
_CENT = Decimal("1")


def median_cents(values: Iterable[int]) -> Optional[int]:
    """Médiane en centimes entiers ; pair → moyenne des 2 centraux, Half-Up."""
    ordered = sorted(int(v) for v in values)
    if not ordered:
        return None
    mid = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[mid]
    mean = (Decimal(ordered[mid - 1]) + Decimal(ordered[mid])) / 2
    return int(mean.quantize(_CENT, rounding=ROUND_HALF_UP))


def record_observations(
    db: Session,
    *,
    tenant_id: str,
    offer_id: str,
    company_name: str,
    source_label: str,
    preisstand_jahr: int,
    accepted: List[ImportedPrice],
    taken_by: Optional[str],
    taken_at: datetime,
) -> int:
    """Inscrit les observations (idempotent). Retourne le nombre AJOUTÉ."""
    existing = {
        row[0]
        for row in db.execute(
            select(PriceObservation.oz).where(
                PriceObservation.tenant_id == tenant_id,
                PriceObservation.offer_id == offer_id,
            )
        )
    }
    added = 0
    for price in accepted:
        if price.oz in existing:
            continue
        ep_cents = int(
            (price.einheitspreis_netto * 100).quantize(_CENT, rounding=ROUND_HALF_UP)
        )
        db.add(PriceObservation(
            id=uuid.uuid4().hex,
            tenant_id=tenant_id,
            offer_id=offer_id,
            oz=price.oz[:64],
            kurztext=price.kurztext[:500],
            einheit=(price.einheit or "")[:24],
            ep_cents=ep_cents,
            preisstand_jahr=preisstand_jahr,
            source_label=source_label,
            company_name=company_name[:200],
            taken_by=taken_by,
            taken_at=taken_at,
        ))
        added += 1
    db.commit()
    return added


def delete_observations_of_offer(db: Session, *, tenant_id: str, offer_id: str) -> int:
    """Suppression croisée honnête : la pièce part, ses observations aussi."""
    rows = db.execute(
        select(PriceObservation).where(
            PriceObservation.tenant_id == tenant_id,
            PriceObservation.offer_id == offer_id,
        )
    ).scalars().all()
    for row in rows:
        db.delete(row)
    db.commit()
    return len(rows)


def spiegel_for_tenant(db: Session, *, tenant_id: str) -> dict:
    """Regroupe par OZ : n/min/médiane/max + dernière provenance.

    Ne sert QUE les OZ avec ≥ 2 observations — une moyenne d'un seul
    chiffre serait une fausse précision ; le nombre d'OZ à observation
    unique est servi et dit dans le hinweis.
    """
    rows = db.execute(
        select(PriceObservation)
        .where(PriceObservation.tenant_id == tenant_id)
        .order_by(PriceObservation.oz.asc(), PriceObservation.taken_at.asc(),
                  PriceObservation.id.asc())
        .limit(MAX_OBSERVATIONS_READ)
    ).scalars().all()

    groups: dict = {}
    for row in rows:
        group = groups.setdefault(row.oz, [])
        group.append(row)

    items: List[dict] = []
    single_oz_count = 0
    for oz, obs in groups.items():
        if len(obs) < 2:
            single_oz_count += 1
            continue
        values = [o.ep_cents for o in obs]
        latest = max(obs, key=lambda o: (o.taken_at, o.id))
        items.append({
            "oz": oz,
            "kurztext": latest.kurztext,
            "einheit": latest.einheit,
            "n": len(obs),
            "min_cents": min(values),
            "median_cents": median_cents(values),
            "max_cents": max(values),
            "latest_ep_cents": latest.ep_cents,
            "latest_company": latest.company_name,
            "latest_jahr": latest.preisstand_jahr,
            "latest_source": latest.source_label,
            # §97 — Jahrgänge du lot : les min/max sont des valeurs BRUTES
            # par année ; l'écran le dit quand les millésimes diffèrent.
            "min_jahr": min(o.preisstand_jahr for o in obs),
            "max_jahr": max(o.preisstand_jahr for o in obs),
        })

    def _sort_key(item: dict):
        key = normalize_oz_for_match(item["oz"])
        return (0, key) if key is not None else (1, item["oz"])

    items.sort(key=_sort_key)
    capped = len(items) > SPIEGEL_CAP
    items = items[:SPIEGEL_CAP]
    return {
        "items": items,
        "total_observations": len(rows),
        "single_oz_count": single_oz_count,
        "capped": capped,
        "hinweis": (
            "Nur Positionen mit mindestens 2 Beobachtungen aus übernommenen "
            "Angeboten. Median kaufmännisch gerundet (Half-Up). Wird ein "
            "Angebot gelöscht, verschwinden auch seine Beobachtungen — "
            "die Herkunft bleibt immer nachvollziehbar."
        ),
    }
