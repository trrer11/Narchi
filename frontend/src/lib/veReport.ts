// §158 — Rapport PDF « CO2- und Kosten-Optimierung » du VE-Studio.
//
// Le point de douleur n°4 des architectes : « je perds des heures à mettre en
// forme quelque chose de présentable pour le client ». Le VE-Studio calcule
// déjà la métrique de négociation (€/tCO2e) — ce module la TRANSFORME en un
// livrable PDF professionnel, avec le logo et le nom du bureau (TenantBranding,
// même canal que le rapport §77 et la facture §150), que l'architecte envoie
// tel quel au client.
//
// Même doctrine que reportEngine.ts (§70) : constructeur PUR et testable
// (options jsPDF injectables, `compress:false` pour inspecter le contenu),
// JAMAIS de download dans le constructeur.
//
// CONTRAINTE D'ENCODAGE : les polices standard de jsPDF (helvetica) sont
// limitées à WinAnsi (CP1252). Les caractères « ₂ » (indice), « Δ » (delta),
// « → » (flèche) et « − » (moins typographique) ne s'y rendent PAS et
// casseraient la chaîne de texte. Tout le contenu est donc écrit en
// WinAnsi-sûr : « CO2 », « CO2-Einsparung », « Kostendifferenz », « -> »,
// tiret ASCII « - ». Données = Richtwerte Ökobaudat/BKI, dit explicitement.

import { jsPDF, type jsPDFOptions } from "jspdf";
import autoTable from "jspdf-autotable";
import type { VEOpportunity, VEWhatIf } from "@/lib/veEngine";
import { fitLogoBox, type PdfBranding } from "@/lib/reportEngine";
import { buildCarbonArgument } from "@/lib/carbonArgument";
import { buildVECostImpact } from "@/lib/veCostImpact";

const BRAND: [number, number, number] = [245, 158, 11]; // amber-500
const DARK: [number, number, number] = [10, 14, 27];
const SLATE: [number, number, number] = [100, 116, 139];

/** Données du rapport VE : le projet, les opportunités et la sélection. */
export interface VEReportData {
  projectName: string;
  projectLocation?: string;
  /** NGF en m² (pour le kg/m² avant/après). */
  ngf?: number;
  /** Bilan A1–A3 du projet (kg CO2e) — base du « vorher ». */
  totalCo2Kg?: number;
  /** kg CO2e/m² A1–A3 avant substitution. */
  perM2Before?: number | null;
  /** Devis DIN 276 netto de référence (§165 — Kostenwirkung). */
  estimateNet?: number | null;
  /** Budget du projet (§165). */
  budget?: number | null;
  /** Les opportunités VE (dans l'ordre d'affichage). */
  opportunities: VEOpportunity[];
  /** La sélection « what-if » courante (peut être vide). */
  whatIf: VEWhatIf;
}

const fmt = (n: number): string => n.toLocaleString("de-DE", { maximumFractionDigits: 0 });
const fmt1 = (n: number): string => n.toLocaleString("de-DE", { maximumFractionDigits: 1 });
const fmtCarbon = (kg: number): string =>
  Math.abs(kg) >= 1000 ? `${fmt1(kg / 1000)} t` : `${fmt(kg)} kg`;

/** Construit le PDF VE (PUR — pas de download). `branding` = logo + nom du
 * bureau (TenantBranding) ; absent → rapport standard NARCHI. */
export function buildVEPdfReport(
  data: VEReportData,
  jsPdfOptions: jsPDFOptions = {},
  branding?: PdfBranding,
): jsPDF {
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
    doc.text(
      branding?.officeName ? `${branding.officeName} — CO2- und Kosten-Optimierung` : "NARCHI — CO2- und Kosten-Optimierung",
      margin,
      8,
    );
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
    doc.text("Orientierungswert — kein Statiknachweis. CO2 (Ökobaudat), Kosten (Markt-Richtwert 2026).", margin, pageH - 7);
    doc.text(`Seite ${doc.getNumberOfPages()}`, pageW - margin, pageH - 7, { align: "right" });
  };

  const sectionTitle = (title: string) => {
    if (y > pageH - 40) {
      doc.addPage();
      addPageHeader();
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...DARK);
    doc.text(title, margin, y);
    doc.setDrawColor(...BRAND);
    doc.setLineWidth(1);
    doc.line(margin, y + 2, margin + 30, y + 2);
    y += 9;
  };

  const paragraph = (text: string, size = 9) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(50, 50, 50);
    const lines = doc.splitTextToSize(text, pageW - margin * 2);
    if (y + lines.length * size * 0.4 > pageH - 20) {
      doc.addPage();
      addPageHeader();
    }
    doc.text(lines, margin, y);
    y += lines.length * size * 0.4 + 2;
  };

  // ===== COUVERTURE =====
  doc.setFillColor(...DARK);
  doc.rect(0, 0, pageW, pageH, "F");
  if (branding?.logo) {
    const box = fitLogoBox(branding.logo.width, branding.logo.height, 60, 22);
    if (box.w > 0) {
      const fmtImg = branding.logo.dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
      doc.addImage(branding.logo.dataUrl, fmtImg, (pageW - box.w) / 2, 26, box.w, box.h);
    }
  }
  doc.setTextColor(...BRAND);
  doc.setFont("helvetica", "bold");
  const coverTitle = branding?.officeName ?? "NARCHI";
  let titleSize = branding?.officeName ? 26 : 38;
  doc.setFontSize(titleSize);
  const titleWidth = doc.getTextWidth(coverTitle);
  if (titleWidth > pageW - 40) {
    titleSize = Math.max(14, Math.floor(titleSize * (pageW - 40) / titleWidth));
    doc.setFontSize(titleSize);
  }
  doc.text(coverTitle, pageW / 2, pageH / 2 - 32, { align: "center" });
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont("helvetica", "normal");
  doc.text("CO2- und Kosten-Optimierung", pageW / 2, pageH / 2 - 17, { align: "center" });
  doc.setFontSize(12);
  doc.text("Value Engineering — VE-Studio", pageW / 2, pageH / 2 - 9, { align: "center" });
  doc.setFontSize(11);
  doc.setTextColor(200, 200, 200);
  doc.text(data.projectName, pageW / 2, pageH / 2 + 6, { align: "center" });
  if (data.projectLocation) {
    doc.text(data.projectLocation, pageW / 2, pageH / 2 + 13, { align: "center" });
  }
  doc.addPage();
  addPageHeader();

  // ===== SYNTHÈSE =====
  sectionTitle("Zusammenfassung");
  const applied = data.whatIf.selected.length;
  paragraph(
    applied > 0
      ? `Für « ${data.projectName} » wurden ${applied} Materialsubstitution(en) zur CO2- und Kosten-Optimierung ausgewählt.`
      : `Für « ${data.projectName} » zeigt dieser Bericht die Materialsubstitutionen des VE-Studios mit ihrem Einsparpotenzial (CO2 und Kosten).`,
  );
  if (data.totalCo2Kg != null) {
    paragraph(
      `CO2-Bilanz A1–A3 (Herstellung) des Projekts : ${fmtCarbon(data.totalCo2Kg)}` +
        (data.perM2Before != null ? ` — ${fmt1(data.perM2Before)} kg/m² NGF.` : "."),
    );
  }
  if (applied > 0) {
    const summary: string[] = [
      `CO2-Einsparung gesamt : -${fmtCarbon(data.whatIf.totalCo2SavedKg)}` +
        (data.whatIf.co2SavedPct != null ? ` (${fmt1(data.whatIf.co2SavedPct)} % vom A1–A3).` : "."),
    ];
    if (data.whatIf.totalEurDelta <= 0) {
      summary.push(`Kostendifferenz gesamt : -${fmt(Math.abs(data.whatIf.totalEurDelta))} € (günstiger).`);
    } else {
      summary.push(`Kostendifferenz gesamt : +${fmt(data.whatIf.totalEurDelta)} € (Mehrkosten).`);
    }
    if (data.whatIf.newPerM2Kg != null && data.perM2Before != null) {
      summary.push(`A1–A3 : ${fmt1(data.perM2Before)} -> ${fmt1(data.whatIf.newPerM2Kg)} kg/m² NGF.`);
    }
    // §165 — Kostenwirkung : le devis DIN 276 netto avant/après la sélection.
    const cost = buildVECostImpact({
      whatIf: data.whatIf,
      estimateNet: data.estimateNet,
      budget: data.budget,
    });
    if (cost.hasEstimate) {
      summary.push(
        `Kostenschätzung (netto) : ${fmt(cost.estimateNetBefore!)} € -> ${fmt(cost.estimateNetAfter!)} €` +
          (cost.deltaPctOfEstimate != null
            ? ` (${cost.deltaEur <= 0 ? "-" : "+"}${fmt1(Math.abs(cost.deltaPctOfEstimate))} %).`
            : "."),
      );
    }
    for (const line of summary) paragraph(`• ${line}`);
  }
  y += 2;

  // ===== TABLEAU DES SUBSTITUTIONS =====
  sectionTitle("Materialsubstitutionen");
  const rows = data.opportunities.map((o) => {
    const r = o.rec;
    const dkosten = r.eurDeltaPerUnit <= 0
      ? `-${fmt(Math.abs(r.eurDeltaPerUnit))} €`
      : `+${fmt(r.eurDeltaPerUnit)} €`;
    return [
      `${r.from.label} -> ${r.to.label}`,
      `-${fmt(r.co2SavedPerUnit)} kg/m³`,
      dkosten,
      r.eurDeltaPerUnit <= 0 ? "gewinnbringend" : `${fmt(r.eurPerTonneCo2)} €/t`,
      o.inProject ? `${fmt1(o.availableM3)} m³` : "-",
      o.inProject ? `-${fmtCarbon(o.co2SavedKgTotal)}` : "-",
      o.inProject ? (o.eurDeltaTotal <= 0 ? `-${fmt(Math.abs(o.eurDeltaTotal))} €` : `+${fmt(o.eurDeltaTotal)} €`) : "-",
    ];
  });
  autoTable(doc, {
    startY: y + 1,
    margin: { left: margin, right: margin },
    head: [["Substitution", "CO2-Einsparung/m³", "Kostendiff./m³", "€/t CO2e", "Im Projekt", "CO2 gesamt", "Kosten gesamt"]],
    body: rows,
    styles: { fontSize: 7.5, cellPadding: 2, textColor: [50, 50, 50] },
    headStyles: { fillColor: DARK, textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });
  // jsPDF-autotable déplace le curseur via `lastAutoTable` — on le lit.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8;

  // ===== ARGUMENTAIRE CLIENT (§159) =====
  const argument = buildCarbonArgument({
    projectName: data.projectName,
    whatIf: data.whatIf,
    totalCo2Kg: data.totalCo2Kg,
    perM2Before: data.perM2Before,
  });
  sectionTitle("Argumentation für den Bauherrn");
  paragraph(argument.headline, 10);
  paragraph(argument.intro);
  for (const b of argument.bullets) paragraph(`• ${b}`);
  paragraph(argument.closing, 8);

  // ===== HONNÊTETÉ =====
  sectionTitle("Hinweise");
  paragraph(
    "Alle Angaben sind Orientierungswerte : CO2 aus Ökobaudat (BMWSB, A1–A3), Kosten als Markt-Richtwert 2026 (BKI). " +
      "Die Mengen (m³) stammen aus dem Takeoff der Maquette (Masse ÷ Dichte des Katalogs) — ein Richtwert, kein Aufmaß.",
  );
  paragraph(
    "« WIN-WIN » bedeutet weniger CO2 UND günstiger. « Premium » bedeutet weniger CO2, aber teurer — der €/tCO2e-Wert " +
      "ist Ihr Verhandlungsargument gegenüber dem Bauherrn. Die Äquivalenzfunktion (z. B. Beton != CLT in der Statik) ist je " +
      "Substitution zu prüfen : dieser Bericht ersetzt keinen Statiknachweis.",
  );

  addPageFooter();
  return doc;
}

/** Télécharge le rapport VE (browser uniquement — le constructeur, lui, est pur). */
export function generateVEPdfReport(data: VEReportData, branding?: PdfBranding) {
  buildVEPdfReport(data, {}, branding).save(
    `Narchi-CO2-Optimierung-${data.projectName.replace(/\s/g, "-")}.pdf`,
  );
}
