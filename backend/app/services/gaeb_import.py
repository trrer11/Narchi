"""§91 — Parseur GAEB entrant (offres d'entreprises, Angebotsvergleich).

L'inverse exact de §90 : le fichier XML de l'entreprise (X83/X31 avec
EP) est lu, vérifié, et ses positions sont extraites EN CENTIMES
ENTIERS. L'excellence ici = le refus MOTIVÉ, jamais l'import silencieux
d'un mauvais fichier :

- taille bornée (2 Mo), DTD/entités refusés (anti-XXE / billion-laughs) ;
- espace de noms reconnu PAR SOUS-CHAÎNE « gaeb.de/GAEB_DA_XML » :
  tolérance voulue aux dialectes des logiciels AVA du marché (DA XML
  3.x), la phase lue (DP 31/83/…) est conservée telle quelle — dit dans
  la réponse, jamais deviné ;
- une offre SANS AUCUN prix est refusée (une Ausschreibung « ohne
  Preise » renvoyée par mégarde n'aide pas une comparaison — le message
  le dit) ; une position individuelle « ohne EP » est importée avec
  up_cents=None et COMPTEÉ (ohne_preis_count) — jamais de 0,00 € inventé ;
- OZ GAEB conservée TELLE QUELLE (paddée, REB 23.003) — le rapprochement
  avec le LV interne normalise numériquement (§92), ici rien n'est perdu.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Optional

MAX_XML_BYTES = 2 * 1024 * 1024     # 2 Mo — un LV courant tient largement dedans
MAX_ITEMS = 5_000                   # borne d'import — affichée dans l'erreur
GAEB_NS_MARK = "gaeb.de/GAEB_DA_XML"

CENT = Decimal("0.01")


class GaebImportError(ValueError):
    """Refus motivé — le message est ALLEMAND et affiché tel quel."""


def _to_cents(text: Optional[str]) -> Optional[int]:
    """« 189.9 » / « 189,90 » → 18990 ; None si absent/illisible (jamais 0)."""
    if text is None:
        return None
    cleaned = text.strip().replace(",", ".")
    if not cleaned:
        return None
    try:
        value = Decimal(cleaned)
    except InvalidOperation:
        return None
    if value < 0 or value > Decimal("1000000000"):
        return None
    return int((value * 100).quantize(CENT, rounding=ROUND_HALF_UP))


def _to_qty(text: Optional[str]) -> float:
    """Menge : nombre fini ≥ 0 ; 0.0 si absent — une offre sans Menge
    conserve le prix (l'écran le montrera, la quantité interne prime)."""
    if text is None:
        return 0.0
    cleaned = text.strip().replace(",", ".")
    try:
        value = Decimal(cleaned)
    except InvalidOperation:
        return 0.0
    if value < 0 or value > Decimal("1000000000"):
        return 0.0
    return float(value)


def _da_version_from_ns(ns: str) -> str:
    """Ex. …/DA31/3.2 → 3.2 ; …/200407 → 3.1-alt. Jamais inventé."""
    parts = ns.rstrip("/").split("/")
    if parts and parts[-1] and parts[-1][0].isdigit():
        return parts[-1][:16]
    return ""


def _child_text(item: ET.Element, ns: str, tag: str) -> Optional[str]:
    el = item.find(f"{{{ns}}}{tag}")
    return el.text if el is not None else None


def _item_title(item: ET.Element, ns: str, fallback: str) -> str:
    span = item.find(
        f"{{{ns}}}Description/{{{ns}}}CompleteText/{{{ns}}}OutlineText/"
        f"{{{ns}}}OutlTxt/{{{ns}}}TextOutlTxt/{{{ns}}}span"
    )
    if span is not None and span.text and span.text.strip():
        return span.text.strip()[:300]
    detail = item.find(
        f"{{{ns}}}Description/{{{ns}}}CompleteText/{{{ns}}}DetailTxt/"
        f"{{{ns}}}Text/{{{ns}}}p/{{{ns}}}span"
    )
    if detail is not None and detail.text and detail.text.strip():
        return detail.text.strip()[:300]
    return fallback


def parse_gaeb_offer_xml(raw: bytes) -> dict:
    """Bytes → offre normalisée. Lève GaebImportError (message DE, précis)."""
    if not raw:
        raise GaebImportError("Leere Datei — bitte die GAEB-Datei des Unternehmens wählen.")
    if len(raw) > MAX_XML_BYTES:
        raise GaebImportError(
            f"Datei zu groß (max. {MAX_XML_BYTES // (1024 * 1024)} MB) — "
            "bitte das LV in Teilen senden lassen."
        )
    # pyGAEB-Idee (MIT, salle blanche) : DTD/ENTITY partout, nicht nur im Kopf.
    scan = raw.upper()
    if b"<!DOCTYPE" in scan or b"<!ENTITY" in scan:
        raise GaebImportError("DTD/Entitäten sind nicht erlaubt (Sicherheit) — bitte als reines GAEB DA XML senden.")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise GaebImportError(f"Kein gültiges XML ({exc}) — Datei beschädigt oder falsches Format.") from exc

    tag = root.tag
    if not tag.startswith("{") or "}" not in tag:
        raise GaebImportError("Kein GAEB-Namensraum — erwartet wird GAEB DA XML (X31/X83).")
    ns = tag[1:tag.index("}")]
    if GAEB_NS_MARK not in ns:
        raise GaebImportError(
            f"Unbekannter Namensraum «{ns[:80]}» — erwartet wird GAEB DA XML."
        )
    if tag[tag.index("}") + 1:] != "GAEB":
        raise GaebImportError("Wurzelelement ist nicht GAEB — falsches Dokument.")

    award = root.find(f"{{{ns}}}Award")
    dp = ""
    cur = "EUR"
    da_version = _da_version_from_ns(ns)
    info = root.find(f"{{{ns}}}GAEBInfo/{{{ns}}}Version")
    if info is not None and (info.text or "").strip():
        da_version = (info.text or "").strip()[:16]
    if award is not None:
        dp_el = award.find(f"{{{ns}}}DP")
        if dp_el is not None and dp_el.text:
            dp = dp_el.text.strip()[:4]
        cur_el = award.find(f"{{{ns}}}AwardInfo/{{{ns}}}Cur")
        if cur_el is not None and cur_el.text:
            cur = cur_el.text.strip()[:4]

    # Parcours hiérarchique : OZ = concat des RNoPart (REB 23.003).
    items: list[dict] = []

    def walk(node: ET.Element, path: list[str]) -> None:
        for child in node:
            local = child.tag.split("}")[-1]
            if local in ("BoQCtgy", "Item"):
                new_path = path + [child.attrib.get("RNoPart", "")]
                if local == "Item":
                    if len(items) >= MAX_ITEMS:
                        raise GaebImportError(
                            f"Mehr als {MAX_ITEMS} Positionen — Import abgebrochen."
                        )
                    oz = ".".join(new_path)
                    up_cents = _to_cents(_child_text(child, ns, "UP"))
                    it_cents = _to_cents(_child_text(child, ns, "IT"))
                    qty = _to_qty(_child_text(child, ns, "Qty"))
                    if it_cents is None and up_cents is not None and qty > 0:
                        # IT absent : recomputable SANS ambiguïté (UP×Qty,
                        # Half-Up) — recalcul marqué serait du fake ; ici
                        # c'est la définition même du Gesamtpreis.
                        it_cents = _to_cents(str(Decimal(str(qty)) * (Decimal(up_cents) / 100)))
                    items.append({
                        "oz": oz[:64],
                        "title": _item_title(child, ns, oz),
                        "qty": qty,
                        "unit": (_child_text(child, ns, "QU") or "").strip()[:12],
                        "up_cents": up_cents,
                        "it_cents": it_cents,
                    })
                else:
                    walk(child, new_path)
            elif local in ("BoQ", "BoQBody", "Itemlist", "Award"):
                walk(child, path)

    if award is None:
        raise GaebImportError("Kein <Award>-Block — kein vollständiges GAEB-Dokument.")
    walk(award, [])
    if not items:
        raise GaebImportError("Keine Positionen gefunden — das LV ist leer.")
    if sum(1 for it in items if it["up_cents"] is not None) == 0:
        raise GaebImportError(
            "Keine Preise gefunden — das ist eine Ausschreibung (ohne Preise), "
            "kein Angebot. Bitte die bepreiste Datei des Unternehmens senden lassen."
        )
    return {
        "dp": dp,
        "da_version": da_version,
        "cur": cur,
        "items": items,
        "item_count": len(items),
        "ohne_preis_count": sum(1 for it in items if it["up_cents"] is None),
        "gp_total_cents": sum(it["it_cents"] or 0 for it in items),
    }
