"""§95 — « Preis-Spiegel » : la Preisbibliothek apprend des offres RÉELLES.

Idée validée par le client (10.08.2026) : les prix qui fondent la
bibliothèque du bureau doivent venir des pièces que le bureau POSSÈDE —
ses offres d'entreprises importées (§91) — avec leur provenance, et NON
d'une base externe quelconque. C'est exactement la méthode des
éditeurs payants (collecter du réel), sauf qu'ici la data reste CHEZ le
bureau, dans SON installation (aucune mutualisation entre tenants —
ce ne sera jamais vendu, promis et vrai).

Le point capital : **zéro nouveau code d'écriture**. Les items d'une
offre stockée ({oz, title, qty, unit, up_cents, it_cents}) sont traduits
en ``ImportResult`` de §50 et passent par ``commit_import`` — l'upsert
idempotent éprouvé de la Preisbibliothek. Conséquences héritées, toutes
déjà testées §49/§50 :

- ``preisstand_jahr`` = ANNÉE DE L'OFFRE (le prix vaut à sa date
  d'offre) → la fortgeschriebene Anzeige Destatis 61261 existante
  l'indexe vers l'année courante, facteur affiché, badge Regel ;
- ``kostengruppe`` détectée par les mêmes règles sans ambiguïté
  (jamais devinée : ambigu → None) ;
- source_kind = « offer » → la page Preisbibliothek affiche et permet
  la suppression par lot (mécanisme existant, par source_file) ;
- source_file = « Angebot: {Firma} · {Raum} · {JJJJ-MM-TT} » (≤ 255) —
  la provenance est DANS la donnée (charte §36), pas dans une légende.

Refus honnêtes hérités du même esprit que §91/§93 :
- position « ohne EP » → comptée comme sautée, jamais 0,00 € ;
- OZ vide → sautée (l'upsert est par OZ : une clé vide polluerait) ;
- OZ en double DANS l'offre → première gardée, la suite comptée
  (déterministe, dit dans le rapport) ;
- EP > 1 M€/unité → garde-fou de §50 réappliqué (faute de saisie).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Iterable, List

from app.core.estimation.office_price_import import (
    MAX_PRICE,
    ImportRejection,
    ImportResult,
    ImportedPrice,
    detect_kostengruppe,
)

SOURCE_KIND_OFFER = "offer"           # ≤ 8 caractères (colonne String(8))
_CENT = Decimal("0.01")


def offer_source_label(*, company_name: str, room: str, received_at: datetime) -> str:
    """Provenance lisible, déterministe, bornée (colonne 255)."""
    label = f"Angebot: {company_name} · {room} · {received_at:%Y-%m-%d}"
    return label[:255]


def prices_from_offer_items(
    items: Iterable[dict],
    *,
    preisstand_jahr: int,
) -> ImportResult:
    """Items stockés §91 → ImportResult « offer » prêt pour commit_import."""
    accepted: List[ImportedPrice] = []
    rejected: List[ImportRejection] = []
    seen_oz: set = set()
    for idx, item in enumerate(items, start=1):
        oz = str(item.get("oz") or "").strip()[:32]
        if not oz:
            rejected.append(ImportRejection(
                row=idx, oz="", reason="keine OZ — übersprungen (Upsert braucht eine Nummer).",
            ))
            continue
        if oz in seen_oz:
            rejected.append(ImportRejection(
                row=idx, oz=oz,
                reason="OZ doppelt im Angebot — erste Zeile übernommen, diese übersprungen.",
            ))
            continue
        seen_oz.add(oz)
        up_cents = item.get("up_cents")
        if up_cents is None:
            rejected.append(ImportRejection(
                row=idx, oz=oz,
                reason="ohne EP — übersprungen, kein Preis wird erfunden.",
            ))
            continue
        ep = (Decimal(int(up_cents)) / 100).quantize(_CENT)
        if ep > MAX_PRICE:
            rejected.append(ImportRejection(
                row=idx, oz=oz,
                reason=f"EP über {MAX_PRICE} € — Plausibilitätsgrenze (Tippfehler?)",
            ))
            continue
        kurztext = (str(item.get("title") or "").strip() or f"Position {oz}")[:500]
        einheit = (str(item.get("unit") or "").strip() or "")[:24]
        kg, confiance = detect_kostengruppe(kurztext)
        accepted.append(ImportedPrice(
            oz=oz,
            kurztext=kurztext,
            einheit=einheit,
            einheitspreis_netto=ep,
            preisstand_jahr=preisstand_jahr,
            kostengruppe=kg,
            kg_confiance=confiance,
        ))
    return ImportResult(kind=SOURCE_KIND_OFFER, accepted=accepted, rejected=rejected)
