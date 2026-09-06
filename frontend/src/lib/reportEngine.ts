// Narchi — Client-side PDF & Excel export engine.
// Generates a professional multi-section report (cover, exec summary, DIN 276,
// Monte Carlo, GEG, HOAI) entirely in the browser via jsPDF.
// (+ XLSX). §74 — V2.5 : le pseudo-XML « GAEB-ähnlich » client est
// SUPPRIMÉ — le vrai export GAEB DA XML 3.2 (phase 31) vient du serveur.

import { jsPDF, type jsPDFOptions } from "jspdf";
import autoTable from "jspdf-autotable";
import type { CostResult } from "@/lib/costEngine";
import type { EnergyResult } from "@/lib/energyEngine";
import type { HoaiResult } from "@/lib/hoaiEngine";
import type { SimulationResult } from "@/lib/monteCarlo";
import { fmtMoney, fmtNumber, fmtPct } from "@/lib/costEngine";

const BRAND: [number, number, number] = [245, 158, 11]; // amber-500
const DARK: [number, number, number] = [10, 14, 27];
const SLATE: [number, number, number] = [100, 116, 139];

/** §168 — formatage CO2 (WinAnsi-sûr, kg/t). */
const fmtCarbonKg = (kg: number): string =>
  Math.abs(kg) >= 1000 ? `${fmtNumber(kg / 1000, 1)} t` : `${fmtNumber(kg, 0)} kg`;

interface ReportData {
  projectName: string;
  cost?: CostResult;
  energy?: EnergyResult;
  hoai?: HoaiResult;
  monteCarlo?: SimulationResult;
  /** §168 — bilan carbone + VE (section 6) — absent → rapport inchangé. */
  carbon?: CarbonReportData;
}

/** §168 — données carbone à insérer (déjà calculées par l'appelant, pour
 * garder reportEngine découplé des moteurs carbone). Chiffres = Richtwerte. */
export interface CarbonReportData {
  a1a3Kg: number;
  perM2Kg: number | null;
  verdictLabel: string;
  budgetKg: number | null;
  budgetUsedPct: number | null;
  overBudget: boolean;
  veTop: { label: string; co2PerM3: number; eurPerM3: number; winWin: boolean }[];
}

// §77 — « PDF avec MON logo » (V1.2 waw) : branding optionnel du bureau.
// Absent → le PDF reste EXACTEMENT le rapport standard (pas de substitution).
export interface PdfLogo { dataUrl: string; width: number; height: number; }
export interface PdfBranding { officeName?: string | null; logo?: PdfLogo | null; }

/** §77 — tient le logo dans une boîte max, ratio préservé, JAMAIS agrandi. */
export function fitLogoBox(w: number, h: number, maxW: number, maxH: number): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: 0, h: 0 };
  const s = Math.min(maxW / w, maxH / h, 1); // >1 interdit : un petit logo reste net
  return { w: w * s, h: h * s };
}

// §70 — constructeur PUR (testable : pas de download, options jsPDF
// injectables, ex. { compress: false } pour inspecter le contenu).
export function buildPdfReport(data: ReportData, jsPdfOptions: jsPDFOptions = {}, branding?: PdfBranding) {
  const doc = new jsPDF({ unit: "mm", format: "a4", ...jsPdfOptions });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 15;
  let y = 0;

  const addPageHeader = () => {
    doc.setFillColor(...DARK);
    doc.rect(0, 0, pageW, 12, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text(branding?.officeName ? `${branding.officeName} — Gebäudefinanzierungsbericht` : "NARCHI — Gebäudefinanzierungsbericht", margin, 8);
    doc.text(new Date().toLocaleDateString("de-DE"), pageW - margin, 8, { align: "right" });
    y = 20;
  };

  const addPageFooter = () => {
    doc.setDrawColor(...BRAND);
    doc.setLineWidth(0.5);
    doc.line(margin, pageH - 12, pageW - margin, pageH - 12);
    doc.setFontSize(7);
    doc.setTextColor(...SLATE);
    doc.setFont("helvetica", "normal");
    doc.text("Orientierungswert — kein rechtsverbindlicher Nachweis. Fachliche Verantwortung beim Planer.", margin, pageH - 7);
    doc.text(`Seite ${doc.getNumberOfPages()}`, pageW - margin, pageH - 7, { align: "right" });
  };

  const sectionTitle = (title: string) => {
    if (y > pageH - 40) { doc.addPage(); addPageHeader(); }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...DARK);
    doc.text(title, margin, y);
    doc.setDrawColor(...BRAND);
    doc.setLineWidth(1);
    doc.line(margin, y + 2, margin + 30, y + 2);
    y += 8;
  };

  const paragraph = (text: string, size = 9) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(50, 50, 50);
    const lines = doc.splitTextToSize(text, pageW - margin * 2);
    if (y + lines.length * size * 0.4 > pageH - 20) { doc.addPage(); addPageHeader(); }
    doc.text(lines, margin, y);
    y += lines.length * size * 0.4 + 2;
  };

  // ===== COVER =====
  doc.setFillColor(...DARK);
  doc.rect(0, 0, pageW, pageH, "F");
  // §77 — logo du bureau en tête de couverture (en-tête lettre classique).
  if (branding?.logo) {
    const box = fitLogoBox(branding.logo.width, branding.logo.height, 60, 22);
    if (box.w > 0) {
      const fmt = branding.logo.dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
      doc.addImage(branding.logo.dataUrl, fmt, (pageW - box.w) / 2, 26, box.w, box.h);
    }
  }
  // §79 — avec un Büroname configuré, LE BUREAU est le titre géant ;
  // taille auto-adaptée à la longueur réelle (jamais de débordement page).
  doc.setTextColor(...BRAND);
  doc.setFont("helvetica", "bold");
  const coverTitle = branding?.officeName ?? "NARCHI";
  let titleSize = branding?.officeName ? 26 : 40;
  doc.setFontSize(titleSize);
  const titleWidth = doc.getTextWidth(coverTitle);
  if (titleWidth > pageW - 40) {
    titleSize = Math.max(14, Math.floor(titleSize * (pageW - 40) / titleWidth));
    doc.setFontSize(titleSize);
  }
  doc.text(coverTitle, pageW / 2, pageH / 2 - 30, { align: "center" });
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont("helvetica", "normal");
  doc.text("Gebäudefinanzierungsbericht", pageW / 2, pageH / 2 - 15, { align: "center" });
  doc.setFontSize(12);
  doc.setTextColor(...SLATE);
  doc.text(data.projectName || "Projekt", pageW / 2, pageH / 2 + 5, { align: "center" });
  doc.setFontSize(9);
  const creatorLine = branding?.officeName
    ? `Erstellt von ${branding.officeName} · ${new Date().toLocaleDateString("de-DE")}`
    : `Erstellt am ${new Date().toLocaleDateString("de-DE")}`;
  doc.text(creatorLine, pageW / 2, pageH / 2 + 15, { align: "center" });
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(2);
  doc.line(pageW / 2 - 30, pageH / 2 + 25, pageW / 2 + 30, pageH / 2 + 25);
  // §79 — attribution réelle et discrète : l'outil ne s'efface pas,
  // il se contente de ne plus voler la vedette au bureau.
  if (branding?.officeName) {
    doc.setTextColor(...SLATE);
    doc.setFontSize(9);
    doc.text("erstellt mit NARCHI", pageW / 2, pageH - 18, { align: "center" });
  }

  // ===== EXEC SUMMARY =====
  doc.addPage();
  addPageHeader();
  sectionTitle("1. Zusammenfassung");
  if (data.cost) {
    paragraph(`Geschätzte Baukosten (netto): ${fmtMoney(data.cost.netTotal)} (${fmtNumber(data.cost.perM2Ngf)} €/m² NGF).`);
    paragraph(`Konfidenzintervall (80%): ${fmtMoney(data.cost.low)} bis ${fmtMoney(data.cost.high)}.`);
    paragraph(`Bruttogrundfläche (BGF): ${fmtNumber(data.cost.bgf)} m².`, 9);
  }
  if (data.energy) {
    paragraph(`Heizwärmebedarf (HWB): ${fmtNumber(data.energy.HWB, 1)} kWh/(m²a). GEG-Status: ${data.energy.gegLabel}.`);
  }
  if (data.hoai) {
    paragraph(`Honorar (netto): ${fmtMoney(data.hoai.total)} bei Honorarzone ${data.hoai.input.honorarzone} (${data.hoai.modeLabel}).`);
  }

  // ===== DIN 276 =====
  if (data.cost) {
    doc.addPage();
    addPageHeader();
    sectionTitle(`2. Kostengliederung nach DIN 276 (Fassung ${data.cost.din276 === "2008" ? "2008-12" : "2018-12"})`);
    // §71 — note HOAI si Fassung 2008 affichée.
    if (data.cost.din276 === "2008")
      paragraph("Hinweis: Die HOAI 2021 referenziert die DIN 276-1:2008-12. Anrechenbare Kosten i. d. R. = KG 300 + KG 400. Beträge unverändert — nur Zuordnung und Bezeichnung.", 8);
    const rows = data.cost.lines200.concat(data.cost.lines300, data.cost.lines400, data.cost.lines500, data.cost.lines700);
    autoTable(doc, {
      startY: y,
      head: [["KG", "Bezeichnung", "Anteil", "Betrag (netto)", "€/m² NGF"]],
      body: rows.map(l => [l.code, l.label, fmtPct(l.share), fmtMoney(l.amount), fmtNumber(l.perM2)]),
      foot: [["", "Summe", "", fmtMoney(data.cost.netTotal), fmtNumber(data.cost.perM2Ngf)]],
      theme: "striped",
      headStyles: { fillColor: BRAND, textColor: 0 },
      footStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: "bold" },
      margin: { left: margin, right: margin },
    });
    // §70 — V1.2 : «Herkunft & Genauigkeit». Charte : kein Preis ohne
    // Herkunft — chaque montant du tableau declare sa source, ses facteurs
    // et sa tolerance. Verifie dans costEngine.ts : TOUTES les KG (300
    // comprise) = Richtwerte Katalog 2024 x facteurs — jamais «Eingabe».
    y = (doc as any).lastAutoTable.finalY + 8;
    if (y > pageH - 55) { doc.addPage(); addPageHeader(); }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...DARK);
    doc.text("Herkunft & Genauigkeit", margin, y);
    y += 6;
    const c = data.cost;
    paragraph(
      `Herkunft: Alle Kostengruppen (KG 300–700) sind Richtwerte aus dem Narchi-Katalog (Preisstand 2024), indexiert auf das gewählte Jahr ${c.input.year} (Indexfaktor ×${c.yearFactorValue.toFixed(2)}) und angepasst um: Region ×${c.regionFactor.toFixed(2)}, Qualität ×${c.qualityFactor.toFixed(2)}, Größendegression ×${c.sizeFactor.toFixed(2)}, Keller ×${c.basementFactor.toFixed(2)}, Geschosse ×${c.floorsFactor.toFixed(2)}, Bauweise ×${c.bauweiseFactor.toFixed(2)}, Energiestandard ×${c.energiestandardFactor.toFixed(2)}. Ausgangswert ${fmtNumber(c.benchmarkBase)} €/m² NGF, angepasst ${fmtNumber(c.benchmarkAdj)} €/m² NGF.`
    );
    paragraph(
      "Legende: Messung = am Modell (IFC/DXF) gemessene Menge · Richtwert = Katalog-/Erfahrungswert · Regel = aus Norm oder VOB abgeleiteter Ansatz. Jeder Wert in Narchi trägt einen solchen Herkunft-Nachweis."
    );
    paragraph(
      "Genauigkeit: ±20–30 % (Orientierungswert, vergleichbar einer Kostenschätzung, vgl. HOAI LPH 2). Für die Kostenberechnung (LPH 3): Mengen am Modell verifizieren. Sobald eigene Büro-Preise importiert sind, ersetzt der Büro-Index den Katalog-Index."
    );
    y += 2;
  }

  // ===== MONTE CARLO =====
  if (data.monteCarlo) {
    sectionTitle("3. Risikoanalyse (Monte Carlo)");
    const mc = data.monteCarlo;
    paragraph(`Simulation über ${mc.iterations} Iterationen. Wahrscheinlichkeitsverteilung der Baukosten:`);
    autoTable(doc, {
      startY: y,
      head: [["Perzentil", "Szenario", "Baukosten"]],
      body: [
        ["P10", "Optimistisch", fmtMoney(mc.p10)],
        ["P50 (Median)", "Realistisch", fmtMoney(mc.median)],
        ["P90", "Pessimistisch", fmtMoney(mc.p90)],
      ],
      theme: "grid",
      headStyles: { fillColor: DARK, textColor: 255 },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
    paragraph("Kostentreiber (Sensitivität):", 10);
    autoTable(doc, {
      startY: y,
      body: mc.drivers.map(d => [d.factor, `± ${fmtMoney(d.sensitivity)}`]),
      theme: "plain",
      margin: { left: margin, right: margin },
    });
  }

  // ===== GEG =====
  if (data.energy) {
    doc.addPage();
    addPageHeader();
    sectionTitle("4. GEG-Energiebilanz");
    const e = data.energy;
    autoTable(doc, {
      startY: y,
      head: [["Kennwert", "Wert", "Einheit"]],
      body: [
        ["Heizwärmebedarf (HWB)", fmtNumber(e.HWB, 1), "kWh/(m²a)"],
        ["Primärenergiebedarf (PEB)", fmtNumber(e.PEB, 1), "kWh/(m²a)"],
        ["Endenergie", fmtNumber(e.endenergieM2, 1), "kWh/(m²a)"],
        ["CO₂-Emissionen", fmtNumber(e.co2M2, 1), "kg/(m²a)"],
        ["GEG-Konformität", e.gegLabel, ""],
      ],
      theme: "striped",
      headStyles: { fillColor: [22, 163, 74], textColor: 255 },
      margin: { left: margin, right: margin },
    });
  }

  // ===== HOAI =====
  if (data.hoai) {
    sectionTitle("5. HOAI-Honorar");
    const h = data.hoai;
    autoTable(doc, {
      startY: y,
      head: [["Leistungsphase", "Bezeichnung", "Anteil", "Betrag"]],
      body: h.phases.map(p => [`LP ${p.nr}`, p.name, fmtPct(p.satz), fmtMoney(p.betrag)]),
      foot: [["", "Summe Honorar (netto)", "", fmtMoney(h.total)]],
      theme: "striped",
      headStyles: { fillColor: [124, 58, 237], textColor: 255 },
      footStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: "bold" },
      margin: { left: margin, right: margin },
    });
  }

  // ===== CO₂-Bilanz (§168) =====
  if (data.carbon) {
    if (y > pageH - 50) { doc.addPage(); addPageHeader(); }
    sectionTitle("6. CO2-Bilanz (A1-A3)");
    const c = data.carbon;
    paragraph(
      `Herstellungsemissionen (Ökobaudat, A1-A3): ${fmtCarbonKg(c.a1a3Kg)}` +
        (c.perM2Kg != null ? ` — ${fmtNumber(c.perM2Kg, 0)} kg CO2e/m² NGF.` : ".") +
        ` Bewertung BNB: ${c.verdictLabel}.`,
    );
    if (c.budgetKg != null) {
      paragraph(
        `CO2-Budget: ${fmtCarbonKg(c.budgetKg)} — ` +
          (c.overBudget
            ? `überschritten (+${fmtCarbonKg(c.a1a3Kg - c.budgetKg)}).`
            : `${fmtNumber(c.budgetUsedPct ?? 0, 0)} % verbraucht.`),
      );
    }
    if (c.veTop.length > 0) {
      paragraph("CO2-Einsparpotenzial (VE-Studio, Substitutionen — Orientierung):");
      autoTable(doc, {
        startY: y,
        head: [["Substitution", "CO2-Einsparung/m³", "Kostendifferenz/m³"]],
        body: c.veTop.map((v) => [
          v.label,
          `-${fmtNumber(v.co2PerM3, 0)} kg`,
          v.eurPerM3 <= 0 ? `-${fmtNumber(Math.abs(v.eurPerM3), 0)} €` : `+${fmtNumber(v.eurPerM3, 0)} €`,
        ]),
        theme: "striped",
        headStyles: { fillColor: [5, 150, 105], textColor: 255 },
        margin: { left: margin, right: margin },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y = (doc as any).lastAutoTable.finalY + 8;
    }
  }

  // Final footer on all pages
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    addPageFooter();
  }

  return doc;
}

/** §70 — genere le rapport PDF complet puis declenche le telechargement. */
export function generatePdfReport(data: ReportData, branding?: PdfBranding) {
  buildPdfReport(data, {}, branding).save(`Narchi-Bericht-${data.projectName.replace(/\s/g, "-")}.pdf`);
}

/** §77 — dimensions RÉELLES d'un data-URL (browser uniquement, async) —
 *  le ratio est mesuré, jamais deviné ni stocké. */
export function loadImageDims(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Logo konnte nicht gelesen werden."));
    img.src = dataUrl;
  });
}

/* ===== XLSX Export (via CSV for Excel compatibility) ===== */
export function exportExcel(cost: CostResult, energy: EnergyResult | undefined, hoai: HoaiResult | undefined, projectName: string) {
  const rows: string[][] = [];
  rows.push(["Narchi Bericht", projectName]);
  rows.push([]);
  rows.push(["DIN 276 Kostengliederung"]);
  rows.push(["KG", "Bezeichnung", "Anteil", "Betrag (€)", "€/m² NGF"]);
  const allLines = cost.lines200.concat(cost.lines300, cost.lines400, cost.lines500, cost.lines700);
  for (const l of allLines) {
    rows.push([l.code, l.label, fmtPct(l.share), l.amount.toFixed(2), l.perM2.toFixed(2)]);
  }
  rows.push([]);
  rows.push(["Summe netto", "", "", cost.netTotal.toFixed(2), cost.perM2Ngf.toFixed(2)]);
  if (energy) {
    rows.push([]);
    rows.push(["GEG-Energiebilanz"]);
    rows.push(["HWB", energy.HWB.toFixed(1) + " kWh/(m²a)"]);
    rows.push(["PEB", energy.PEB.toFixed(1) + " kWh/(m²a)"]);
    rows.push(["GEG-Status", energy.gegLabel]);
  }
  if (hoai) {
    rows.push([]);
    rows.push(["HOAI-Honorar"]);
    for (const p of hoai.phases) {
      rows.push([`LP ${p.nr}`, p.name, fmtPct(p.satz), p.betrag.toFixed(2)]);
    }
    rows.push(["Summe", "", "", hoai.total.toFixed(2)]);
  }
  const csv = "\ufeff" + rows.map(r => r.map(c => `"${c}"`).join(";")).join("\r\n");
  downloadFile(csv, `Narchi-${projectName.replace(/\s/g, "-")}.csv`, "text/csv;charset=utf-8");
}

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
