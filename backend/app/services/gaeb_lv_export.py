"""§90 — Export GAEB X31 du LV co-édité (§89). Cadrage client : ESSENTIEL
avec excellence — un fichier d'échange réel et conforme, rien d'autre.

Conventions XML reprises à l'identique du builder éprouvé
``app/core/estimation/gaeb_export`` (espace de noms DA XML 3.2 phase 31,
squelette GAEBInfo/PrjInfo/Award/BoQ, point décimal, Decimal partout) —
UN seul dialecte GAEB dans tout le produit.

Spécifique au LV co-édité (nos données : positions PLATES saisies à la
main, OZ « 01.003.010 ») :

- **Hiérarchie déduite des OZ** : segments communs → BoQCtgy imbriquées
  (RNoPart = segment numérique complété par zéros — padding standard REB
  23.003 : « 01.003.010 » devient « 001.003.00010 », exactement comme les
  fichiers du marché) ; LblTx de groupe = le chemin du segment (label
  factuel, RIEN d'inventé : le tableau co-édité ne porte pas de titres
  de lots — c'est écrit ici) ;
- **Deux modes, même fichier** : ``preise=False`` (défaut) = LV SANS
  prix — l'Ausschreibung à remettre à l'entreprise, qui chiffre (les EP
  manuels du bureau ne fuient jamais chez un tiers) ; ``preise=True`` =
  UP/IT inclus pour archivage/transport interne, avec le hINWEIS dans le
  DetailTxt : « EP = manuelle Eingabe » (charte §36 DANS le fichier) ;
- **Refus net, jamais de 0,00 € inventé** : en mode prix, une position
  « ohne EP » lève ``LvExportError(oz=[...])`` → HTTP 422 avec la liste
  triée des OZ concernées. L'archi complète OU exporte sans prix.
"""

from __future__ import annotations

import uuid
import xml.etree.ElementTree as ET
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, List, Optional, Sequence

from app.core.estimation.gaeb_export import (
    GAEB_NS,
    GAEB_VERSION,
    GAEB_VERS_DATE,
)
from app.services.lv_positions import lv_totals

PROG_SYSTEM_LV = "NARCHI 2026 (Gemeinsames LV, Buero)"
CENT = Decimal("0.01")

# Longueurs de base (REB 23.003 usuelles) — élargies si un segment réel
# les dépasse : la BoQBkdn déclarée reflète TOUJOURS le contenu.
_CTGY_LEN_MIN = 3
_ITEM_LEN_MIN = 5


class LvExportError(ValueError):
    """Positions sans EP en mode « mit Preisen » — porte la liste des OZ."""

    def __init__(self, ohne_ep_oz: Sequence[str]):
        self.oz = sorted(ohne_ep_oz)
        super().__init__(f"{len(self.oz)} Position(en) ohne EP")


def _q2(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _fmt_qty(value: Decimal) -> str:
    """Menge GAEB : point décimal, ≤ 3 décimales, zéros superflus ôtés.
    Arrondi COMMERCIAL Half-Up (usage VOB) — jamais l'arrondi bancaire
    silencieux de Python (1.2345 → 1.235, pas 1.234)."""
    qty3 = value.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    text = f"{qty3:f}".rstrip("0").rstrip(".")
    return text if text else "0"


def _fmt_money(value: Decimal) -> str:
    return f"{_q2(value):f}"


def _sub(parent: ET.Element, tag: str, text: Optional[str] = None) -> ET.Element:
    node = ET.SubElement(parent, tag)
    if text is not None:
        node.text = text
    return node


def _item_oz_tree(positions: List[dict]) -> dict:
    """Arbre des segments d'OZ : {segment: {enfant…, "_items": [...]}}."""
    root: dict = {"_items": []}
    for pos in positions:
        segments = [s for s in str(pos.get("oz", "")).split(".") if s]
        if len(segments) <= 1:
            root["_items"].append(pos)
            continue
        node = root
        for segment in segments[:-1]:
            node = node.setdefault(segment, {"_items": []})
        node["_items"].append(pos)
    return root


def _pad(segment: str, length: int) -> str:
    """Segment → RNoPart : numérique complété par zéros (REB 23.003), sinon tel quel."""
    return segment.rjust(length, "0") if segment.isdigit() else segment[:length]


def _build_item_text(item: ET.Element, pos: dict, mit_preisen: bool) -> None:
    description = _sub(item, "Description")
    complete = _sub(description, "CompleteText")
    outline = _sub(complete, "OutlineText")
    outl = _sub(outline, "OutlTxt")
    text_outl = _sub(outl, "TextOutlTxt")
    _sub(text_outl, "span", str(pos.get("title") or pos.get("oz") or "Position"))
    if mit_preisen:
        # §36 DANS le fichier échangé : l'EP est une saisie manuelle du
        # bureau, pas un prix de marché vérifié — dit, pas décoré.
        detail = _sub(complete, "DetailTxt")
        text = _sub(detail, "Text")
        paragraph = _sub(text, "p")
        _sub(paragraph, "span", "Hinweis: EP = manuelle Eingabe des Büros.")


def _append_level(
    parent: ET.Element,
    tree: dict,
    path: str,
    mit_preisen: bool,
    ctgy_len: int,
    item_len: int,
) -> None:
    """Ajoute récursivement BoQCtgy (segments) puis les Itemlist locales."""
    for segment, child in tree.items():
        if segment == "_items":
            continue
        child_path = f"{path}.{segment}" if path else segment
        ctgy = ET.SubElement(
            parent, "BoQCtgy", ID=f"ID_{uuid.uuid4()}",
            RNoPart=_pad(segment, ctgy_len),
        )
        lbl = _sub(ctgy, "LblTx")
        # Label FACTUEL : le chemin du segment (le tableau co-édité ne
        # saisit pas de titres de lots — rien n'est inventé).
        _sub(lbl, "span", child_path)
        body = _sub(ctgy, "BoQBody")
        _append_level(body, child, child_path, mit_preisen, ctgy_len, item_len)
    items = tree.get("_items") or []
    if items:
        itemlist = _sub(parent, "Itemlist")
        for pos in items:
            _append_item(itemlist, pos, mit_preisen, item_len)


def _append_item(itemlist: ET.Element, pos: dict, mit_preisen: bool, item_len: int) -> None:
    segments = [s for s in str(pos.get("oz", "")).split(".") if s]
    last = segments[-1] if segments else "1"
    item = ET.SubElement(
        itemlist, "Item", ID=f"ID_{uuid.uuid4()}", RNoPart=_pad(last, item_len)
    )
    qty = Decimal(str(pos["qty"]))
    _sub(item, "Qty", _fmt_qty(qty))
    if pos.get("unit"):
        _sub(item, "QU", str(pos["unit"]))
    if mit_preisen:
        ep = Decimal(str(pos["unit_price"]))
        _sub(item, "UP", _fmt_money(ep))
        _sub(item, "IT", _fmt_money(_q2(qty * ep)))
    _build_item_text(item, pos, mit_preisen)


def _oz_key(oz: str) -> tuple:
    """Clé de tri NUMÉRIQUE par segments (« 01.10 » après « 01.2 ») —
    les lettres après les chiffres à même niveau. Jamais lexicographique."""
    return tuple(
        (0, int(s)) if s.isdigit() else (1, s)
        for s in str(oz).split(".")
        if s != ""
    )


def build_lv_gaeb_x31(
    *,
    project_name: str,
    positions: Iterable[dict],
    mit_preisen: bool = False,
    created: Optional[datetime] = None,
) -> str:
    """Positions LV co-éditées (sortie ``extract_lv_positions``) → XML X31.

    Lève ``LvExportError`` si ``mit_preisen`` et une position est « ohne
    EP » — jamais de 0,00 € inventé (le tri OZ des manquantes est dans
    l'erreur, affiché en clair par la route).
    """
    positions = sorted(list(positions), key=lambda p: _oz_key(str(p.get("oz", ""))))
    if mit_preisen:
        missing = sorted(str(p["oz"]) for p in positions if p["unit_price"] is None)
        if missing:
            raise LvExportError(missing)

    created = created or datetime.now()
    date_str = created.strftime("%Y-%m-%d")
    time_str = created.strftime("%H:%M:%S")

    tree = _item_oz_tree(positions)
    ctgy_segments = [
        s
        for node_path in _walk_ctgy_segments(tree)
        for s in [node_path]
    ]
    ctgy_len = max([_CTGY_LEN_MIN, *(len(s) for s in ctgy_segments)] or [_CTGY_LEN_MIN])
    item_segments = [
        ([s for s in str(p.get("oz", "")).split(".") if s] or ["1"])[-1]
        for p in positions
    ]
    item_len = max([_ITEM_LEN_MIN, *(len(s) for s in item_segments)] or [_ITEM_LEN_MIN])

    root = ET.Element("GAEB", xmlns=GAEB_NS)
    info = _sub(root, "GAEBInfo")
    _sub(info, "Version", GAEB_VERSION)
    _sub(info, "VersDate", GAEB_VERS_DATE)
    _sub(info, "Date", date_str)
    _sub(info, "Time", time_str)
    _sub(info, "ProgSystem", PROG_SYSTEM_LV)

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

    totals = lv_totals(positions)
    boq = ET.SubElement(award, "BoQ", ID=f"ID_{uuid.uuid4()}")
    boq_info = _sub(boq, "BoQInfo")
    _sub(boq_info, "Name", f"Leistungsverzeichnis — {project_name}")
    preis_hinweis = "mit EP (manuelle Eingabe)" if mit_preisen else "ohne Preise"
    _sub(boq_info, "LblBoQ", f"Gemeinsames LV ({preis_hinweis}, {totals['count']} Positionen)")
    _sub(boq_info, "Date", date_str)
    _sub(boq_info, "OutlCompl", "AllTxt")
    for bkdn_type, length in (("BoQLevel", str(ctgy_len)), ("Item", str(item_len))):
        bkdn = _sub(boq_info, "BoQBkdn")
        _sub(bkdn, "Type", bkdn_type)
        _sub(bkdn, "Length", length)
        _sub(bkdn, "Num", "Yes")

    body = _sub(boq, "BoQBody")
    _append_level(body, tree, "", mit_preisen, ctgy_len, item_len)

    ET.register_namespace("", GAEB_NS)
    return ET.tostring(root, encoding="unicode")


def _walk_ctgy_segments(node: dict) -> Iterable[str]:
    for segment, child in node.items():
        if segment == "_items":
            continue
        yield segment
        yield from _walk_ctgy_segments(child)
