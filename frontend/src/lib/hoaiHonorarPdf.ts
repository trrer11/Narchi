/** §270 HOAI-PDF — Brief, keine Urkunde. Zahlen = calcHoai, 0 € bleibt 0. */
import { jsPDF } from "jspdf";
import { fmtEUR2, type HoaiResult } from "@/lib/hoaiEngine";
import { HOAI_LEGAL_NOTE } from "@/data/hoai";

export interface HoaiPdfMeta {
  projectName: string;
  generatedAt: Date;
}

export function buildHoaiPdfPlain(r: HoaiResult, meta: HoaiPdfMeta): string {
  const when = meta.generatedAt.toLocaleString("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const lines: string[] = [
    "NARCHI — HOAI-Honorar (Orientierung)",
    "Keine Urkunde. Kein Bescheid. Freie Vereinbarung (HOAI 2021).",
    `Projekt: ${meta.projectName.trim() || "Ohne Projekt"}`,
    `Erstellt: ${when}`,
    `Anrechenbare Kosten: ${fmtEUR2(r.input.anrechenbareKosten)}`,
    `Honorarzone: ${r.input.honorarzone}`,
    `Modus: ${r.modeLabel} (×${r.modeFactor})`,
    `Zuschlag-ID: ${r.input.zusatzId}`,
    r.orientierungGueltig
      ? "Tafel gültig — Interpolation der Honorartafel Gebäude/Innenräume (Referenz 2013)."
      : "Tafel nicht gültig — anrechenbare Kosten 0 oder negativ. Beträge = 0,00 €. Nichts interpoliert.",
    `Netto: ${fmtEUR2(r.total)}`,
    `MwSt 19 %: ${fmtEUR2(r.mwst)}`,
    `Brutto: ${fmtEUR2(r.brutto)}`,
    "Leistungsphasen LP 1–8 (ohne LP 9 Objektbetreuung) = 100 %",
  ];
  for (const p of r.phases) {
    lines.push(`LP ${p.nr} ${p.name} ${(p.satz * 100).toFixed(0)} % ${fmtEUR2(p.betrag)}`);
  }
  lines.push(HOAI_LEGAL_NOTE);
  return lines.join("\n");
}

export function downloadHoaiHonorarPdf(r: HoaiResult, projectName: string, generatedAt = new Date()): void {
  const plain = buildHoaiPdfPlain(r, { projectName, generatedAt });
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210;
  const left = 18;
  const right = pageW - 18;
  const maxW = right - left;

  doc.setFillColor(28, 25, 23);
  doc.rect(0, 0, pageW, 18, "F");
  doc.setTextColor(250, 250, 249);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("HOAI-Honorar — Orientierung", left, 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("NARCHI · keine Urkunde · freie Vereinbarung", left, 14);

  let y = 28;
  doc.setTextColor(28, 25, 23);
  const body = plain.split("\n");
  for (let i = 0; i < body.length; i++) {
    const chunk = doc.splitTextToSize(body[i], maxW) as string[];
    const size = i < 2 ? 9 : 8;
    doc.setFont("helvetica", i === 0 ? "bold" : "normal");
    doc.setFontSize(size);
    for (const line of chunk) {
      if (y > 278) {
        doc.addPage();
        y = 18;
      }
      doc.text(line, left, y);
      y += 4.4;
    }
    if (i === 3 || i === 11) y += 2;
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(120, 113, 108);
    doc.text(`Seite ${p} / ${pages} · Orientierung, vom Büro zu prüfen`, left, 290);
  }

  const safe = (projectName || "ohne-projekt").replace(/[^\w\-]+/g, "_").slice(0, 40);
  doc.save(`NARCHI-HOAI-${safe}.pdf`);
}
