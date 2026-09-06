"""Estimation éclair « pivot → Kostengruppen » (takeoff navigateur → BOQ DIN 276).

Module synchrone, sans session SQL : il réutilise le mapping IFC → Kostengruppe,
les prix paramétriques 2026 et les Regionalfaktoren du moteur principal
sans Dupliquer de données tarifaires.

Le grouping suit le pattern « bulk link » du métier : N éléments IFC du même
Gewerk n'ont pas vocation à produire N lignes de devis — on agrège leurs
métrés en UNE position par (Kostengruppe, unité), avec le nombre d'éléments
contributeurs, puis on applique le prix unitaire régionalisé.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional, Tuple

from app.core.estimation.estimation_engine import EstimationEngine, UST_SATZ_STANDARD
from app.core.estimation.price_database import PriceRegion, WorkCategory

CENT = Decimal("0.01")
FOURCHETTE_BASSE = Decimal("0.86")
FOURCHETTE_HAUTE = Decimal("1.14")

# Libellés de positions (allemand, usage devis) — dictionnaire NARCHI.
KG_TITEL: Dict[str, str] = {
    WorkCategory.KG210_BAU_GRUND: "Baugrubenarbeiten",
    WorkCategory.KG300_BAUWERK: "Bauwerk (Sammelposition)",
    WorkCategory.KG310_GRUENDUNG: "Gründung (Fundamente, Pfähle)",
    WorkCategory.KG320_ROHBAU_WAENDE: "Tragende Wände (Rohbau)",
    WorkCategory.KG330_INNENWAENDE: "Innenwände (Trockenbau)",
    WorkCategory.KG340_DECKEN: "Decken und Stützen",
    WorkCategory.KG350_DACHWERK: "Dachkonstruktion",
    WorkCategory.KG360_DACHHAUT: "Dachhaut / Dachdeckung",
    WorkCategory.KG361_FENSTER: "Fenster und Außentüren",
    WorkCategory.KG362_INNENTUEREN: "Innentüren",
    WorkCategory.KG363_BELAEGE_WAND: "Wandbekleidungen",
    WorkCategory.KG364_BELAEGE_BODEN: "Bodenbeläge",
    WorkCategory.KG365_WAERMEDAEMMUNG: "Wärmedämmung (WDVS)",
    WorkCategory.KG366_TREPPEN: "Treppen und Geländer",
    WorkCategory.KG367_STAHLBAU: "Stahlbau",
    WorkCategory.KG368_HOLZBAU: "Holzbau",
    WorkCategory.KG400_TGA: "Technische Anlagen (Sammelposition)",
    WorkCategory.KG410_ABWASSER: "Abwasser- und Sanitäranlagen",
    WorkCategory.KG420_HEIZUNG: "Heizungsanlagen",
    WorkCategory.KG430_LUEFTUNG: "Lüftungsanlagen",
    WorkCategory.KG440_ELEKTRO: "Elektroanlagen",
    WorkCategory.KG500_AUSSENANLAGEN: "Außenanlagen",
}

# Méthodes synchrones et sans requête (mapping, choix d'unité, prix
# paramétrique) — la session n'est sollicitée par AUCUN de ces chemins.
_ENGINE = EstimationEngine(session=None)


def _q(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass
class QuickElement:
    """Métré d'un élément IFC transmis par le Worker navigateur."""

    ifc_type: str
    name: str = ""
    level: str = ""
    material_hint: str = ""
    net_area: Optional[Decimal] = None
    net_volume: Optional[Decimal] = None
    net_length: Optional[Decimal] = None
    count: int = 1
    confidence: float = 0.8


@dataclass
class BoqLine:
    """Position de devis agrégée (N éléments → 1 ligne)."""

    kostengruppe: str
    titel: str
    menge: Decimal
    einheit: str
    einheitspreis_netto: Decimal
    gesamt_netto: Decimal
    anzahl_elemente: int
    beispiele: List[str] = field(default_factory=list)


@dataclass
class PlausibilityScore:
    """Score de plausibilité 0-100 (mise à jour « live » côté affichage).

    - 40 pts : couverture de mapping précis (hors agrégat fallback KG300) ;
    - 40 pts : métrés réellement exploitables (quantité > 0) ;
    - 20 pts : confiance moyenne déclarée par le parseur.
    """

    value: int
    grade: str
    mapping_coverage: float
    quantity_coverage: float
    avg_confidence: float


def _score_grade(value: int) -> str:
    if value >= 85:
        return "A"
    if value >= 70:
        return "B"
    if value >= 55:
        return "C"
    return "D"


def estimate_quick(
    elements: List[QuickElement],
    region: PriceRegion,
    bgf_m2: Optional[Decimal] = None,
    tenant_price_resolver: Any = None,
) -> Dict[str, Any]:
    """Agrège les métrés en positions BOQ DIN 276 et chiffre au regionalfaktor.

    §50 — ``tenant_price_resolver`` (optionnel) : callable ``(kostengruppe) ->
    ResolvedOfficePrice | None``. S'il fournit un prix du bureau pour une KG,
    celui-ci PRIME sur le Richtwert marché — chaque ligne concernée porte alors
    la provenance (OZ source, millésime, facteur d'indexation Destatis, §36).
    """

    groups: Dict[Tuple[str, str], Dict[str, Any]] = {}
    mapped_precise = 0
    usable_qty = 0
    confidences: List[float] = []
    skipped_without_qty = 0
    office_kgs: Dict[str, Any] = {}  # kg → ResolvedOfficePrice (provenance §50)

    for element in elements:
        hints = f"{element.material_hint} {element.name}".strip()
        category = _ENGINE._get_category(element.ifc_type, hints)
        if category != WorkCategory.KG300_BAUWERK:
            mapped_precise += 1
        menge, einheit = _ENGINE._get_primary_quantity(element, category)
        if menge is None or menge <= 0:
            skipped_without_qty += 1
            continue
        usable_qty += 1
        confidences.append(max(0.0, min(1.0, element.confidence)))

        # §50 — PRIORITÉ au prix du bureau (déjà indexé Destatis) ; jamais
        # inventé : si aucun prix tenant n'existe, le Richtwert prime.
        office_price = (
            tenant_price_resolver(category) if tenant_price_resolver is not None else None
        )
        if office_price is not None:
            unit_price: Decimal = office_price.einheitspreis_netto_indiziert
            office_kgs[category] = office_price
        else:
            price = _ENGINE._get_parametric_price(category, region)
            unit_price = price["unit_price_ht"]

        key = (category, einheit)
        group = groups.setdefault(
            key,
            {
                "menge": Decimal(0),
                "gesamt": Decimal(0),
                "anzahl": 0,
                "beispiele": [],
                "einheitspreis": unit_price,
            },
        )
        group["menge"] += menge
        group["gesamt"] += menge * unit_price
        group["anzahl"] += 1
        label = element.name.strip() or element.ifc_type
        if label not in group["beispiele"] and len(group["beispiele"]) < 3:
            group["beispiele"].append(label)

    lines: List[BoqLine] = []
    office_netto = Decimal(0)  # part des positions tarifées au prix du bureau
    for (category, einheit), group in sorted(groups.items(), key=lambda item: item[0][0]):
        menge = group["menge"]
        if category in office_kgs:
            office_netto += group["gesamt"]
        lines.append(
            BoqLine(
                kostengruppe=category,
                titel=KG_TITEL.get(category, category),
                menge=_q(menge),
                einheit=einheit,
                einheitspreis_netto=group["einheitspreis"],
                gesamt_netto=_q(group["gesamt"]),
                anzahl_elemente=group["anzahl"],
                beispiele=group["beispiele"],
            )
        )

    total_netto = _q(sum((line.gesamt_netto for line in lines), Decimal(0)))
    total_ust = _q(total_netto * UST_SATZ_STANDARD / 100)
    total_brutto = _q(total_netto + total_ust)

    kosten_pro_m2: Optional[Decimal] = None
    if bgf_m2 is not None and bgf_m2 > 0:
        kosten_pro_m2 = _q(total_netto / bgf_m2)

    total = max(len(elements), 1)
    quantity_coverage = usable_qty / total
    mapping_coverage = mapped_precise / total
    avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0
    score_value = int(
        round(mapping_coverage * 40 + quantity_coverage * 40 + avg_confidence * 20)
    )
    score_value = max(0, min(100, score_value))
    score = PlausibilityScore(
        value=score_value,
        grade=_score_grade(score_value),
        mapping_coverage=round(mapping_coverage, 3),
        quantity_coverage=round(quantity_coverage, 3),
        avg_confidence=round(avg_confidence, 3),
    )

    warnings: List[str] = []
    if skipped_without_qty:
        warnings.append(
            f"{skipped_without_qty} Element(e) ohne verwertbare Menge wurden übersprungen."
        )
    if mapping_coverage < 1.0:
        warnings.append(
            "Einige Bauteile wurden der Sammelposition KG 300 zugeordnet (kein präzises Gewerk erkannt)."
        )
    if office_kgs:
        # §99 — les KG résolues en MÉDIANE (≥ 2 prix propres, même Einheit)
        # sont comptées et DITES : ce n'est plus le prix d'une seule position.
        median_count = sum(
            1 for office in office_kgs.values()
            if getattr(office, "auswahl", "einzelpreis") == "median"
        )
        meldung = (
            f"{len(office_kgs)} Kostengruppe(n) mit tenantbezogenen Büropreisen bewertet "
            "(Preisstand + Destatis-Indexierung je Position, Quelle « eigene Preise »)."
        )
        if median_count:
            meldung += (
                f" Darunter {median_count} als MEDIAN aus jeweils mindestens 2 Büropreisen "
                "(robust gegen einzelne Ausreißer; andere Einheiten nie vermischt)."
            )
        warnings.append(meldung)
    else:
        warnings.append(
            "Parametrische NARCHI-Richtwerte 2026 — keine verbindliche Kostenberechnung; "
            "tenantbezogene Einheitspreise ersetzen die Richtwerte, sobald gepflegt."
        )

    def _line_payload(line: BoqLine) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "kostengruppe": line.kostengruppe,
            "titel": line.titel,
            "menge": float(line.menge),
            "einheit": line.einheit,
            "einheitspreis_netto": float(line.einheitspreis_netto),
            "gesamt_netto": float(line.gesamt_netto),
            "anzahl_elemente": line.anzahl_elemente,
            "beispiele": line.beispiele,
            "preis_quelle": "büro" if line.kostengruppe in office_kgs else "richtwert",
        }
        office = office_kgs.get(line.kostengruppe)
        if office is not None:
            if getattr(office, "auswahl", "einzelpreis") == "median":
                # §99 — médiane : aucune OZ seule n'existe ; on sert la
                # règle, le nombre de prix propres, leurs millésimes et les
                # positions écartées à cause d'une Einheit différente.
                payload["preis_quelle_detail"] = {
                    "auswahl": "median",
                    "n_quellen": office.n_quellen,
                    "einheit": office.einheit_quelle,
                    "median_steht_auf": office.preisstand_jahr,  # année cible (déjà indexé)
                    "jahr_von": office.quellen_jahr_von,
                    "jahr_bis": office.quellen_jahr_bis,
                    "nicht_vermischt": office.n_nicht_gemischt,
                }
            else:
                payload["preis_quelle_detail"] = {
                    "auswahl": "einzelpreis",
                    "oz": office.oz_quelle,
                    "kurztext": office.kurztext_quelle,
                    "preisstand_jahr": office.preisstand_jahr,
                    "index_faktor": float(office.index_faktor),
                }
        return payload

    return {
        "region": region.value,
        "lines": [_line_payload(line) for line in lines],
        "totals": {
            "netto": float(total_netto),
            "ust_satz": float(UST_SATZ_STANDARD),
            "ust": float(total_ust),
            "brutto": float(total_brutto),
            "kosten_pro_m2": float(kosten_pro_m2) if kosten_pro_m2 is not None else None,
        },
        "range": {
            "low": float(_q(total_netto * FOURCHETTE_BASSE)),
            "high": float(_q(total_netto * FOURCHETTE_HAUTE)),
            "assumption": "±14 % (Sicherheitsband, Nivellierung BKI)",
        },
        "score": {
            "value": score.value,
            "grade": score.grade,
            "mapping_coverage": score.mapping_coverage,
            "quantity_coverage": score.quantity_coverage,
            "avg_confidence": score.avg_confidence,
        },
        "element_count": len(elements),
        # §50 — part chiffrée avec les prix DU BUREAU (provenance visible, §36) :
        "office_quote": {
            "kgs_mit_bueropreis": len(office_kgs),
            "eigenpreis_quote": (
                round(float(office_netto / total_netto), 3) if total_netto > 0 else 0.0
            ),
        },
        "warnings": warnings,
    }
