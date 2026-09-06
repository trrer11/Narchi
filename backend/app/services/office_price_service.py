"""
§50 — Service bibliothèque de prix du bureau.

Persistance cloisonnée par tenant (upsert idempotent par OZ) + résolution
de prix pour le moteur d'estimation : PRIX DU BUREAU (indexé Destatis vers
l'année courante) PRIME sur le Richtwert marché. Tout est traçable (§36).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.estimation.destatis_index import INDEX_SOURCE, index_for_year, year_factor_for
from app.core.estimation.office_price_import import ImportedPrice, ImportResult
from app.models.office_price import OfficePrice
from app.services.price_observations import median_cents  # §96 — règle éprouvée

_CENT = Decimal("0.01")
_4DP = Decimal("0.0001")


def _q2(value: Decimal) -> Decimal:
    return value.quantize(_CENT, rounding=ROUND_HALF_UP)


def current_index_year() -> int:
    """Année cible d'indexation = année du dernier point Destatis publié."""
    from app.core.estimation.destatis_index import yearly_index

    return max(yearly_index().keys())


@dataclass
class CommitStats:
    inserted: int
    updated: int
    total_active: int
    # §97 — lignes REFUSÉES car un millésime PLUS RÉCENT existe déjà pour
    # cette OZ (importer du 2018 sur du 2026 ne régresse jamais). Liste
    # des OZ concernées, triée — remontée dans le rapport d'import.
    skipped_veraltet: Optional[List[str]] = None


def commit_import(db: Session, *, tenant_id: str, user_id: str,
                  source_file: str, result: ImportResult) -> CommitStats:
    """Écrit les prix acceptés. Réimport du même OZ = mise à jour (idempotent).

    §97 — règle du millésime (« Preisstand-Wahrheit ») : à OZ égale, une
    ligne au millésime PLUS ANCIEN que l'existante est refusée et comptée
    (skipped_veraltet) ; même millésime ou plus récent → remplace. Jamais
    de régression silencieuse vers un ancien Preisstand."""
    inserted = 0
    updated = 0

    existing_oz = set()
    existing_jahr = {}
    for oz_v, jahr_v in db.execute(
        select(OfficePrice.oz, OfficePrice.preisstand_jahr).where(
            OfficePrice.tenant_id == tenant_id
        )
    ):
        existing_oz.add(oz_v)
        existing_jahr[oz_v] = int(jahr_v)

    skipped_veraltet: List[str] = []

    if db.get_bind().dialect.name == "postgresql":
        for price in result.accepted:
            if price.oz in existing_jahr and price.preisstand_jahr < existing_jahr[price.oz]:
                skipped_veraltet.append(price.oz)  # §97 — jamais de régression
                continue
            stmt = pg_insert(OfficePrice).values(
                id=str(uuid.uuid4()),
                tenant_id=tenant_id,
                uploaded_by=user_id,
                oz=price.oz, kurztext=price.kurztext,
                einheit=price.einheit,
                einheitspreis_netto=price.einheitspreis_netto,
                preisstand_jahr=price.preisstand_jahr,
                kostengruppe=price.kostengruppe,
                kg_confiance=price.kg_confiance,
                source_file=source_file, source_kind=result.kind,
            ).on_conflict_do_update(
                constraint="uq_office_prices_tenant_oz",
                set_={
                    "kurztext": price.kurztext,
                    "einheit": price.einheit,
                    "einheitspreis_netto": price.einheitspreis_netto,
                    "preisstand_jahr": price.preisstand_jahr,
                    "kostengruppe": price.kostengruppe,
                    "kg_confiance": price.kg_confiance,
                    "source_file": source_file, "source_kind": result.kind,
                    "uploaded_by": user_id,
                },
            )
            db.execute(stmt)
            if price.oz in existing_oz:
                updated += 1
            else:
                inserted += 1
    else:
        # SQLite (tests) : upsert manuel — mêmes règles métier.
        for price in result.accepted:
            row = db.execute(
                select(OfficePrice).where(
                    OfficePrice.tenant_id == tenant_id,
                    OfficePrice.oz == price.oz,
                )
            ).scalar_one_or_none()
            if row is not None and price.preisstand_jahr < int(row.preisstand_jahr):
                skipped_veraltet.append(price.oz)  # §97 — jamais de régression
                continue
            if row is None:
                db.add(OfficePrice(
                    id=str(uuid.uuid4()), tenant_id=tenant_id, uploaded_by=user_id,
                    oz=price.oz, kurztext=price.kurztext, einheit=price.einheit,
                    einheitspreis_netto=price.einheitspreis_netto,
                    preisstand_jahr=price.preisstand_jahr,
                    kostengruppe=price.kostengruppe, kg_confiance=price.kg_confiance,
                    source_file=source_file, source_kind=result.kind,
                ))
                inserted += 1
            else:
                row.kurztext = price.kurztext
                row.einheit = price.einheit
                row.einheitspreis_netto = price.einheitspreis_netto
                row.preisstand_jahr = price.preisstand_jahr
                row.kostengruppe = price.kostengruppe
                row.kg_confiance = price.kg_confiance
                row.source_file = source_file
                row.source_kind = result.kind
                row.uploaded_by = user_id
                updated += 1

    db.commit()
    total = db.execute(
        select(OfficePrice.id).where(OfficePrice.tenant_id == tenant_id)
    ).all()
    return CommitStats(inserted=inserted, updated=updated, total_active=len(total),
                       skipped_veraltet=sorted(skipped_veraltet) or None)


@dataclass
class ResolvedOfficePrice:
    """Prix du bureau résolu pour une Kostengruppe.

    §99 — DEUX règles de sélection, jamais implicites :
    - ``einzelpreis`` (n = 1) : la seule position de la KG, indexée Destatis —
      comportement historique §50, inchangé ;
    - ``median`` (n ≥ 2, même Einheit) : médiane §96 des prix CHACUN indexé
      de son millésime vers l'année cible. Un Ausreißer (prix aberrant) ne
      tire plus l'estimation entière. Les positions de la même KG avec une
      AUTRE Einheit ne sont JAMAIS mélangées (des €/m² et des €/St ne font
      pas une statistique) : elles sont comptées dans ``n_nicht_gemischt``
      et dites à l'écran. Aucune fausse OZ n'est servie en médiane."""

    einheitspreis_netto_indiziert: Decimal
    preisstand_jahr: int                 # einzelpreis : millésime source ; median : année cible (prix déjà indexé)
    index_faktor: Optional[Decimal]      # einzelpreis : facteur Destatis ; median : None (n facteurs, aucun unique)
    oz_quelle: str                       # median : "" — jamais une OZ inventée
    kurztext_quelle: str                 # median : libellé honnête « Median aus n Büropreisen »
    auswahl: str = "einzelpreis"         # "einzelpreis" | "median"
    n_quellen: int = 1                   # positions réellement entrées dans le calcul
    einheit_quelle: Optional[str] = None
    quellen_jahr_von: Optional[int] = None   # médiane : millésimes des sources
    quellen_jahr_bis: Optional[int] = None
    n_nicht_gemischt: int = 0            # même KG, autre Einheit : écartées et DITES


def _resolve_from_kg_rows(rows: List[OfficePrice], target: int) -> Optional[ResolvedOfficePrice]:
    """Cœur §99 partagé par resolve_price_for_kg et tenant_price_map.

    1. Les lignes de la KG sont regroupées par Einheit (jamais mélangées)
       ; le groupe dominant gagne — règle déterministe : d'abord le plus
       grand nombre de lignes, à égalité le millésime maximum le plus
       récent, puis le nom d'unité (ordre alphabétique).
    2. Chaque ligne du groupe est indexée de SON millésime vers ``target``
       (pré-2020 : facteur 1 épinglé §97 — la note le dit à l'écran).
    3. n == 1 → einzelpreis (§50). n ≥ 2 → médiane au centime Half-Up
       (median_cents, même règle éprouvée que le Preisspiegel §96)."""
    if not rows:
        return None

    groups: Dict[str, List[OfficePrice]] = {}
    for row in rows:
        groups.setdefault(row.einheit or "", []).append(row)
    einheit_quelle, chosen = max(
        groups.items(),
        key=lambda kv: (
            len(kv[1]),
            max(int(r.preisstand_jahr) for r in kv[1]),
            kv[0],
        ),
    )
    n_nicht_gemischt = len(rows) - len(chosen)

    def _indexed(row: OfficePrice) -> Decimal:
        factor = year_factor_for(int(row.preisstand_jahr), target)
        return _q2(Decimal(row.einheitspreis_netto) * factor)

    if len(chosen) == 1:
        row = chosen[0]
        factor = year_factor_for(int(row.preisstand_jahr), target)
        return ResolvedOfficePrice(
            einheitspreis_netto_indiziert=_q2(Decimal(row.einheitspreis_netto) * factor),
            preisstand_jahr=int(row.preisstand_jahr),
            index_faktor=factor.quantize(_4DP),
            oz_quelle=row.oz,
            kurztext_quelle=row.kurztext,
            auswahl="einzelpreis",
            n_quellen=1,
            einheit_quelle=einheit_quelle or None,
            n_nicht_gemischt=n_nicht_gemischt,
        )

    cents = [
        int((indexed * 100).to_integral_value(rounding=ROUND_HALF_UP))
        for indexed in (_indexed(row) for row in chosen)
    ]
    med_cents = median_cents(cents)
    assert med_cents is not None  # len(chosen) ≥ 2 — jamais vide ici
    jahre = [int(row.preisstand_jahr) for row in chosen]
    return ResolvedOfficePrice(
        einheitspreis_netto_indiziert=Decimal(med_cents) / Decimal(100),
        preisstand_jahr=target,
        index_faktor=None,
        oz_quelle="",
        kurztext_quelle=f"Median aus {len(chosen)} Büropreisen",
        auswahl="median",
        n_quellen=len(chosen),
        einheit_quelle=einheit_quelle or None,
        quellen_jahr_von=min(jahre),
        quellen_jahr_bis=max(jahre),
        n_nicht_gemischt=n_nicht_gemischt,
    )


def resolve_price_for_kg(db: Session, *, tenant_id: str, kostengruppe: str,
                         ziel_jahr: Optional[int] = None) -> Optional[ResolvedOfficePrice]:
    """Retourne le prix du bureau indexé pour une KG, ou None → le moteur
    retombe alors sur le Richtwert marché (fallback HONNÊTE, jamais caché)."""
    target = ziel_jahr or current_index_year()
    rows: List[OfficePrice] = db.execute(
        select(OfficePrice).where(
            OfficePrice.tenant_id == tenant_id,
            OfficePrice.kostengruppe == kostengruppe,
        ).order_by(OfficePrice.preisstand_jahr.desc(), OfficePrice.oz.asc())
    ).scalars().all()
    return _resolve_from_kg_rows(rows, target)


def tenant_price_map(db: Session, *, tenant_id: str,
                     ziel_jahr: Optional[int] = None) -> Dict[str, ResolvedOfficePrice]:
    """Map KG → prix du bureau résolu (une passe — utilisé par /quick).

    §99 — toutes les lignes de la KG entrent dans la règle médiane ; la
    sélection « millésime le plus récent seulement » est REMPLACÉE (elle
    laissait un Ausreißer récent devenir LE prix du bureau)."""
    rows: List[OfficePrice] = db.execute(
        select(OfficePrice).where(OfficePrice.tenant_id == tenant_id)
    ).scalars().all()
    target = ziel_jahr or current_index_year()

    by_kg: Dict[str, List[OfficePrice]] = {}
    for row in rows:
        if not row.kostengruppe:
            continue
        by_kg.setdefault(row.kostengruppe, []).append(row)

    out: Dict[str, ResolvedOfficePrice] = {}
    for kg, kg_rows in by_kg.items():
        resolved = _resolve_from_kg_rows(kg_rows, target)
        if resolved is not None:
            out[kg] = resolved
    return out


def index_note(preisstand_jahr: int, index_faktor: Decimal, ziel_jahr: Optional[int] = None) -> Optional[str]:
    """Note de provenance affichée dans l'UI (§36) : « indexiert 2024→2026 (×1,0813) ».

    §97 — honnêteté pré-2020 : la série officielle chargée commence en 2020
    (base 2021 = 100) ; un millésime plus ancien NE PEUT PAS être indexé
    (year_factor_for retourne 1). Le dire explicitement plutôt qu'afficher
    le facteur « ×1 » muettement — et inviter à rafraîchir."""
    target = ziel_jahr or current_index_year()
    if preisstand_jahr == target:
        return None
    if index_for_year(preisstand_jahr) is None:
        return (f"keine Indexierung möglich (offizielle Reihe ab 2020 geladen) — "
                f"Preisstand {preisstand_jahr}, bitte auffrischen")
    return f"indexiert {preisstand_jahr}→{target} (×{index_faktor})"


__all__ = [
    "CommitStats", "ResolvedOfficePrice", "commit_import", "current_index_year",
    "index_note", "resolve_price_for_kg", "tenant_price_map", "INDEX_SOURCE",
]
