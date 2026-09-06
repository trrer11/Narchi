"""
NARCHI V5 — High-Performance PDF Report Generator.
Fuses V1 ReportLab + Matplotlib presentation logic to export executive pitch decks
and DIN 276 cost estimation deliverables.
"""

from pathlib import Path
from typing import Dict, Any
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas

from app.config import settings

class NumberedCanvas(canvas.Canvas):
    """Custom canvas that computes total page numbers dynamically."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def draw_page_decorations(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 9)
        self.setFillColor(colors.HexColor("#64748B"))
        
        # Header
        self.drawString(1.8 * cm, 28.2 * cm, "NARCHI V5 · ARCHITECTURE DE CONVERGENCE")
        self.setStrokeColor(colors.HexColor("#E2E8F0"))
        self.setLineWidth(0.5)
        self.line(1.8 * cm, 28.0 * cm, 19.2 * cm, 28.0 * cm)
        
        # Footer
        page_text = f"Page {self._pageNumber} sur {page_count}"
        self.drawRightString(19.2 * cm, 1.2 * cm, page_text)
        self.drawString(1.8 * cm, 1.2 * cm, "Calcul certifié DIN 276:2018-12 & Ökobaudat LCA")
        self.line(1.8 * cm, 1.6 * cm, 19.2 * cm, 1.6 * cm)
        self.restoreState()


def fmt_eur(val: float) -> str:
    """Formats float as clean Euro currency string."""
    return f"{val:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


def generate_pitch_pdf(project, estimation) -> Path:
    """
    Generates a production-ready PDF report for the given project estimation.
    Returns the file path.
    """
    file_name = f"NARCHI_V3_Rapport_{project.id[:8]}.pdf"
    pdf_path = settings.REPORT_DIR / file_name
    
    doc = SimpleDocTemplate(
        str(pdf_path),
        pagesize=A4,
        rightMargin=1.8 * cm,
        leftMargin=1.8 * cm,
        topMargin=2.2 * cm,
        bottomMargin=2.2 * cm
    )

    styles = getSampleStyleSheet()
    
    # Custom Palette
    c_primary = colors.HexColor("#0F172A")    # Slate 900
    c_accent = colors.HexColor("#2563EB")     # Blue 600
    c_bg_light = colors.HexColor("#F8FAFC")   # Slate 50
    c_text = colors.HexColor("#334155")       # Slate 700

    title_style = ParagraphStyle(
        "CoverTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=26,
        leading=32,
        textColor=c_primary,
        spaceAfter=12
    )
    
    subtitle_style = ParagraphStyle(
        "CoverSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=14,
        leading=18,
        textColor=c_accent,
        spaceAfter=24
    )

    h1_style = ParagraphStyle(
        "SectionH1",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        textColor=c_primary,
        spaceBefore=18,
        spaceAfter=10
    )

    body_style = ParagraphStyle(
        "BodyDark",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10,
        leading=14,
        textColor=c_text
    )

    story = []

    # --- COVER PAGE ---
    story.append(Spacer(1, 3 * cm))
    story.append(Paragraph("DOSSIER D'ESTIMATION DE COÛTS", subtitle_style))
    story.append(Paragraph(project.name.upper(), title_style))
    story.append(Paragraph(f"Modèle source : <b>{project.file_name}</b> ({project.schema_version})", body_style))
    story.append(Spacer(1, 1 * cm))

    # Summary Card Table
    card_data = [
        [Paragraph("<b>Surface Brute (BGF)</b>", body_style), Paragraph("<b>Coût Total Netto</b>", body_style)],
        [Paragraph(f"<font size=16 color='#0F172A'><b>{project.bgf:,.1f} m²</b></font>", body_style),
         Paragraph(f"<font size=16 color='#2563EB'><b>{fmt_eur(estimation.total_netto)}</b></font>", body_style)],
        [Paragraph(f"Volume : {project.bri:,.1f} m³", body_style),
         Paragraph(f"Soit <b>{fmt_eur(estimation.cost_per_m2_bgf)} / m²</b>", body_style)]
    ]
    t_card = Table(card_data, colWidths=[8.7 * cm, 8.7 * cm])
    t_card.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), c_bg_light),
        ('PADDING', (0,0), (-1,-1), 14),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor("#CBD5E1")),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor("#E2E8F0")),
    ]))
    story.append(t_card)
    story.append(Spacer(1, 1.5 * cm))

    # Project Details
    details_text = f"""
    <b>Localisation :</b> {project.grossstadt} ({project.location_plz})<br/>
    <b>Typologie :</b> {estimation.gebaeudeart} · Standard de finition : <b>{estimation.standard.upper()}</b><br/>
    <b>Facteur régional calibré :</b> {estimation.regional_faktor} (Indice Destatis : {estimation.index_faktor})<br/>
    <b>Intervalle de confiance (80%) :</b> {fmt_eur(estimation.confidence_low_80)} — {fmt_eur(estimation.confidence_high_80)}<br/>
    <b>Bilan Carbone LCA :</b> {estimation.co2_total_kg:,.0f} kg CO2 eq ({estimation.co2_per_m2} kg/m²)
    """
    story.append(Paragraph(details_text, body_style))
    story.append(PageBreak())

    # --- DIN 276 BREAKDOWN TABLE ---
    story.append(Paragraph("VENTILATION DES COÛTS DIN 276:2018-12", h1_style))
    story.append(Paragraph("La table ci-dessous détaille la répartition hiérarchique officielle par groupes de coûts (Kostengruppen).", body_style))
    story.append(Spacer(1, 0.5 * cm))

    table_data = [["Code", "Désignation DIN 276", "Part (%)", "Coût Netto (€)", "Coût / m²"]]
    
    for item in estimation.kg_breakdown:
        table_data.append([
            item["code"],
            item["label"],
            f"{item['share_pct']:.1f} %",
            fmt_eur(item["amount"]),
            fmt_eur(item["perM2"])
        ])

    table_data.append([
        "TOTAL",
        "Bauwerkskosten + Baunebenkosten",
        "100.0 %",
        fmt_eur(estimation.total_netto),
        fmt_eur(estimation.cost_per_m2_bgf)
    ])

    t_breakdown = Table(table_data, colWidths=[2.2 * cm, 7.5 * cm, 2.2 * cm, 3.2 * cm, 2.3 * cm])
    t_breakdown.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), c_primary),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,0), 10),
        ('BOTTOMPADDING', (0,0), (-1,0), 8),
        ('TOPPADDING', (0,0), (-1,0), 8),
        ('ALIGN', (2,0), (-1,-1), 'RIGHT'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor("#CBD5E1")),
        ('BACKGROUND', (0,-1), (-1,-1), colors.HexColor("#EFF6FF")),
        ('FONTNAME', (0,-1), (-1,-1), 'Helvetica-Bold'),
    ]))
    story.append(t_breakdown)
    story.append(Spacer(1, 1.5 * cm))

    # Audit Trail Notice
    audit_notice = f"<b>Sceau de traçabilité Blockchain :</b> <code>{estimation.audit_hash}</code><br/>Généré automatiquement par le pipeline NARCHI V5 Engine."
    story.append(Paragraph(audit_notice, body_style))

    # Build document
    doc.build(story, canvasmaker=NumberedCanvas)
    return pdf_path
