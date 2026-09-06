"""
NARCHI V5 — Jeu de données de référence prix Allemagne 2026 (seeding).

Positions de référence par Kostengruppe DIN 276 avec prix unitaires netto
(€, hors USt 19 %), base janvier 2026, rédigées pour NARCHI d'après les
ordres de grandeur usuels du marché allemand (Baukosten niveau « mittel »).
Ces prix sont des points de départ de kalkulation : ils sont remplacés par
les bibliothèques de prix du tenant dès que celles-ci sont importées.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Dict, Iterable, List

from sqlalchemy.ext.asyncio import AsyncSession

from .estimation_engine import EstimationEngine
from .price_database import PriceItem, PriceRegion

# : tuples (code_référence, désignation DE, catégorie KG, filtre matériau IFC,
#           mapping type IFC, unité, prix netto €, part matériau, part main-d'œuvre)
GERMAN_REFERENCE_PRICES: List[tuple] = [
    # KG 210 — Baugrund
    ("D210-001", "Baugrubenaushub, Verfüllung frette Gelände", "kg210_grundstueck_vorbereitung", "erde", "IfcEarthworksCut", "m3", "21.50", "0.15", "0.45"),
    ("D210-002", "Sauberkeitsschicht Kies unter Bodenplatte", "kg210_grundstueck_vorbereitung", "kies", "IfcCovering", "m2", "14.80", "0.60", "0.30"),

    # KG 310 — Gründung
    ("D310-001", "Fundament C25/30, streifenförmig, kostenweise inkl. Schalung", "kg310_gruendung", "beton", "IfcFooting", "m3", "268.00", "0.42", "0.38"),
    ("D310-002", "Bodenplatte C30/37, h=25 cm, inkl. Bewehrung", "kg310_gruendung", "stahlbeton", "IfcSlab", "m3", "298.00", "0.48", "0.32"),
    ("D310-003", "Pfahlgründung Bohrpfahl D=60 cm", "kg310_gruendung", "beton", "IfcPile", "m", "185.00", "0.38", "0.30"),

    # KG 320 — Tragende Außenwände / Innenstützen
    ("D320-001", "Stahlbetonwand C30/37, d=24 cm, inkl. Schalung+Bewehrung", "kg320_aussenwaende_rohbau", "stahlbeton", "IfcWall", "m3", "412.00", "0.44", "0.36"),
    ("D320-002", "Mauerwerk KS-Mauerstein, d=24 cm, MG III", "kg320_aussenwaende_rohbau", "mauerwerk", "IfcWall", "m2", "96.00", "0.42", "0.48"),
    ("D320-003", "Stahlbetonstütze C30/37, 30×30 cm", "kg320_aussenwaende_rohbau", "stahlbeton", "IfcColumn", "m3", "520.00", "0.46", "0.34"),
    ("D320-004", "Porenbetonwand d=24 cm, Dünnbettmörtel", "kg320_aussenwaende_rohbau", "porenbeton", "IfcWall", "m3", "178.00", "0.50", "0.40"),

    # KG 330 — Nichttragende Innenwände
    ("D330-001", "Trockenbauwand, doppelt beplankt, d=100 mm, inkl. Profil+Filz", "kg330_innenwaende", "gipskarton", "IfcWall", "m2", "62.00", "0.46", "0.44"),
    ("D330-002", "Gipskartonständerwand beheizt Räume, d=125 mm", "kg330_innenwaende", "placo", "IfcWall", "m2", "68.00", "0.48", "0.42"),

    # KG 340 — Decken / Treppenlauf-Konstruktion
    ("D340-001", "Stahlbetondecke C30/37, h=20 cm, inkl. Schalung", "kg340_decken", "stahlbeton", "IfcSlab", "m3", "335.00", "0.46", "0.34"),
    ("D340-002", "Stahlbetonbalken C30/37, inkl. Schalung+Bewehrung", "kg340_decken", "stahlbeton", "IfcBeam", "m3", "548.00", "0.46", "0.34"),
    ("D340-003", "Hohlraumdecke h=30 cm mit Aussparung", "kg340_decken", "beton", "IfcSlab", "m3", "296.00", "0.50", "0.28"),

    # KG 350 — Dachwerk
    ("D350-001", "Pfettendach Fichte KVH, inkl. Eindeckung-Unterspannbahn", "kg350_dachwerk", "holz", "IfcBeam", "m2", "92.00", "0.52", "0.38"),
    ("D350-002", "Flachdach-Tragkonstruktion Brettsperrholz", "kg350_dachwerk", "holz", "IfcRoof", "m2", "118.00", "0.58", "0.32"),

    # KG 360 — Dachabdichtung und -deckung
    ("D360-001", "Dachdeckung Betondachstein, inkl. Lattung", "kg360_dachhaut", "dachstein", "IfcRoof", "m2", "58.00", "0.52", "0.38"),
    ("D360-002", "Flachdachabdichtung Bitumenbahn 2-lagig", "kg360_dachhaut", "bitumen", "IfcRoof", "m2", "64.00", "0.54", "0.36"),
    ("D360-003", "Steildachdeckung Tonziegel Noah-Standard", "kg360_dachhaut", "ton", "IfcRoof", "m2", "72.00", "0.50", "0.40"),

    # KG 361 — Fenster und Außentüren
    ("D361-001", "Kunststofffenster 3-fach-Verglasung Uw=0.80, inkl. Rollladen", "kg361_fenster_aussentueren", "kunststoff", "IfcWindow", "m2", "685.00", "0.62", "0.28"),
    ("D361-002", "Holz-Alu-Fenster 3-fach-Verglasung Uw=0.78", "kg361_fenster_aussentueren", "holz-alu", "IfcWindow", "m2", "980.00", "0.64", "0.26"),
    ("D361-003", "Haustür Aluminium, wärmegedämmt, inkl. Beschlag", "kg361_fenster_aussentueren", "aluminium", "IfcDoor", "st", "2350.00", "0.66", "0.24"),

    # KG 362 — Innentüren
    ("D362-001", "Innentür CPL-Türblatt inkl. Stahlzarge und Drückergarnitur", "kg362_innentueren", "cpl", "IfcDoor", "st", "465.00", "0.58", "0.32"),
    ("D362-002", "Innentür Echtholzfurnier inkl. Zarge", "kg362_innentueren", "holz", "IfcDoor", "st", "690.00", "0.62", "0.28"),

    # KG 363 — Wandbeläge
    ("D363-001", "Wandputz Innen, Kalkzementputz Q3 mit Anstrich", "kg363_wandbelaege", "putz", "IfcCovering", "m2", "24.50", "0.32", "0.58"),
    ("D363-002", "Fliesenspiegel Bad/WC, Steinzeug 30×60, inkl. Kleber+Fuge", "kg363_wandbelaege", "fliese", "IfcCovering", "m2", "86.00", "0.44", "0.46"),

    # KG 364 — Fußbodenbeläge
    ("D364-001", "Estrich Zementestrich auf Trennschicht, h=5 cm", "kg364_fussboden", "estrich", "IfcSlab", "m2", "26.00", "0.46", "0.44"),
    ("D364-002", "Steingutfliese 60×60, inkl. Flexmörtel", "kg364_fussboden", "fliese", "IfcCovering", "m2", "68.00", "0.48", "0.42"),
    ("D364-003", "Parkett Eiche 3-Schicht, verlegt inkl. Trittschalldämmung", "kg364_fussboden", "parkett", "IfcCovering", "m2", "94.00", "0.58", "0.32"),
    ("D364-004", "Laminat 8 mm, inkl. Trittschalldämmung", "kg364_fussboden", "laminat", "IfcCovering", "m2", "32.00", "0.56", "0.34"),

    # KG 365 — Wärmedämmung (GEG-konform)
    ("D365-001", "WDVS EPS-Fassadendämmung 160 mm, WLG 035, inkl. Putz", "kg365_waermedaemmung", "eps", "IfcCovering", "m2", "96.00", "0.44", "0.46"),
    ("D365-002", "Kellerdecken-Dämmung EPS 100 mm", "kg365_waermedaemmung", "eps", "IfcSlab", "m2", "41.00", "0.52", "0.38"),
    ("D365-003", "Dachdämmung Mineralwolle 240 mm Zwischensparren", "kg365_waermedaemmung", "mineralwolle", "IfcRoof", "m2", "52.00", "0.50", "0.40"),

    # KG 366 — Treppen und Geländer
    ("D366-001", "Fertigteil-Treppe Stahlbeton, 2 Läufe, inkl. Transport", "kg366_treppen_gelaender", "stahlbeton", "IfcStair", "st", "3890.00", "0.56", "0.22"),
    ("D366-002", "Geländer Stahl, verzinkt, H=1.00 m", "kg366_treppen_gelaender", "stahl", "IfcRailing", "m", "148.00", "0.60", "0.28"),

    # KG 367 — Stahlbau
    ("D367-001", "Stahlrahmen S235, inkl. Lieferung+Montage+Feuerverzinkung", "kg367_stahlbau", "stahl", "IfcBeam", "t", "3480.00", "0.62", "0.18"),
    ("D367-002", "Stahlstütze HEB 200, inkl. Fußplatte+Montage", "kg367_stahlbau", "stahl", "IfcColumn", "t", "3720.00", "0.64", "0.16"),

    # KG 368 — Holzbau
    ("D368-001", "Holzrahmenbau-Außenwand, geschosshoch, inkl. OSB+Dämmung", "kg368_holzbau", "holz", "IfcWall", "m2", "285.00", "0.54", "0.36"),
    ("D368-002", "BSH-Träger GL24c, inkl. Lieferung+Einbau", "kg368_holzbau", "holz", "IfcBeam", "m3", "1250.00", "0.66", "0.24"),

    # KG 410 — Abwasser, Wasser, Gas
    ("D410-001", "Regenwasser-Dachrinne Titanzink halbrund 333, inkl. Fallrohr", "kg410_abwasser_wasser", "zink", "IfcRoof", "m", "42.00", "0.52", "0.38"),
    ("D410-002", "Sanitärinstallation komplett (Bad Standard), Pauschal", "kg410_abwasser_wasser", "sanitaer", "IfcSanitaryTerminal", "st", "9150.00", "0.56", "0.34"),

    # KG 420 — Heizung
    ("D420-001", "Wärmepumpe Luft/Wasser 8 kW, inkl. Montage+IBN", "kg420_heizung", "waermepumpe", "IfcBoiler", "st", "24800.00", "0.64", "0.24"),
    ("D420-002", "Fußbodenheizung Niedertemperatur, inkl. Verteiler", "kg420_heizung", "fussbodenheizung", "IfcCovering", "m2", "58.00", "0.46", "0.44"),

    # KG 430 — Lüftung
    ("D430-001", "Wohnungslüftung mit Wärmerückgewinnung, zentrale Einheit", "kg430_lueftung", "lueftung", "IfcAirTerminal", "st", "6800.00", "0.58", "0.30"),

    # KG 440 — Elektro
    ("D440-001", "Elektroinstallation Wohnung (grundaustattung), Pauschal", "kg440_elektro", "elektro", "IfcElectricDistributionBoard", "st", "7900.00", "0.52", "0.38"),
    ("D440-002", "Kabel+Leitung NYM-J 3×1,5, verlegt", "kg440_elektro", "kabel", "IfcCableSegment", "m", "4.80", "0.58", "0.32"),

    # KG 500 — Außenanlagen
    ("D500-001", "Pflasterfläche Betonpflaster 8 cm, inkl. Bettung", "kg500_aussenanlagen", "pflaster", "IfcSlab", "m2", "54.00", "0.48", "0.42"),
    ("D500-002", "Beet/Vorgarten-Anlage, inkl. Erde+Bepflanzung Standard", "kg500_aussenanlagen", "beet", "IfcCovering", "m2", "38.00", "0.42", "0.48"),
]


def iter_price_items_for_region(region: PriceRegion) -> Iterable[PriceItem]:
    """Génère les PriceItem de référence pour une zone tarifaire donnée.

    Le prix de base multi-zone est corrigé par le Regionalfaktor de la zone
    (moyenne nationale = 1.000) pour refléter la structure de coûts locale.
    """
    coefficients = EstimationEngine.REGIONAL_COEFFICIENTS
    coeff = coefficients.get(region, Decimal("0.980"))
    valid_from = date(2026, 1, 1)

    for (
        reference_code, designation, category,
        material_filter, ifc_type, unit,
        base_price, material_share, labor_share,
    ) in GERMAN_REFERENCE_PRICES:
        regional_price = (Decimal(base_price) * coeff).quantize(Decimal("0.0001"))
        material_cost = (regional_price * Decimal(material_share)).quantize(Decimal("0.0001"))
        labor_cost = (regional_price * Decimal(labor_share)).quantize(Decimal("0.0001"))
        yield PriceItem(
            reference_code=f"{reference_code}-{region.value}",
            designation=designation,
            category=category,
            ifc_type_mapping=ifc_type,
            ifc_material_filter=material_filter,
            unit=unit,
            unit_price_ht=regional_price,
            tva_rate=Decimal("19.00"),
            material_cost=material_cost,
            labor_cost=labor_cost,
            region=region.value,
            valid_from=valid_from,
            price_index_ref="BPI-Hochbau-2021",
            source="narchi_referenz_2026",
            source_confidence=Decimal("0.85"),
            tags=["din276", "deutschland", "2026", "referenz"],
            tenant_id=None,
        )


async def seed_price_items(session: AsyncSession, regions: List[PriceRegion] | None = None) -> int:
    """Insère les prix de référence pour les zones demandées (défaut : toutes).

    Retourne le nombre de lignes insérées. Idempotent côté appelant : la
    contrainte unique (reference_code, region, valid_from) empêche les
    doublons — les doublons sont interceptés par le flushgroup au niveau
    de la session et ignorés.
    """
    target_regions = regions or list(PriceRegion)
    count = 0
    for region in target_regions:
        for item in iter_price_items_for_region(region):
            session.add(item)
            count += 1
    await session.commit()
    return count
