"""§129 — ZUGFeRD / Factur-X : facture hybride (PDF/A-3 + XML embarqué).
§150 — gabarit PROFESSIONNEL : bandeau de marque plein-format, logo du
bureau (branding §77), tableau soigné, totaux alignés, pied de page.

Demande (chantier 2, suite KoSIT §123) : la « facture hybride » — un seul
fichier PDF que le client lit à l'écran ET dont la machine extrait le XML
structuré (`factur-x.xml`) — la même famille que l'obligation B2B 2027/28.

Ce que ce module FAIT, honnêtement :
  * rend une facture visible en allemand avec un GABARIT SOIGNÉ (bandeau
    sombre + liseré, logo du bureau s'il existe, blocs Absender/Empfänger,
    bloc méta, tableau des positions avec lignes alternées, totaux alignés
    à droite, Bankverbindung, pied de page avec numéro de page) — police
    VERA embarquée (fournie AVEC reportlab) ;
  * embarque le XML CII produit par app/services/xrechnung.py (profil
    `en16931` — celui de ZUGFeRD/Factur-X, PAS l'extension XRechnung qui
    exige Leitweg-ID/IBAN) sous le nom canonique `factur-x.xml`, avec
    `/AFRelationship /Alternative` et le sous-type MIME `text/xml` ;
  * ajoute les métadonnées XMP PDF/A-3 (`pdfaid:part=3`, `conformance=B`)
    + l'extension Factur-X (`fx:` : DocumentType, DocumentFileName,
    Version, ConformanceLevel) ;
  * ajoute un OutputIntent sRGB (profil ICC embarqué) — exigence PDF/A.

Le LOGO (branding §77, table `tenant_brandings`) : décodé depuis le base64
PNG/JPEG, jamais altéré ; illisible → l'en-tête retombe sur le nom seul
(jamais d'image cassée). Pillow est requis pour le décodage (dépendance
DÉCLARÉE dans requirements-api.txt, §150).

Ce que ce module ne PRÉTEND PAS (règle de la maison — on prouve, ou on
dit qu'on ne sait pas encore) :
  * La conformité PDF/A-3 ISO 19005-3 STRICTE (veraPDF) n'est PAS
    affirmée par ce code seul : la preuve réelle se mesure via le
    validateur officiel Mustang (`scripts/valider-zugferd-mustang.sh`) —
    re-mesurée à chaque retouche (dont l'ajout du logo §150).
  * Le XML embarqué est VALIDE (Mustang : 0 règle échouée) — c'est la
    partie métier, déjà éprouvée §114/§123.

Provenance : écrit en salle blanche à partir du standard public Factur-X
1.0 / ZUGFeRD 2.x et du PDF 32000-1 (embedded files, name tree, XMP).
Aucun code tiers copié (doctrine §114 — zéro ligne AGPL chez nous).
"""
from __future__ import annotations

import base64
import os
from decimal import Decimal
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfdoc
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as canvas_module
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.services.xrechnung import Facture, calculer_totaux

# --- Patch EOL PDF/A (veraPDF §6.1.7.1 : un marqueur de fin de ligne DOIT
#     précéder « endstream » ; reportlab écrit le contenu collé à endstream,
#     ce qui viole PDF/A). Patch minimal et local : on n'insère un LF que
#     s'il manque, juste avant le DERNIER « endstream » (le vrai terminateur
#     de CE stream — rfind cible la fin, un faux positif binaire est exclu).
_ORIG_STREAM_FORMAT = pdfdoc.PDFStream.format


def _format_stream_pdfa(self, document):
    out = _ORIG_STREAM_FORMAT(self, document)
    idx = out.rfind(b"endstream")
    if idx > 0 and out[idx - 1 : idx] != b"\n":
        out = out[:idx] + b"\n" + out[idx:]
    return out


pdfdoc.PDFStream.format = _format_stream_pdfa

# --- reportlab ne sérialise PAS /OutputIntents dans le catalogue (clé
#     absente de PDFCatalog.__NoDefault__) : on l'ajoute, sinon l'OutputIntent
#     est écrit mais JAMAIS référencé depuis /Catalog → veraPDF dit
#     « DeviceRGB without output intent » alors que le profil est là.
if "OutputIntents" not in pdfdoc.PDFCatalog.__NoDefault__:
    pdfdoc.PDFCatalog.__NoDefault__.append("OutputIntents")
if "OutputIntents" not in pdfdoc.PDFCatalog.__Refs__:
    pdfdoc.PDFCatalog.__Refs__.append("OutputIntents")
# Idem pour /AF (tableau des « fichiers associés ») : veraPDF 6.8 test 4
# exige que le filespec soit référencé depuis /AF, sinon « not associated ».
if "AF" not in pdfdoc.PDFCatalog.__NoDefault__:
    pdfdoc.PDFCatalog.__NoDefault__.append("AF")
if "AF" not in pdfdoc.PDFCatalog.__Refs__:
    pdfdoc.PDFCatalog.__Refs__.append("AF")

# --- Police embarquée : VERA (Bitstream Vera, fournie AVEC reportlab).
#     PDF/A exige des polices embarquées : Helvetica (police standard,
#     jamais embarquée) est INTERDITE ici.
_VERA_DIR = os.path.join(
    os.path.dirname(os.path.abspath(canvas_module.__file__)), "..", "fonts"
)
_VERA_REGULAR = os.path.abspath(os.path.join(_VERA_DIR, "Vera.ttf"))
_VERA_BOLD = os.path.abspath(os.path.join(_VERA_DIR, "VeraBd.ttf"))

_FONT_REGULAR = "NarchiVera"
_FONT_BOLD = "NarchiVera-Bold"
_FONTS_READY = False


def _prepare_fonts() -> None:
    global _FONTS_READY
    if _FONTS_READY:
        return
    pdfmetrics.registerFont(TTFont(_FONT_REGULAR, _VERA_REGULAR))
    pdfmetrics.registerFont(TTFont(_FONT_BOLD, _VERA_BOLD))
    _FONTS_READY = True


# --- Profil ICC sRGB (OutputIntent PDF/A). Matrice-shaper sRGB IEC 61966-2.1
#     (588 octets, standard public) EMBARQUÉE en constante base64 : zéro
#     dépendance (pas de Pillow pour ça), reproductible à l'octet près.
_SRGB = base64.b64decode(
    "AAACTGxjbXMEQAAAbW50clJHQiBYWVogB+oACAAQAA8ANgATYWNzcEFQUEwAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1sY21zAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAALZGVzYwAAAQgAAAA2Y3BydAAAAUAAAABMd3RwdAAAAYwAAAAUY2hh"
    "ZAAAAaAAAAAsclhZWgAAAcwAAAAUYlhZWgAAAeAAAAAUZ1hZWgAAAfQAAAAUclRSQwAAAggAAAAg"
    "Z1RSQwAAAggAAAAgYlRSQwAAAggAAAAgY2hybQAAAigAAAAkbWx1YwAAAAAAAAABAAAADGVuVVMA"
    "AAAaAAAAHABzAFIARwBCACAAYgB1AGkAbAB0AC0AaQBuAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAA"
    "ADAAAAAcAE4AbwAgAGMAbwBwAHkAcgBpAGcAaAB0ACwAIAB1AHMAZQAgAGYAcgBlAGUAbAB5WFla"
    "IAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDEIAAAXe///zJQAAB5MAAP2Q///7of///aIAAAPc"
    "AADAblhZWiAAAAAAAABvoAAAOPUAAAOQWFlaIAAAAAAAACSfAAAPhAAAtsNYWVogAAAAAAAAYpcA"
    "ALeHAAAY2XBhcmEAAAAAAAMAAAACZmYAAPKnAAANWQAAE9AAAApbY2hybQAAAAAAAwAAAACj1wAA"
    "VHsAAEzNAACZmgAAJmYAAA9c"
)

# Constantes Factur-X (standard public).
FX_NS = "urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"
PDFAID_NS = "http://www.aiim.org/pdfa/ns/id/"


def _xmp_packet(numero: str, date_emission: str) -> bytes:
    """XMP : identité PDF/A-3 (part=3, conformance=B) + extension Factur-X."""
    return (
        '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n'
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n'
        ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n'
        f'  <rdf:Description rdf:about="" xmlns:pdfaid="{PDFAID_NS}">\n'
        "   <pdfaid:part>3</pdfaid:part>\n"
        "   <pdfaid:conformance>B</pdfaid:conformance>\n"
        "  </rdf:Description>\n"
        f'  <rdf:Description rdf:about="" xmlns:fx="{FX_NS}">\n'
        "   <fx:DocumentType>INVOICE</fx:DocumentType>\n"
        "   <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>\n"
        "   <fx:Version>1.0</fx:Version>\n"
        "   <fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>\n"
        "  </rdf:Description>\n"
        '  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
        "   <dc:title><rdf:Alt><rdf:li xml:lang=\"x-default\">"
        f"Rechnung {numero}</rdf:li></rdf:Alt></dc:title>\n"
        "  </rdf:Description>\n"
        '  <rdf:Description rdf:about="" '
        'xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" '
        'xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" '
        'xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">\n'
        "   <pdfaExtension:schemas><rdf:Bag>\n"
        '    <rdf:li rdf:parseType="Resource">\n'
        "     <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>\n"
        f'     <pdfaSchema:namespaceURI>{FX_NS}</pdfaSchema:namespaceURI>\n'
        "     <pdfaSchema:prefix>fx</pdfaSchema:prefix>\n"
        "     <pdfaSchema:property><rdf:Seq>\n"
        '      <rdf:li rdf:parseType="Resource">'
        "<pdfaProperty:name>DocumentFileName</pdfaProperty:name>"
        "<pdfaProperty:valueType>Text</pdfaProperty:valueType>"
        "<pdfaProperty:category>external</pdfaProperty:category>"
        "<pdfaProperty:description>name of the embedded XML invoice file"
        "</pdfaProperty:description></rdf:li>\n"
        '      <rdf:li rdf:parseType="Resource">'
        "<pdfaProperty:name>DocumentType</pdfaProperty:name>"
        "<pdfaProperty:valueType>Text</pdfaProperty:valueType>"
        "<pdfaProperty:category>external</pdfaProperty:category>"
        "<pdfaProperty:description>INVOICE</pdfaProperty:description></rdf:li>\n"
        '      <rdf:li rdf:parseType="Resource">'
        "<pdfaProperty:name>Version</pdfaProperty:name>"
        "<pdfaProperty:valueType>Text</pdfaProperty:valueType>"
        "<pdfaProperty:category>external</pdfaProperty:category>"
        "<pdfaProperty:description>version of the Factur-X standard"
        "</pdfaProperty:description></rdf:li>\n"
        '      <rdf:li rdf:parseType="Resource">'
        "<pdfaProperty:name>ConformanceLevel</pdfaProperty:name>"
        "<pdfaProperty:valueType>Text</pdfaProperty:valueType>"
        "<pdfaProperty:category>external</pdfaProperty:category>"
        "<pdfaProperty:description>EN 16931</pdfaProperty:description></rdf:li>\n"
        "     </rdf:Seq></pdfaSchema:property>\n"
        "    </rdf:li>\n"
        "   </rdf:Bag></pdfaExtension:schemas>\n"
        "  </rdf:Description>\n"
        " </rdf:RDF>\n"
        "</x:xmpmeta>\n"
        '<?xpacket end="w"?>'
    ).encode("utf-8")


def _fmt_eur(v: str) -> str:
    """Chaîne décimale (« 569.64 ») → affichage allemand « 569,64 € ». """
    if "." in v:
        ent, dec = v.split(".", 1)
        dec = (dec + "00")[:2]
    else:
        ent, dec = v, "00"
    milliers = f"{int(ent):,}".replace(",", ".")
    return f"{milliers},{dec} \u20AC"


def _fmt_date_iso(iso: str) -> str:
    """« 2026-08-11 » → « 11.08.2026 » (affichage allemand). """
    if len(iso) == 10 and iso[4] == "-" and iso[7] == "-":
        return f"{iso[8:10]}.{iso[5:7]}.{iso[0:4]}"
    return iso


# --- Palette §251 : Briefbogen (weiß, Bronze-Akzent, kein Vollbanner) ------
C_INK = colors.HexColor("#1c1917")
C_MUTED = colors.HexColor("#57534e")
C_LINE = colors.HexColor("#d6d3d1")
C_ACCENT = colors.HexColor("#b45309")
C_PAPER = colors.HexColor("#fafaf9")
C_WHITE = colors.HexColor("#ffffff")
C_TH_BG = colors.HexColor("#f5f5f4")
C_TOTAL_BG = colors.HexColor("#1c1917")
C_TOTAL_FG = colors.HexColor("#fafaf9")
C_BAND = C_INK
C_BAND_ACCENT = C_ACCENT
C_BAND_MUTED = C_MUTED
C_TEXT = C_INK
C_META_BG = C_PAPER
C_ZEBRA = C_PAPER
C_GRID = C_LINE


def _logo_image(logo_b64: str | None):
    """Logo du bureau (base64 PNG/JPEG) → (ImageReader, largeur, hauteur)
    mis à l'échelle pour l'en-tête. None si absent/illisible.

    HONNÊTETÉ : le logo est DÉCODÉ mais jamais ré-encodé ni altéré. Illisible
    → on n'affiche PAS de logo (l'en-tête retombe sur le nom seul) — jamais
    d'image cassée.
    """
    if not logo_b64:
        return None
    try:
        raw = base64.b64decode(logo_b64, validate=True)
    except Exception:
        return None
    try:
        rdr = ImageReader(BytesIO(raw))
        iw, ih = rdr.getSize()
    except Exception:
        return None
    if iw <= 0 or ih <= 0:
        return None
    max_h = 1.5 * cm
    max_w = 5.0 * cm
    ratio = min(max_w / iw, max_h / ih)
    return (rdr, iw * ratio, ih * ratio)


def _office_name(office_name: str | None, facture: Facture) -> str:
    """Nom du bureau pour l'en-tête/pied : branding §77 sinon le vendeur."""
    if office_name and office_name.strip():
        return office_name.strip()
    return facture.vendeur.nom.strip() or "Architekturbüro"


def _header_footer(logo, bureau: str, facture: Facture):
    """Briefkopf DIN-artig: dünne Akzentlinie, Logo/Name, kein Vollflächen-Banner."""

    def dessiner(canvas, doc):
        w, h = A4
        canvas.saveState()
        canvas.setFillColor(C_ACCENT)
        canvas.rect(0, h - 0.18 * cm, w, 0.18 * cm, stroke=0, fill=1)

        x = 1.8 * cm
        y_logo = h - 2.35 * cm
        if logo is not None:
            rdr, lw, lh = logo
            canvas.drawImage(rdr, x, y_logo, width=lw, height=lh, mask="auto")
            x += lw + 0.45 * cm
        canvas.setFillColor(C_INK)
        canvas.setFont(_FONT_BOLD, 11)
        canvas.drawString(x, h - 1.55 * cm, bureau[:70])
        canvas.setFont(_FONT_REGULAR, 7.5)
        canvas.setFillColor(C_MUTED)
        v = facture.vendeur
        abs_line = " · ".join(
            p for p in (
                f"{v.rue}".strip() if v.rue else "",
                f"{v.code_postal} {v.ville}".strip(),
                f"USt-IdNr. {v.vat_id}" if v.vat_id else "",
            ) if p
        )
        canvas.drawString(x, h - 2.05 * cm, abs_line[:95])

        canvas.setFillColor(C_INK)
        canvas.setFont(_FONT_BOLD, 16)
        canvas.drawRightString(w - 1.8 * cm, h - 1.55 * cm, "Rechnung")
        canvas.setFont(_FONT_REGULAR, 8)
        canvas.setFillColor(C_MUTED)
        canvas.drawRightString(
            w - 1.8 * cm,
            h - 2.05 * cm,
            f"{facture.numero}  ·  {_fmt_date_iso(facture.date_emission)}",
        )

        canvas.setStrokeColor(C_LINE)
        canvas.setLineWidth(0.4)
        canvas.line(1.8 * cm, 1.55 * cm, w - 1.8 * cm, 1.55 * cm)
        canvas.setFont(_FONT_REGULAR, 7)
        canvas.setFillColor(C_MUTED)
        bank = ""
        if facture.iban:
            bank = f"IBAN {facture.iban.replace(' ', '')}"
            if facture.bic:
                bank += f"  ·  BIC {facture.bic.replace(' ', '')}"
        pied = "  ·  ".join(p for p in (bureau[:40], bank, f"Seite {canvas.getPageNumber()}") if p)
        canvas.drawString(1.8 * cm, 1.15 * cm, pied[:110])
        canvas.restoreState()

    return dessiner, dessiner


class _ZugferdCanvas(canvas_module.Canvas):
    """Canvas qui injecte l'embarqué + XMP + OutputIntent AVANT save().

    Platypus dessine le contenu visible sur CE canvas ; au save(), on ajoute
    les objets PDF/A manquants via pdfdoc (reportlab ne sait pas le faire
    nativement).
    """

    def __init__(self, *args, xml_bytes: bytes = b"", xmp: bytes = b"", **kwargs):
        super().__init__(*args, **kwargs)
        self._zugferd_xml = xml_bytes
        self._zugferd_xmp = xmp

    def save(self):
        doc = self._doc
        doc._pdfVersion = (1, 7)

        # --- Fichier embarqué factur-x.xml ---------------------------------
        ef_ref = doc.Reference(
            pdfdoc.PDFStream(
                pdfdoc.PDFDictionary({
                    "Type": pdfdoc.PDFName("EmbeddedFile"),
                    # MIME « text/xml » : nom PDF correct = « text#2Fxml ».
                    "Subtype": "/text#2Fxml",
                }),
                self._zugferd_xml,
                filters=[],
            ),
            "ZugferdEmbeddedFile",
        )
        fs_ref = doc.Reference(
            pdfdoc.PDFDictionary({
                "Type": pdfdoc.PDFName("Filespec"),
                "F": pdfdoc.PDFString("factur-x.xml"),
                "UF": pdfdoc.PDFString("factur-x.xml"),
                "AFRelationship": pdfdoc.PDFName("Alternative"),
                "Desc": pdfdoc.PDFString("Factur-X/ZUGFeRD-Rechnung"),
                "EF": pdfdoc.PDFDictionary({"F": ef_ref, "UF": ef_ref}),
            }),
            "ZugferdFilespec",
        )
        nt_ref = doc.Reference(
            pdfdoc.PDFDictionary({
                "Names": pdfdoc.PDFArray([
                    pdfdoc.PDFString("factur-x.xml"), fs_ref,
                ]),
            }),
            "ZugferdNameTree",
        )
        doc.Catalog.Names = pdfdoc.PDFDictionary({"EmbeddedFiles": nt_ref})

        # --- Association /AF (veraPDF 6.8 test 4) --------------------------
        doc.Catalog.AF = pdfdoc.PDFArray([fs_ref])

        # --- Métadonnées XMP ------------------------------------------------
        doc.Catalog.Metadata = pdfdoc.PDFStream(
            pdfdoc.PDFDictionary({
                "Type": pdfdoc.PDFName("Metadata"),
                "Subtype": pdfdoc.PDFName("XML"),
            }),
            self._zugferd_xmp,
        )

        # --- OutputIntent sRGB ---------------------------------------------
        if _SRGB:
            icc_ref = doc.Reference(
                pdfdoc.PDFStream(pdfdoc.PDFDictionary({"N": 3}), _SRGB),
                "ZugferdICC",
            )
            oi_ref = doc.Reference(
                pdfdoc.PDFDictionary({
                    "Type": pdfdoc.PDFName("OutputIntent"),
                    "S": pdfdoc.PDFName("GTS_PDFA1"),
                    "Info": pdfdoc.PDFString("sRGB IEC61966-2.1"),
                    "OutputConditionIdentifier": pdfdoc.PDFString("sRGB IEC61966-2.1"),
                    "DestOutputProfile": icc_ref,
                }),
                "ZugferdOutputIntent",
            )
            doc.Catalog.OutputIntents = pdfdoc.PDFArray([oi_ref])

        super().save()


def generer_pdf_zugferd(
    facture: Facture,
    xml_cii: str,
    *,
    logo_b64: str | None = None,
    office_name: str | None = None,
) -> bytes:
    """Facture hybride PROFESSIONNELLE : PDF visible (gabarit soigné + logo du
    bureau) + factur-x.xml embarqué + XMP + OutputIntent.

    Args:
        facture: le modèle du service xrechnung (pour le rendu visible).
        xml_cii: le XML CII D16B — au profil `en16931` (construire_cii(..., "en16931")).
        logo_b64: logo du bureau (base64 PNG/JPEG, table tenant_brandings §77) —
            optionnel ; absent → l'en-tête retombe sur le nom seul.
        office_name: nom affiché du bureau (branding §77) — sinon le vendeur.

    Returns:
        les octets du PDF hybride (aucun fichier écrit — retour mémoire).
    """
    _prepare_fonts()
    xmp = _xmp_packet(facture.numero, facture.date_emission)
    bureau = _office_name(office_name, facture)
    logo = _logo_image(logo_b64)

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        title=f"Rechnung {facture.numero}",
        author=bureau,
        subject="ZUGFeRD-Rechnung",
        leftMargin=1.8 * cm,
        rightMargin=1.8 * cm,
        topMargin=2.8 * cm,
        bottomMargin=2.2 * cm,
    )
    _canvasmaker = lambda *a, **k: _ZugferdCanvas(
        *a, xml_bytes=xml_cii.encode("utf-8"), xmp=xmp, **k
    )
    on_first, on_later = _header_footer(logo, bureau, facture)

    label = ParagraphStyle("label", fontName=_FONT_BOLD, fontSize=7, leading=9, textColor=C_MUTED)
    cell = ParagraphStyle("cell", fontName=_FONT_REGULAR, fontSize=9, leading=12, textColor=C_INK)
    cell_b = ParagraphStyle("cellb", fontName=_FONT_BOLD, fontSize=9, leading=12, textColor=C_INK)
    tot_w = ParagraphStyle("totw", fontName=_FONT_BOLD, fontSize=10, leading=13, textColor=C_TOTAL_FG)
    tot_l = ParagraphStyle("totl", fontName=_FONT_REGULAR, fontSize=8, leading=11, textColor=C_MUTED)

    vendeur = facture.vendeur
    acheteur = facture.acheteur
    elements: list = []

    abs_tiny = " · ".join(
        p for p in (vendeur.nom, vendeur.rue, f"{vendeur.code_postal} {vendeur.ville}".strip()) if p
    )
    empfaenger = [
        Paragraph("Empfänger", label),
        Paragraph(abs_tiny[:90] or " ", ParagraphStyle(
            "tiny", fontName=_FONT_REGULAR, fontSize=6.5, leading=8, textColor=C_MUTED,
        )),
        Spacer(1, 0.12 * cm),
        Paragraph(f"<b>{acheteur.nom}</b>", cell_b),
    ]
    if acheteur.rue:
        empfaenger.append(Paragraph(acheteur.rue, cell))
    if acheteur.code_postal or acheteur.ville:
        empfaenger.append(Paragraph(f"{acheteur.code_postal} {acheteur.ville}".strip(), cell))
    if acheteur.pays and acheteur.pays != "DE":
        empfaenger.append(Paragraph(acheteur.pays, cell))

    meta_bits = [
        ("Rechnungsnr.", facture.numero),
        ("Rechnungsdatum", _fmt_date_iso(facture.date_emission)),
        ("Leistungsdatum", _fmt_date_iso(facture.date_livraison) if facture.date_livraison else "—"),
        ("Fällig am", _fmt_date_iso(facture.date_echeance) if facture.date_echeance else "—"),
    ]
    if facture.reference_acheteur:
        meta_bits.append(("Leitweg-ID", facture.reference_acheteur))
    meta_flow = [[Paragraph(k, label), Paragraph(v, cell_b)] for k, v in meta_bits]
    meta = Table(meta_flow, colWidths=[3.2 * cm, 4.4 * cm])
    meta.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LINEBELOW", (0, 0), (-1, -2), 0.3, C_LINE),
    ]))
    kopf = Table([[empfaenger, meta]], colWidths=[8.8 * cm, 7.8 * cm])
    kopf.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    elements.append(kopf)
    elements.append(Spacer(1, 0.55 * cm))
    elements.append(Paragraph("Leistungen", ParagraphStyle(
        "h2", fontName=_FONT_BOLD, fontSize=10, leading=13, textColor=C_INK,
    )))
    elements.append(Spacer(1, 0.18 * cm))

    # --- Tableau des positions (professionnel) ------------------------------
    entetes = [
        Paragraph("Pos.", label), Paragraph("Leistung", label),
        Paragraph("Menge", label), Paragraph("Einh.", label),
        Paragraph("EP", label), Paragraph("USt.", label),
        Paragraph("Betrag", label),
    ]
    lignes = [entetes]
    _cent = Decimal("0.01")
    for i, li in enumerate(facture.lignes, start=1):
        net = (li.quantite * li.prix_unitaire_ht).quantize(_cent)
        lignes.append([
            Paragraph(str(i), cell),
            Paragraph(li.designation, cell),
            Paragraph(str(li.quantite), cell),
            Paragraph(li.unite, cell),
            Paragraph(_fmt_eur(str(li.prix_unitaire_ht)), cell),
            Paragraph(f"{li.taux_tva} %", cell),
            Paragraph(_fmt_eur(str(net)), cell),
        ])
    tot = calculer_totaux(facture.lignes)
    table = Table(lignes, colWidths=[
        1.1 * cm, 6.3 * cm, 1.5 * cm, 1.6 * cm, 2.4 * cm, 1.5 * cm, 2.8 * cm,
    ], repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), C_TH_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), C_WHITE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (2, 0), (2, -1), "RIGHT"),
        ("ALIGN", (4, 0), (4, -1), "RIGHT"),
        ("ALIGN", (5, 0), (5, -1), "RIGHT"),
        ("ALIGN", (6, 0), (6, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.4, C_GRID),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]
    for r in range(1, len(lignes)):
        if r % 2 == 0:
            style.append(("BACKGROUND", (0, r), (-1, r), C_ZEBRA))
    table.setStyle(TableStyle(style))
    elements.append(table)
    elements.append(Spacer(1, 0.4 * cm))

    # --- Totaux (alignés à droite) -----------------------------------------
    totaux = Table([
        [Paragraph("Summe netto", tot_l), Paragraph(_fmt_eur(str(tot["net"])), cell_b)],
        [Paragraph("Umsatzsteuer", tot_l), Paragraph(_fmt_eur(str(tot["tva"])), cell_b)],
        [Paragraph("Gesamtbetrag", tot_w), Paragraph(_fmt_eur(str(tot["brut"])), tot_w)],
    ], colWidths=[4.2 * cm, 3.8 * cm], hAlign="RIGHT")
    totaux.setStyle(TableStyle([
        ("ALIGN", (0, 0), (0, -1), "RIGHT"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("BACKGROUND", (0, 2), (-1, 2), C_TOTAL_BG),
        ("TOPPADDING", (0, 0), (-1, 1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, 1), 4),
        ("TOPPADDING", (0, 2), (-1, 2), 8),
        ("BOTTOMPADDING", (0, 2), (-1, 2), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("LINEABOVE", (0, 0), (-1, 0), 0.4, C_LINE),
    ]))
    elements.append(totaux)
    elements.append(Spacer(1, 0.55 * cm))

    zahl = "Bitte überweisen Sie den Gesamtbetrag unter Angabe der Rechnungsnummer."
    if facture.date_echeance:
        zahl += f" Zahlbar bis {_fmt_date_iso(facture.date_echeance)} ohne Abzug."
    elements.append(Paragraph(zahl, tot_l))
    elements.append(Spacer(1, 0.25 * cm))

    if facture.iban:
        iban = facture.iban.replace(" ", "")
        grouped = " ".join(iban[i:i + 4] for i in range(0, len(iban), 4))
        bank_rows = [
            [Paragraph("Bankverbindung", label), Paragraph(grouped, cell_b)],
        ]
        if facture.titulaire_compte:
            bank_rows.append([Paragraph("Kontoinhaber", label), Paragraph(facture.titulaire_compte, cell)])
        if facture.bic:
            bank_rows.append([Paragraph("BIC", label), Paragraph(facture.bic.replace(" ", ""), cell)])
        bank_t = Table(bank_rows, colWidths=[3.4 * cm, 13.2 * cm])
        bank_t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), C_PAPER),
            ("BOX", (0, 0), (-1, -1), 0.4, C_LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        elements.append(bank_t)
        elements.append(Spacer(1, 0.25 * cm))
    for note in facture.notes:
        elements.append(Paragraph(note, ParagraphStyle(
            "note", fontName=_FONT_REGULAR, fontSize=8, leading=11, textColor=C_MUTED,
        )))

    doc.build(elements, canvasmaker=_canvasmaker, onFirstPage=on_first, onLaterPages=on_later)
    return buf.getvalue()


def extraire_xml(pdf_bytes: bytes) -> str | None:
    """Extrait factur-x.xml d'un PDF hybride (pour tests/preuve).

    Le flux embarqué est NON compressé (filters=[]) : le XML est lisible en
    clair entre sa déclaration et la balise racine fermée (préfixe rsm:).
    """
    debut = pdf_bytes.find(b"<?xml")
    fin = pdf_bytes.find(b"</rsm:CrossIndustryInvoice>")
    if debut == -1 or fin == -1:
        return None
    return pdf_bytes[debut : fin + len(b"</rsm:CrossIndustryInvoice>")].decode("utf-8")
