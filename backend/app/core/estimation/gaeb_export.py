"""Export GAEB X31 (DA XML 3.2, Datenaustauschphase 31) du devis DIN 276.

Le chaînon « pivot → Kostengruppen » produit un BOQ interne ; ce module le
sérialise dans le format d'échange standard allemand GAEB X31, lisible par
les logiciels AVA du marché (calcul de prix, offres, avenants).

Conventions appliquées (fiabilisées sur fichiers réels DA XML 3.2) :
- espace de noms ``http://www.gaeb.de/GAEB_DA_XML/DA31/3.2`` ;
- ``GAEBInfo`` (Version 3.2, VersDate 2013-10, Date/Time, ProgSystem) ;
- ``PrjInfo`` (nom du projet, devise EUR) ;
- ``Award`` avec ``DP`` = 31 et ``AwardInfo`` (BoQID uuid, devise) ;
- ``BoQ`` → ``BoQInfo`` (BoQBkdn : niveau LV 3 caractères, position 5) →
  ``BoQBody`` → ``BoQCtgy`` (une par Kostengruppe, ``RNoPart`` = code KG sur
  3 chiffres) → ``Itemlist`` → ``Item`` (``RNoPart`` séquentiel sur 5
  chiffres, ``Qty``/``QU``/``UP``/``IT`` au format point décimal) ;
- le texte de position suit la grammaire GAEB :
  ``Description/CompleteText/OutlineText/OutlTxt/TextOutlTxt`` (surtexte
  obligatoire) et ``DetailTxt/Text/p`` (texte détaillé optionnel portant le
  nombre de bauteils agrégés et les exemples).

Les prix exportés sont les prix unitaires NETTO du moteur (USt 19 % calculée
au niveau total, jamais au niveau position — usage appel d'offres).
"""

from __future__ import annotations

import uuid
import xml.etree.ElementTree as ET
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, Iterable, List, Optional

GAEB_NS = "http://www.gaeb.de/GAEB_DA_XML/DA31/3.2"
GAEB_VERSION = "3.2"
GAEB_VERS_DATE = "2013-10"
PROG_SYSTEM = "NARCHI 2026 (Kostenschaetzung DIN 276)"

CENT = Decimal("0.01")

# Libellé long des Kostengruppen pour le surtexte de catégorie.
KG_LABEL: Dict[str, str] = {
    "kg210": "Baugrund",
    "kg300": "Bauwerk",
    "kg310": "Gründung",
    "kg320": "Rohbau Wände",
    "kg330": "Innenwände",
    "kg340": "Decken",
    "kg350": "Dachkonstruktion",
    "kg360": "Dachhaut",
    "kg361": "Fenster",
    "kg362": "Innentüren",
    "kg363": "Wandbekleidungen",
    "kg364": "Bodenbeläge",
    "kg365": "Wärmedämmung",
    "kg366": "Treppen",
    "kg367": "Stahlbau",
    "kg368": "Holzbau",
    "kg400": "Technische Anlagen",
    "kg410": "Abwasser/Sanitär",
    "kg420": "Heizung",
    "kg430": "Lüftung",
    "kg440": "Elektro",
    "kg500": "Außenanlagen",
}

ET.register_namespace("", GAEB_NS)


def _q2(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _fmt_qty(value: Decimal) -> str:
    """Menge GAEB : point décimal, jusqu'à 3 décimales, zéros superflus ôtés."""
    text = f"{value:.3f}".rstrip("0").rstrip(".")
    return text if text else "0"


def _fmt_money(value: Decimal) -> str:
    """EP / Gesamtbetrag GAEB : point décimal, exactement 2 décimales."""
    return f"{_q2(value):f}"


def _kg_rno_part(kostengruppe: str) -> str:
    """Extrait le code numérique de la Kostengruppe (« kg320_… » → « 320 »)."""
    digits = "".join(ch for ch in kostengruppe.lower().replace("kg", "", 1)[:3] if ch.isdigit())
    return (digits or "300").rjust(3, "0")


def _sub(parent: ET.Element, tag: str, text: Optional[str] = None) -> ET.Element:
    node = ET.SubElement(parent, tag)
    if text is not None:
        node.text = text
    return node


def _build_description(item: ET.Element, titel: str, detail: Optional[str]) -> None:
    description = _sub(item, "Description")
    complete = _sub(description, "CompleteText")
    outline = _sub(complete, "OutlineText")
    outl = _sub(outline, "OutlTxt")
    text_outl = _sub(outl, "TextOutlTxt")
    _sub(text_outl, "span", titel)
    if detail:
        detail_txt = _sub(complete, "DetailTxt")
        text = _sub(detail_txt, "Text")
        paragraph = _sub(text, "p")
        _sub(paragraph, "span", detail)


def build_gaeb_x31(
    *,
    project_name: str,
    lines: Iterable[Dict[str, Any]],
    region: str,
    created: Optional[datetime] = None,
) -> str:
    """Sérialise les positions BOQ (sortie ``estimate_quick``) en GAEB X31.

    Args:
        project_name: nom du projet (PrjInfo / BoQInfo).
        lines: positions agrégées ``estimate_quick['lines']``.
        region: code du Regionalfaktor appliqué (informatif, porté par le
            texte détaillé — les prix sont déjà régionalisés).
        created: horodatage du document (déterministe en test).

    Returns:
        Document XML encodé UTF-8 prêt à être écrit dans un fichier ``.x31``.
    """

    created = created or datetime.now()
    date_str = created.strftime("%Y-%m-%d")
    time_str = created.strftime("%H:%M:%S")

    root = ET.Element("GAEB", xmlns=GAEB_NS)

    info = _sub(root, "GAEBInfo")
    _sub(info, "Version", GAEB_VERSION)
    _sub(info, "VersDate", GAEB_VERS_DATE)
    _sub(info, "Date", date_str)
    _sub(info, "Time", time_str)
    _sub(info, "ProgSystem", PROG_SYSTEM)

    prj = _sub(root, "PrjInfo")
    _sub(prj, "NamePrj", project_name)
    _sub(prj, "LblPrj", project_name)
    _sub(prj, "Cur", "EUR")
    _sub(prj, "CurLbl", "Euro")

    award = _sub(root, "Award")
    _sub(award, "DP", "31")
    award_info = _sub(award, "AwardInfo")
    _sub(award_info, "BoQID", str(uuid.uuid4()))
    _sub(award_info, "Cur", "EUR")
    _sub(award_info, "CurLbl", "Euro")

    boq = ET.SubElement(award, "BoQ", ID=f"ID_{uuid.uuid4()}")
    boq_info = _sub(boq, "BoQInfo")
    _sub(boq_info, "Name", f"Leistungsverzeichnis — {project_name}")
    _sub(boq_info, "LblBoQ", f"Kostenschätzung DIN 276 (Regionalfaktor {region})")
    _sub(boq_info, "Date", date_str)
    _sub(boq_info, "OutlCompl", "AllTxt")
    for bkdn_type, length in (("BoQLevel", "3"), ("Item", "5")):
        bkdn = _sub(boq_info, "BoQBkdn")
        _sub(bkdn, "Type", bkdn_type)
        _sub(bkdn, "Length", length)
        _sub(bkdn, "Num", "Yes")

    # Regroupement métier : une catégorie de LV par Kostengruppe, positions
    # dans l'ordre fourni par l'estimation (déjà triée par KG).
    groups: Dict[str, List[Dict[str, Any]]] = {}
    order: List[str] = []
    for line in lines:
        kg = str(line["kostengruppe"])
        if kg not in groups:
            groups[kg] = []
            order.append(kg)
        groups[kg].append(line)

    body = _sub(boq, "BoQBody")
    for kg in order:
        rno_kg = _kg_rno_part(kg)
        kg_label = KG_LABEL.get(f"kg{rno_kg}", kg)
        titel_ctgy = groups[kg][0].get("titel", kg_label)
        ctgy = ET.SubElement(body, "BoQCtgy", ID=f"ID_{uuid.uuid4()}", RNoPart=rno_kg)
        lbl = _sub(ctgy, "LblTx")
        _sub(lbl, "span", f"KG {rno_kg} — {kg_label}")
        ctgy_body = _sub(ctgy, "BoQBody")
        itemlist = _sub(ctgy_body, "Itemlist")

        for index, line in enumerate(groups[kg], start=1):
            menge = Decimal(str(line["menge"]))
            ep = Decimal(str(line["einheitspreis_netto"]))
            it = _q2(menge * ep)
            item = ET.SubElement(
                itemlist,
                "Item",
                ID=f"ID_{uuid.uuid4()}",
                RNoPart=str(index).rjust(5, "0"),
            )
            _sub(item, "Qty", _fmt_qty(menge))
            _sub(item, "QU", str(line["einheit"]))
            _sub(item, "UP", _fmt_money(ep))
            _sub(item, "IT", _fmt_money(it))
            anzahl = int(line.get("anzahl_elemente", 0))
            beispiele = ", ".join(str(b) for b in line.get("beispiele", [])[:3])
            detail: Optional[str] = None
            if anzahl:
                detail = f"{anzahl} Bauteil(e) aus dem IFC-Modell"
                if beispiele:
                    detail += f" — z. B. {beispiele}"
            _build_description(item, str(line.get("titel", titel_ctgy)), detail)

    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    return ET.tostring(root, encoding="unicode", xml_declaration=False).join(
        ['<?xml version="1.0" encoding="UTF-8"?>\n', ""]
    )


def build_gaeb_x31_kostengruppen(
    *,
    project_name: str,
    din276: str,
    kostengruppen: List[Dict[str, Any]],
    created: Optional[datetime] = None,
) -> str:
    """§74 — V2.5 : GAEB X31 (DA XML 3.2) d'une Kostenschätzung DIN 276.

    Même grammaire que ``build_gaeb_x31`` (namespace, GAEBInfo, BoQBkdn,
    Description/OutlTxt) : une ``BoQCtgy`` par Kostengruppe, un ``Item``
    pauschal (Qty=1, QU « psch », UP=IT=montant netto) par ligne.
    Le DetailTxt de chaque position dit la vérité : valeur Richtwert à
    remplacer par un calcul AVA détaillé — jamais un devis d'exécution.
    """
    if not kostengruppen:
        raise ValueError("kostengruppen vide — rien a exporter.")

    created = created or datetime.now()
    date_str = created.strftime("%Y-%m-%d")
    time_str = created.strftime("%H:%M:%S")

    root = ET.Element("GAEB", xmlns=GAEB_NS)

    info = _sub(root, "GAEBInfo")
    _sub(info, "Version", GAEB_VERSION)
    _sub(info, "VersDate", GAEB_VERS_DATE)
    _sub(info, "Date", date_str)
    _sub(info, "Time", time_str)
    _sub(info, "ProgSystem", PROG_SYSTEM)

    prj = _sub(root, "PrjInfo")
    _sub(prj, "NamePrj", project_name)
    _sub(prj, "LblPrj", project_name)
    _sub(prj, "Cur", "EUR")
    _sub(prj, "CurLbl", "Euro")

    award = _sub(root, "Award")
    _sub(award, "DP", "31")
    award_info = _sub(award, "AwardInfo")
    _sub(award_info, "BoQID", str(uuid.uuid4()))
    _sub(award_info, "Cur", "EUR")
    _sub(award_info, "CurLbl", "Euro")

    boq = ET.SubElement(award, "BoQ", ID=f"ID_{uuid.uuid4()}")
    boq_info = _sub(boq, "BoQInfo")
    _sub(boq_info, "Name", f"Leistungsverzeichnis — {project_name}")
    _sub(boq_info, "LblBoQ", f"Kostenschätzung DIN 276, Fassung {din276}-12 (Pauschalpositionen)")
    _sub(boq_info, "Date", date_str)
    _sub(boq_info, "OutlCompl", "AllTxt")
    for bkdn_type, length in (("BoQLevel", "3"), ("Item", "5")):
        bkdn = _sub(boq_info, "BoQBkdn")
        _sub(bkdn, "Type", bkdn_type)
        _sub(bkdn, "Length", length)
        _sub(bkdn, "Num", "Yes")

    body = _sub(boq, "BoQBody")
    for group in kostengruppen:
        rno_kg = str(group["code"]).rjust(3, "0")
        ctgy = ET.SubElement(body, "BoQCtgy", ID=f"ID_{uuid.uuid4()}", RNoPart=rno_kg)
        lbl = _sub(ctgy, "LblTx")
        _sub(lbl, "span", f"KG {rno_kg} — {group['label']}")
        ctgy_body = _sub(ctgy, "BoQBody")
        itemlist = _sub(ctgy_body, "Itemlist")
        for index, line in enumerate(group["lines"], start=1):
            amount = _q2(Decimal(str(line["amount"])))
            item = ET.SubElement(
                itemlist, "Item", ID=f"ID_{uuid.uuid4()}",
                RNoPart=str(index).rjust(5, "0"),
            )
            _sub(item, "Qty", "1")
            _sub(item, "QU", "psch")
            _sub(item, "UP", _fmt_money(amount))
            _sub(item, "IT", _fmt_money(amount))
            _build_description(
                item,
                f"{line['code']} {line['label']}",
                "Pauschalposition aus Kostenschätzung DIN 276 (Richtwert) — "
                "durch kalkulierte AVA-Positionen zu ersetzen.",
            )

    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    return ET.tostring(root, encoding="unicode", xml_declaration=False).join(
        ['<?xml version="1.0" encoding="UTF-8"?>\n', ""]
    )
