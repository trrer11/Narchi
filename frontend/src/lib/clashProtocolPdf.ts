/** §254 PDF-Protokoll für das Büro. */
import { jsPDF } from "jspdf";
import type { RadarAnalysisResult } from "@/lib/qcRadarAnalysis";
import { clashProtocolHinweis, clashProtocolLines } from "@/lib/clashProtocol";

export function downloadClashProtocolPdf(analysis: RadarAnalysisResult, projectName: string): void {
  const lines = clashProtocolLines(analysis);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFillColor(180, 83, 9);
  doc.rect(0, 0, 210, 2.2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(28, 25, 23);
  doc.text("Kollisionsprotokoll", 18, 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(87, 83, 78);
  doc.text(projectName || "Ohne Projekt", 18, 22);
  doc.text(clashProtocolHinweis(), 18, 28, { maxWidth: 174 });
  doc.text(
    `Befunde ${analysis.groups.length} · echte Paare ${analysis.realClashes.length} · Anschlüsse ${analysis.connectionCount}`,
    18,
    38,
  );
  let y = 48;
  if (lines.length === 0) {
    doc.text("Keine echten Kollisionen (oder keine BBox).", 18, y);
  }
  for (const l of lines) {
    if (y > 272) {
      doc.addPage();
      y = 18;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(28, 25, 23);
    doc.text(`${l.id}  ${l.title}  (${l.severity})`, 18, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(87, 83, 78);
    doc.text(`${l.a} × ${l.b}  ·  ${l.pairs} Paar(e)  ·  ${l.overlapMm} mm  ·  ${l.levels}`, 18, y, { maxWidth: 174 });
    y += 8;
  }
  doc.save(`NARCHI-Kollisionsprotokoll.pdf`);
}
