/** §253 Honorarvorschlag als PDF — Entwurf, keine HOAI-Tafel. */
import { jsPDF } from "jspdf";
import type { FeeProposal, FeeProposalInput } from "@/lib/practiceMgmt";
import { fmtMoney } from "@/lib/costEngine";

export function downloadFeeProposalPdf(input: FeeProposalInput, result: FeeProposal): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const w = 210;
  doc.setFillColor(180, 83, 9);
  doc.rect(0, 0, w, 2.2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(28, 25, 23);
  doc.text("Honorarvorschlag (Entwurf)", 18, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(87, 83, 78);
  doc.text("Keine verbindliche HOAI-Rechnung — Orientierung. Rechtlich zu prüfen.", 18, 24);
  doc.setFontSize(11);
  doc.setTextColor(28, 25, 23);
  doc.text(input.projectName || "Ohne Projektname", 18, 34);
  let y = 44;
  const line = (k: string, v: string) => {
    doc.setFontSize(9);
    doc.setTextColor(87, 83, 78);
    doc.text(k, 18, y);
    doc.setTextColor(28, 25, 23);
    doc.text(v, 80, y);
    y += 6;
  };
  line("NGF", `${input.ngf} m²`);
  line("Kosten/m²", fmtMoney(input.costPerM2));
  line("Anrechenbare Kosten", fmtMoney(result.anrechenbareKosten));
  line("Honorarzone", String(input.honorarzone));
  line("Honorar netto (Orientierung)", fmtMoney(result.honorarTotal));
  line("+ 10 % Reserve", fmtMoney(result.contingency));
  line("Gesamt brutto 19 %", fmtMoney(result.totalWithContingency * 1.19));
  if (input.hourlyRate > 0) {
    line("Implizierte Stunden", `${Math.round(result.hourlyBudget)} h bei ${input.hourlyRate} €/h`);
  } else {
    line("Stundensatz", "0 — Stunden nicht ableitbar");
  }
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.text("Leistungsphasen", 18, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  for (const p of result.honorarPerPhase) {
    doc.text(`LP ${p.phase} ${p.name}`, 18, y);
    doc.text(fmtMoney(p.amount), 150, y);
    y += 6;
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
  }
  if (result.warnings.length > 0) {
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.text("Hinweise", 18, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    for (const wtxt of result.warnings) {
      const lines = doc.splitTextToSize(wtxt, 174);
      doc.text(lines, 18, y);
      y += lines.length * 4 + 2;
    }
  }
  const name = `Honorarvorschlag-${(input.projectName || "Entwurf").replace(/[^\w\-]+/g, "_").slice(0, 40)}.pdf`;
  doc.save(name);
}
