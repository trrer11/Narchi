"""
NARCHI V5 — Exports d'estimation pour le marché allemand.

Documents produits :
- Excel « Kostenschätzung DIN 276 » (couverture + KV détaillé)
- PDF de synthèse (Gesamtkosten netto/USt/brutto)
- JSON structuré (clés allemandes netto/ust/brutto)
"""
from __future__ import annotations

import io
import json
from datetime import datetime
from decimal import Decimal
from typing import Optional

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer

from .estimation_engine import EstimationSummary


class KostenschaetzungExcelExporter:
    """Export Excel d'une Kostenschätzung conforme DIN 276 (KG triés)."""

    COLORS = {
        "primary": "1B3A5C",
        "secondary": "2E86AB",
        "accent": "F6AE2D",
        "header_bg": "1B3A5C",
        "subheader_bg": "2E86AB",
        "alternate_row": "EBF3FB",
    }

    def generate_dpgf_excel(
        self,
        estimation: EstimationSummary,
        company_name: str,
        project_name: str,
    ) -> bytes:
        wb = openpyxl.Workbook()
        wb.remove(wb.active)

        self._create_cover_sheet(wb, estimation, company_name, project_name)
        self._create_kv_sheet(wb, estimation)

        buffer = io.BytesIO()
        wb.save(buffer)
        buffer.seek(0)
        return buffer.read()

    def _create_cover_sheet(self, wb, estimation, company, project):
        ws = wb.create_sheet("DECKBLATT", 0)
        ws.sheet_view.showGridLines = False
        ws.column_dimensions["A"].width = 5
        ws.column_dimensions["B"].width = 35
        ws.column_dimensions["C"].width = 20
        ws.column_dimensions["D"].width = 20

        ws.merge_cells("B3:D3")
        title = ws.cell(row=3, column=2, value="KOSTENSCHÄTZUNG NACH DIN 276")
        title.font = Font(size=18, bold=True, color="FFFFFF")
        title.fill = PatternFill(fill_type="solid", fgColor=self.COLORS["header_bg"])
        title.alignment = Alignment(horizontal="center", vertical="center")
        ws.row_dimensions[3].height = 40

        info_rows = [
            ("Bauvorhaben:", project),
            ("Bauherr:", company),
            ("Aufstellungsdatum:", datetime.now().strftime("%d.%m.%Y")),
            ("Region:", estimation.region),
            ("Kostenkennwert:", f"{estimation.kosten_pro_m2_bgf or '-'} €/m² BGF"),
        ]
        for i, (label, value) in enumerate(info_rows, start=5):
            ws.row_dimensions[i].height = 22
            label_cell = ws.cell(row=i, column=2, value=label)
            label_cell.font = Font(bold=True)
            label_cell.fill = PatternFill(fill_type="solid", fgColor="F0F4F8")
            ws.cell(row=i, column=3, value=value)
            ws.merge_cells(f"C{i}:D{i}")

        total_row = len(info_rows) + 7
        totals = [
            ("GESAMTKOSTEN NETTO:", float(estimation.total_netto)),
            ("UMSATZSTEUER 19 %:", float(estimation.total_ust)),
            ("GESAMTKOSTEN BRUTTO:", float(estimation.total_brutto)),
        ]
        for offset, (label, value) in enumerate(totals):
            row = total_row + offset
            label_cell = ws.cell(row=row, column=2, value=label)
            label_cell.font = Font(size=12, bold=(offset != 1), color="FFFFFF")
            label_cell.fill = PatternFill(fill_type="solid", fgColor=self.COLORS["primary"])
            value_cell = ws.cell(row=row, column=4, value=value)
            value_cell.number_format = '#,##0.00 "€"'
            value_cell.font = Font(size=12, bold=True, color="FFFFFF")
            value_cell.fill = PatternFill(fill_type="solid", fgColor=self.COLORS["accent"])

    def _create_kv_sheet(self, wb, estimation: EstimationSummary):
        ws = wb.create_sheet("KOSTENVERZEICHNIS")
        ws.sheet_view.showGridLines = False

        headers = ["POS.", "KOSTENGRUPPE / BEZEICHNUNG", "BEMERKUNG", "MENGE", "EINH.", "EINZELPREIS", "BETRAG NETTO"]
        col_widths = [7, 45, 30, 11, 8, 15, 18]
        for col_idx, (header, width) in enumerate(zip(headers, col_widths), 1):
            ws.column_dimensions[get_column_letter(col_idx)].width = width
            cell = ws.cell(row=1, column=col_idx, value=header)
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill(fill_type="solid", fgColor=self.COLORS["header_bg"])
            cell.alignment = Alignment(horizontal="center", vertical="center")

        current_row = 2
        current_category = None
        for line in estimation.lines:
            if line.category != current_category:
                current_category = line.category
                cat_cell = ws.cell(row=current_row, column=2, value=f"KG {line.category.upper()}")
                cat_cell.font = Font(bold=True, color="FFFFFF")
                cat_cell.fill = PatternFill(fill_type="solid", fgColor=self.COLORS["subheader_bg"])
                ws.merge_cells(f"B{current_row}:G{current_row}")
                current_row += 1

            is_alternate = (current_row % 2 == 0)
            fill = PatternFill(fill_type="solid", fgColor=self.COLORS["alternate_row"] if is_alternate else "FFFFFF")

            values = [
                line.line_number,
                line.designation,
                line.detail,
                float(line.quantity),
                line.unit,
                float(line.unit_price_ht),
                float(line.total_ht),
            ]
            for col_idx, val in enumerate(values, 1):
                cell = ws.cell(row=current_row, column=col_idx, value=val)
                cell.fill = fill
                if col_idx > 3:
                    cell.alignment = Alignment(horizontal="right")
                if col_idx in (4, 6, 7):
                    cell.number_format = '#,##0.00'
            current_row += 1

        current_row += 1
        ws.cell(row=current_row, column=6, value="SUMME NETTO").font = Font(bold=True)
        ws.cell(row=current_row, column=7, value=float(estimation.total_netto)).number_format = '#,##0.00 "€"'
        ws.cell(row=current_row, column=7).font = Font(bold=True)


class PDFEstimationExporter:
    def generate_pdf(self, estimation: EstimationSummary, company_name: str, project_name: str) -> bytes:
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=1.5 * cm, leftMargin=1.5 * cm, topMargin=2 * cm, bottomMargin=2 * cm)
        styles = {"Normal": ParagraphStyle("Normal", fontSize=9)}
        story = []

        story.append(Paragraph("<b>KOSTENSCHÄTZUNG DIN 276</b>", ParagraphStyle("Title", fontSize=20, alignment=1, textColor=colors.HexColor("#1B3A5C"))))
        story.append(Spacer(1, 0.5 * cm))
        story.append(Paragraph(f"Bauvorhaben: {project_name}", styles["Normal"]))
        story.append(Paragraph(f"Bauherr: {company_name}", styles["Normal"]))
        story.append(Paragraph(f"Stand: {datetime.now().strftime('%d.%m.%Y')}", styles["Normal"]))
        story.append(Spacer(1, 1 * cm))

        summary_data = [["KOSTENGRUPPE", "BETRAG NETTO (€)"]]
        for category, amount in estimation.totals_by_category.items():
            summary_data.append([category, f"{amount:,.2f} €"])
        summary_data.append(["GESAMT NETTO", f"{estimation.total_netto:,.2f} €"])
        summary_data.append(["UST 19 %", f"{estimation.total_ust:,.2f} €"])
        summary_data.append(["GESAMT BRUTTO", f"{estimation.total_brutto:,.2f} €"])

        table = Table(summary_data, colWidths=[12 * cm, 5 * cm])
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1B3A5C")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ROWBACKGROUNDS", (0, 1), (-1, -4), [colors.white, colors.HexColor("#EBF3FB")]),
            ("FONTNAME", (0, -3), (-1, -1), "Helvetica-Bold"),
            ("BACKGROUND", (0, -3), (-1, -3), colors.HexColor("#DEE2E6")),
            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#F6AE2D")),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#DEE2E6")),
        ]))
        story.append(table)
        doc.build(story)
        buffer.seek(0)
        return buffer.read()


def export_estimation_json(estimation: EstimationSummary) -> str:
    return json.dumps({
        "estimation_id": estimation.estimation_id,
        "project_id": estimation.project_id,
        "region": estimation.region,
        "total_netto": float(estimation.total_netto),
        "total_ust": float(estimation.total_ust),
        "total_brutto": float(estimation.total_brutto),
        # Alias historiques maintenus pour les consommateurs existants
        "total_ht": float(estimation.total_netto),
        "total_tva": float(estimation.total_ust),
        "total_ttc": float(estimation.total_brutto),
        "kosten_pro_m2_bgf": float(estimation.kosten_pro_m2_bgf) if estimation.kosten_pro_m2_bgf else None,
        "ust_satz": 19.0,
        "generated_at": estimation.generated_at,
        "lines": [
            {
                "line_number": l.line_number,
                "category": l.category,
                "designation": l.designation,
                "quantity": float(l.quantity),
                "unit": l.unit,
                "unit_price_ht": float(l.unit_price_ht),
                "total_ht": float(l.total_ht),
            }
            for l in estimation.lines
        ],
    }, ensure_ascii=False, indent=2)
