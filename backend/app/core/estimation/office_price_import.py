"""
§50 — Import de la bibliothèque de prix d'un bureau : CSV ou GAEB X31.

Parser DÉTERMINISTE, sans LLM : chaque ligne du fichier est soit acceptée
(avec preuve) soit rejetée avec une raison écrite — jamais de donnée
fabriquée (charte §36). Le rapport d'import liste explicitement les rejets.

CSV attendu (souple sur les entêtes, séparateur auto `;` ou `,`) :
    oz;kurztext;einheit;ep;jahr
    02.003.1002;Außenwand Mauerwerk 36,5 cm;m²;189,50;2025
Alias d'entêtes reconnus : oz/pos/position/posnr/ordnungszahl ·
kurztext/text/bezeichnung/titel · einheit/me/unit · ep/preis/einheitspreis/up ·
jahr/preisstand/year (optionnel — sinon paramètre de l'appel).

GAEB X31 : lecture tolérante aux espaces de noms (DA 3.1/3.2/3.3) — on
parcourt les <Item> et on extrait RNoPart (OZ), QU (einheit), UP (prix) et
le texte court (ShortText/span). Les types BL/SOL ne sont pas tarifés : rejet
motivé. Le millésime X31 n'existant pas dans la norme, `jahr` vient du
paramètre d'import.
"""

from __future__ import annotations

import csv
import io
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Dict, List, Optional, Tuple

MAX_ROWS = 50_000
MAX_PRICE = Decimal("1000000")  # garde-fou anti-erreur de saisie (1 M€/unité)
_CENT = Decimal("0.01")

OZ_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z.\-/]{0,31}$")
YEAR_RE = re.compile(r"^(19|20)\d{2}$")

# Détection Kostengruppe par mots-clés SANS ambiguïté : une seule famille
# peut frapper, sinon None (jamais deviné). Clés WorkCategory du moteur.
_KG_RULES: List[Tuple[str, List[str]]] = [
    ("kg320_aussenwaende_rohbau", ["außenwand", "mauerwerk", "tragende wand", "rohbauwand", "schalung", "beton c"]),
    ("kg330_innenwaende", ["innenwand", "trockenbau", "gipskarton"]),
    ("kg340_decken", ["decke stahlbeton", "geschossdecke", "stahlbetondecke", "stütze"]),
    ("kg350_dachwerk", ["dachstuhl", "dachkonstruktion", "holzdach"]),
    ("kg360_dachhaut", ["dachdeckung", "dachabdichtung", "dachhaut", "dachbahn"]),
    ("kg361_fenster_aussentueren", ["fenster", "außentür", "haustür"]),
    ("kg362_innentueren", ["innentür", "zimmertür"]),
    ("kg363_belaege_wand", ["wandbelag", "fliesen wand", "wandfliesen", "putz innen", "malte", "maler"]),
    ("kg364_belaege_boden", ["bodenbelag", "estrich", "fliesen boden", "bodenfliesen", "parkett", "linoleum"]),
    ("kg365_waermedaemmung", ["wdvs", "wärmedämmung", "dämmung", "dämmplatte"]),
    ("kg366_treppen", ["treppe", "geländer"]),
    ("kg310_gruendung", ["fundament", "bodenplatte", "pfähle", "pfahl", "gründung"]),
    ("kg210_grundstueck_vorbereitung", ["baugrube", "aushub", "abbruch", "rückbau", "erdaushub"]),
    ("kg420_heizung", ["heizung", "heizkörper", "wärmepumpe", "kessel"]),
    ("kg430_lueftung", ["lüftung", "lüftungsanlage", "kanal lüftung"]),
    ("kg440_elektro", ["elektro", "steckdose", "kabel", "schaltanlage", "blitzschutz"]),
    ("kg410_abwasser", ["sanitär", "abwasser", "wc ", "waschtisch", "rohrleitung sanitär"]),
    ("kg500_aussenanlagen", ["außenanlage", "befestigung", "pflaster", "rasen", "baumpflanzung", "einfriedung"]),
]

_HEADER_ALIASES: Dict[str, List[str]] = {
    "oz": ["oz", "pos", "position", "posnr", "pos.nr", "pos.-nr.", "ordnungszahl", "positionsnr", "nr"],
    "kurztext": ["kurztext", "text", "bezeichnung", "titel", "leistung", "beschreibung", "shorttext"],
    "einheit": ["einheit", "me", "unit", "mengeneinheit"],
    "ep": ["ep", "preis", "einheitspreis", "up", "unitpreis", "einheitspreis_netto", "ep_netto", "preis_netto"],
    "jahr": ["jahr", "preisstand", "stand", "year", "preisstand_jahr"],
}


@dataclass
class ImportedPrice:
    oz: str
    kurztext: str
    einheit: str
    einheitspreis_netto: Decimal
    preisstand_jahr: int
    kostengruppe: Optional[str]
    kg_confiance: Optional[float]


@dataclass
class ImportRejection:
    row: int          # 1-basiert (fichier source hors en-tête)
    oz: str
    reason: str


@dataclass
class ImportResult:
    kind: str                         # csv | x31
    accepted: List[ImportedPrice] = field(default_factory=list)
    rejected: List[ImportRejection] = field(default_factory=list)
    detected_headers: Dict[str, str] = field(default_factory=dict)


def detect_kostengruppe(kurztext: str) -> Tuple[Optional[str], Optional[float]]:
    """Associe une ligne à UNE Kostengruppe ou à rien.
    Un seul coup de règle suffit si un seul groupe matche ; si deux familles
    matchent → ambigu → None (honnêteté)."""
    text = kurztext.lower()
    hits = [kg for kg, keywords in _KG_RULES if any(k in text for k in keywords)]
    unique = list(dict.fromkeys(hits))
    if len(unique) == 1:
        return unique[0], 0.9
    return None, None


def _q2(value: Decimal) -> Decimal:
    return value.quantize(_CENT, rounding=ROUND_HALF_UP)


def _parse_german_number(raw: str) -> Optional[Decimal]:
    """« 189,50 » / « 1.234,56 » / « 189.50 » → Decimal ; None si illisible."""
    s = raw.strip().replace("€", "").replace(" ", "")
    if not s:
        return None
    if "," in s and "." in s:  # 1.234,56 (de)
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def _norm_header(h: str) -> str:
    return re.sub(r"[^a-zäöü0-9]+", "", h.strip().lower())


def _resolve_headers(fieldnames: List[str]) -> Dict[str, str]:
    """Mappe les colonnes canoniques sur les entêtes réels du fichier."""
    norm_map = {_norm_header(h): h for h in fieldnames}
    resolved: Dict[str, str] = {}
    for canon, aliases in _HEADER_ALIASES.items():
        for alias in aliases:
            key = _norm_header(alias)
            if key in norm_map:
                resolved[canon] = norm_map[key]
                break
    return resolved


def parse_csv_prices(data: bytes, jahr_fallback: int) -> ImportResult:
    result = ImportResult(kind="csv")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = data.decode("latin-1")
        except UnicodeDecodeError:
            result.rejected.append(ImportRejection(0, "-", "Datei nicht lesbar (weder UTF-8 noch Latin-1)."))
            return result

    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    if not reader.fieldnames:
        result.rejected.append(ImportRejection(0, "-", "Keine Kopfzeile gefunden."))
        return result

    headers = _resolve_headers(list(reader.fieldnames))
    result.detected_headers = headers
    missing = [c for c in ("oz", "kurztext", "einheit", "ep") if c not in headers]
    if missing:
        result.rejected.append(
            ImportRejection(0, "-", f"Pflichtspalte(n) fehlen: {', '.join(missing)} — erwartet u. a. oz;kurztext;einheit;ep")
        )
        return result

    for row_no, row in enumerate(reader, start=1):
        if row_no > MAX_ROWS:
            result.rejected.append(ImportRejection(row_no, "-", f"Abbruch: mehr als {MAX_ROWS} Zeilen."))
            break
        oz = (row.get(headers["oz"]) or "").strip()
        kurztext = (row.get(headers["kurztext"]) or "").strip()
        einheit = (row.get(headers["einheit"]) or "").strip()
        ep_raw = (row.get(headers["ep"]) or "").strip()

        if not oz and not kurztext and not ep_raw:
            continue  # ligne vide : ignorée silencieusement
        if not OZ_RE.match(oz):
            result.rejected.append(ImportRejection(row_no, oz or "-", "OZ fehlt oder ungültig."))
            continue
        if not kurztext:
            result.rejected.append(ImportRejection(row_no, oz, "Kurztext leer."))
            continue
        if not einheit:
            result.rejected.append(ImportRejection(row_no, oz, "Einheit fehlt."))
            continue
        ep = _parse_german_number(ep_raw)
        if ep is None or ep <= 0:
            result.rejected.append(ImportRejection(row_no, oz, f"EP nicht lesbar/positiv: « {ep_raw} »."))
            continue
        if ep > MAX_PRICE:
            result.rejected.append(ImportRejection(row_no, oz, f"EP > {MAX_PRICE} € — Eingabefehler?"))
            continue

        jahr = jahr_fallback
        if "jahr" in headers:
            jahr_raw = (row.get(headers["jahr"]) or "").strip()
            if jahr_raw:
                if YEAR_RE.match(jahr_raw):
                    jahr = int(jahr_raw)
                else:
                    result.rejected.append(ImportRejection(row_no, oz, f"Jahr ungültig: « {jahr_raw} »."))
                    continue

        kg, conf = detect_kostengruppe(kurztext)
        result.accepted.append(
            ImportedPrice(
                oz=oz, kurztext=kurztext[:500], einheit=einheit[:24],
                einheitspreis_netto=_q2(ep), preisstand_jahr=jahr,
                kostengruppe=kg, kg_confiance=conf,
            )
        )
    return result


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _first_text(element: ET.Element, names: Tuple[str, ...]) -> Optional[str]:
    for child in element.iter():
        if _local(child.tag) in names and child.text and child.text.strip():
            return child.text.strip()
    return None


def parse_gaeb_x31_prices(data: bytes, jahr: int) -> ImportResult:
    result = ImportResult(kind="x31")
    try:
        root = ET.fromstring(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, ET.ParseError) as exc:
        result.rejected.append(ImportRejection(0, "-", f"XML nicht parsebar: {type(exc).__name__}."))
        return result
    if _local(root.tag) != "GAEB":
        result.rejected.append(ImportRejection(0, "-", "Kein GAEB-Dokument (Wurzel ≠ GAEB)."))
        return result

    row_no = 0
    for item in root.iter():
        if _local(item.tag) != "Item":
            continue
        row_no += 1
        if row_no > MAX_ROWS:
            result.rejected.append(ImportRejection(row_no, "-", f"Abbruch: mehr als {MAX_ROWS} Positionen."))
            break
        oz = item.attrib.get("RNoPart", "").strip()
        lot = _first_text(item, ("ID",)) if not oz else oz  # secours : attribut ID
        oz = oz or (lot or "")
        if not OZ_RE.match(oz):
            result.rejected.append(ImportRejection(row_no, oz or "-", "RNoPart/OZ fehlt oder ungültig."))
            continue
        kurztext = _first_text(item, ("ShortText",)) or _first_text(item, ("span",))
        if not kurztext:
            result.rejected.append(ImportRejection(row_no, oz, "Kurztext fehlt."))
            continue
        einheit = (_first_text(item, ("QU",)) or "").strip()
        if not einheit:
            result.rejected.append(ImportRejection(row_no, oz, "QU (Einheit) fehlt."))
            continue
        up_raw = _first_text(item, ("UP",))
        if up_raw is None:
            result.rejected.append(ImportRejection(row_no, oz, "Kein UP (nicht bepreist — z. B. Hinweisposition)."))
            continue
        ep = _parse_german_number(up_raw)
        if ep is None or ep <= 0:
            result.rejected.append(ImportRejection(row_no, oz, f"UP nicht lesbar/positiv: « {up_raw} »."))
            continue
        if ep > MAX_PRICE:
            result.rejected.append(ImportRejection(row_no, oz, f"UP > {MAX_PRICE} € — Eingabefehler?"))
            continue

        kg, conf = detect_kostengruppe(kurztext)
        result.accepted.append(
            ImportedPrice(
                oz=oz, kurztext=kurztext[:500], einheit=einheit[:24],
                einheitspreis_netto=_q2(ep), preisstand_jahr=jahr,
                kostengruppe=kg, kg_confiance=conf,
            )
        )
    return result


def sniff_kind(filename: str, data: bytes) -> str:
    """csv | x31 — d'après l'extension, le contenu en secours."""
    name = filename.lower()
    if name.endswith((".x31", ".xml", ".gaeb", ".p31")):
        return "x31"
    if name.endswith((".csv", ".txt")):
        return "csv"
    head = data.lstrip()[:64].lower()
    return "x31" if head.startswith(b"<") else "csv"


def parse_office_prices(filename: str, data: bytes, jahr_fallback: int) -> ImportResult:
    kind = sniff_kind(filename, data)
    if kind == "x31":
        return parse_gaeb_x31_prices(data, jahr_fallback)
    return parse_csv_prices(data, jahr_fallback)
