"""§93 — Émission formelle GAEB X83 (Angebot) d'une offre stockée (§91).

Après l'Angebotsvergleich (§92), le bureau doit pouvoir sortir le
document FORMEL de la phase : l'offre de l'entreprise retenue en GAEB
DA XML 3.2 phase **83**, re-générée depuis les prix VÉRIFIÉS à
l'import (centimes entiers, §91) — pas depuis le fichier d'origine du
logiciel AVA de l'entreprise, dont nous ne savons rien.

Garanties (même exigence que §90/§91) :

- **RIEN d'inventé** : la ré-émission est un miroir EXACT des données
  stockées et vérifiées — OZ paddées conservées, UP/IT au centime,
  quantités Half-Up 3 décimales ; la hiérarchie des lots est déduite
  des segments d'OZ communs avec le MÊME padding REB 23.003 que §90
  (fonctions réutilisées, pas dupliquées : un seul dialecte GAEB dans
  le produit) ;
- une position « ohne EP » le RESTE dans le X83 (aucun UP/IT écrit) —
  une offre partielle reste visiblement partielle, jamais un 0,00 € ;
- la provenance (« aus geprüftem NARCHI-Import ») et l'entreprise sont
  écrites DANS le fichier (LblBoQ) — la trace voyage avec le document ;
- la phase émise est TOUJOURS DP=83 (c'est la définition de l'Angebot)
  ; la phase du fichier source (31/83/…) est rappelée dans le LblBoQ,
  jamais présentée comme la phase actuelle ;
- le X83 émis est obligatoirement RE-LISIBLE par notre propre parseur
  §91 (round-trip testé) — le produit sait relire ce qu'il écrit.
"""

from __future__ import annotations

import uuid
import xml.etree.ElementTree as ET
from datetime import datetime
from decimal import Decimal
from typing import Iterable, List, Optional

from app.core.estimation.gaeb_export import (
    GAEB_NS,
    GAEB_VERSION,
    GAEB_VERS_DATE,
)
# Fonctions réutilisées de §90 (conventions GAEB UNIQUES du produit) :
# padding REB 23.003, arbre des segments d'OZ, tri numérique, formats
# Menge/centimes Half-Up. Copier ces règles serait un 2e dialecte.
from app.services.gaeb_lv_export import (
    _CTGY_LEN_MIN,
    _ITEM_LEN_MIN,
    _fmt_money,
    _fmt_qty,
    _item_oz_tree,
    _oz_key,
    _pad,
    _sub,
    _walk_ctgy_segments,
)

PROG_SYSTEM_X83 = "NARCHI 2026 (Angebot X83, gepruefter Import)"


class OfferX83Error(ValueError):
    """Refus motivé — message ALLEMAND affiché tel quel par la route."""


def _append_offer_level(
    parent: ET.Element,
    tree: dict,
    path: str,
    ctgy_len: int,
    item_len: int,
) -> None:
    """BoQCtgy (segments communs) puis les Itemlist locales — miroir de
    la structure §90, mais écrit les montants EN CENTIMES stockés."""
    for segment, child in tree.items():
        if segment == "_items":
            continue
        child_path = f"{path}.{segment}" if path else segment
        ctgy = ET.SubElement(
            parent, "BoQCtgy", ID=f"ID_{uuid.uuid4()}",
            RNoPart=_pad(segment, ctgy_len),
        )
        lbl = _sub(ctgy, "LblTx")
        _sub(lbl, "span", child_path)  # chemin factuel, rien d'inventé
        body = _sub(ctgy, "BoQBody")
        _append_offer_level(body, child, child_path, ctgy_len, item_len)
    items = tree.get("_items") or []
    if items:
        itemlist = _sub(parent, "Itemlist")
        for item in items:
            _append_offer_item(itemlist, item, item_len)


def _append_offer_item(itemlist: ET.Element, item: dict, item_len: int) -> None:
    segments = [s for s in str(item.get("oz", "")).split(".") if s]
    last = segments[-1] if segments else "1"
    node = ET.SubElement(
        itemlist, "Item", ID=f"ID_{uuid.uuid4()}", RNoPart=_pad(last, item_len)
    )
    _sub(node, "Qty", _fmt_qty(Decimal(str(item.get("qty", 0)))))
    if item.get("unit"):
        _sub(node, "QU", str(item["unit"]))
    up_cents = item.get("up_cents")
    it_cents = item.get("it_cents")
    if up_cents is not None:
        # Centimes stockés → texte GAEB point décimal (jamais de float).
        _sub(node, "UP", _fmt_money(Decimal(int(up_cents)) / 100))
    if it_cents is not None:
        _sub(node, "IT", _fmt_money(Decimal(int(it_cents)) / 100))
    # « ohne EP » : ni UP ni IT écrits — la position reste visiblement
    # sans prix, comme dans le fichier de l'entreprise. Jamais 0,00 €.
    description = _sub(node, "Description")
    complete = _sub(description, "CompleteText")
    outline = _sub(complete, "OutlineText")
    outl = _sub(outline, "OutlTxt")
    text_outl = _sub(outl, "TextOutlTxt")
    _sub(text_outl, "span", str(item.get("title") or item.get("oz") or "Position"))


def build_offer_gaeb_x83(
    *,
    project_name: str,
    company_name: str,
    items: Iterable[dict],
    cur: str = "EUR",
    source_dp: Optional[str] = None,
    created: Optional[datetime] = None,
) -> str:
    """Items stockés (``items_json`` §91) → XML GAEB DA 3.2 phase 83.

    Lève ``OfferX83Error`` si rien d'émettable : pas de position, ou
    aucun prix (un X83 sans aucun prix serait une Ausschreibung, pas
    un Angebot — le refus le dit ; impossible via l'import §91, garde
    défensive sur la donnée stockée).
    """
    items: List[dict] = sorted(list(items), key=lambda i: _oz_key(str(i.get("oz", ""))))
    if not items:
        raise OfferX83Error(
            "Keine Positionen im Angebot — es gibt nichts zu exportieren."
        )
    ohne_ep = sum(1 for i in items if i.get("up_cents") is None)
    if ohne_ep == len(items):
        raise OfferX83Error(
            "Kein einziger Preis im Angebot — ein X83 ohne Preise wäre eine "
            "Ausschreibung, kein Angebot. Kein Preis wird erfunden."
        )

    created = created or datetime.now()
    date_str = created.strftime("%Y-%m-%d")
    time_str = created.strftime("%H:%M:%S")
    cur_lbl = "Euro" if cur == "EUR" else cur

    tree = _item_oz_tree(items)
    ctgy_segments = list(_walk_ctgy_segments(tree))
    ctgy_len = max([_CTGY_LEN_MIN, *(len(s) for s in ctgy_segments)])
    item_segments = [
        ([s for s in str(i.get("oz", "")).split(".") if s] or ["1"])[-1]
        for i in items
    ]
    item_len = max([_ITEM_LEN_MIN, *(len(s) for s in item_segments)])

    root = ET.Element("GAEB", xmlns=GAEB_NS)
    info = _sub(root, "GAEBInfo")
    _sub(info, "Version", GAEB_VERSION)
    _sub(info, "VersDate", GAEB_VERS_DATE)
    _sub(info, "Date", date_str)
    _sub(info, "Time", time_str)
    _sub(info, "ProgSystem", PROG_SYSTEM_X83)

    prj = _sub(root, "PrjInfo")
    _sub(prj, "NamePrj", project_name)
    _sub(prj, "LblPrj", project_name)
    _sub(prj, "Cur", cur)
    _sub(prj, "CurLbl", cur_lbl)

    award = _sub(root, "Award")
    _sub(award, "DP", "83")  # phase émise = Angebot, TOUJOURS 83
    award_info = _sub(award, "AwardInfo")
    _sub(award_info, "BoQID", str(uuid.uuid4()))
    _sub(award_info, "Cur", cur)
    _sub(award_info, "CurLbl", cur_lbl)

    boq = ET.SubElement(award, "BoQ", ID=f"ID_{uuid.uuid4()}")
    boq_info = _sub(boq, "BoQInfo")
    _sub(boq_info, "Name", f"Angebot — {company_name}")
    quelle = f", Quelldatei DP {source_dp}" if source_dp else ""
    preis_stand = (
        f"{len(items)} Positionen"
        + (f", davon {ohne_ep} ohne EP" if ohne_ep else " (alle bepreist)")
    )
    _sub(
        boq_info, "LblBoQ",
        f"X83 aus geprüftem NARCHI-Import ({preis_stand}{quelle})",
    )
    _sub(boq_info, "Date", date_str)
    _sub(boq_info, "OutlCompl", "AllTxt")
    for bkdn_type, length in (("BoQLevel", str(ctgy_len)), ("Item", str(item_len))):
        bkdn = _sub(boq_info, "BoQBkdn")
        _sub(bkdn, "Type", bkdn_type)
        _sub(bkdn, "Length", length)
        _sub(bkdn, "Num", "Yes")

    body = _sub(boq, "BoQBody")
    _append_offer_level(body, tree, "", ctgy_len, item_len)

    ET.register_namespace("", GAEB_NS)
    return ET.tostring(root, encoding="unicode")
