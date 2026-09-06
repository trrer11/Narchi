// §173 — « Klima-Bericht » : le rapport CLIMAT du portefeuille (bragging + client).
//
// Le « Klima-Erfolg » (§172) cumule le CO₂ économisé ; il manque le LIVRABLE
// qui consolide tout : total cumulé, jalons franchis, équivalences parlantes,
// et l'état carbone de CHAQUE projet du portefeuille. Ce rapport est l'outil de
// « bragging » honnête — l'architecte montre à ses clients (ou à son équipe)
// l'impact climat réel de son travail, en un seul PDF avec son logo.
//
// Même doctrine que reportEngine.ts (§70) et veReport.ts (§158) : constructeur
// PUR (options jsPDF injectables, `compress:false` inspectable), JAMAIS de
// download dans le constructeur, texte WinAnsi-sûr (CO2, pas « CO₂ »).

import { jsPDF, type jsPDFOptions } from "jspdf";
import autoTable from "jspdf-autotable";
import { fitLogoBox, type PdfBranding } from "@/lib/reportEngine";
import { computeEquivalences, type KlimaMilestone } from "@/lib/klimaErfolg";

const BRAND: [number, number, number] = [245, 158, 11];
const DARK: [number, number, number] = [10, 14, 27];
const SLATE: [number, number, number] = [100, 116, 139];

/** Données du Klima-Bericht (pré-calculées par l'appelant — découplé). */
export interface KlimaBerichtData {
  officeName?: string | null;
  /** kg CO₂e cumulés (Klima-Erfolg). */
  totalKg: number;
  /** Nombre de gestes « festhalten ». */
  records: number;
  /** Jalons franchis (déjà filtrés). */
  milestones: KlimaMilestone[];
  /** État carbone de chaque projet (A1–A3 + verdict). */
  projects: {
    name: string;
    a1a3Kg: number;
    verdictLabel: string;
    overBudget: boolean;
    usedPct: number | null;
  }[];
}

const fmt = (n: number): string => n.toLocaleString("de-DE", { maximumFractionDigits: 0 });
const fmt1 = (n: number): string => n.toLocaleString("de-DE", { maximumFractionDigits: 1 });
const fmtCarbon = (kg: number): string =>
  Math.abs(kg) >= 1000 ? `${fmt1(kg / 1000)} t` : `${fmt(kg)} kg`;

export function buildKlimaBerichtPdf(
  data: KlimaBerichtData,
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
      branding?.officeName ? `${branding.officeName} — Klima-Bericht` : "NARCHI — Klima-Bericht",
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
    doc.text("Orientierungswert — kein zertifizierter Nachweis. CO2 (Ökobaudat A1-A3), Äquivalenzen als Richtwerte.", margin, pageH - 7);
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
  doc.text(coverTitle, pageW / 2, pageH / 2 - 30, { align: "center" });
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont("helvetica", "normal");
  doc.text("Klima-Bericht", pageW / 2, pageH / 2 - 12, { align: "center" });
  doc.setFontSize(12);
  doc.setTextColor(200, 200, 200);
  doc.text(`CO2-Erfolg des Portfolios — ${new Date().toLocaleDateString("de-DE")}`, pageW / 2, pageH / 2, { align: "center" });
  doc.addPage();
  addPageHeader();

  // ===== SYNTHÈSE =====
  sectionTitle("1. Klima-Erfolg");
  const eq = computeEquivalences(data.totalKg);
  paragraph(
    `Insgesamt hat dieses Büro **${fmtCarbon(data.totalKg)} CO2e** eingespart ` +
      `(${fmt(data.records)} festgehaltene VE-Entscheidungen). Das entspricht — als Richtwert — :`,
  );
  paragraph(
    `• ${fmt(eq.trees)} Bäume, die das ein Jahr lang binden\n` +
      `• ${fmt(eq.carKm)} Pkw-Kilometer\n` +
      `• ${fmt1(eq.flights)} Flüge Berlin–Paris (einfach)`,
  );
  if (data.milestones.length > 0) {
    paragraph("Erreichte Meilensteine :");
    for (const m of data.milestones) paragraph(`• ${m.title}`, 9);
  } else {
    paragraph("Noch kein Meilenstein erreicht — die erste Tonne kommt schneller als gedacht.");
  }

  // ===== PORTEFEUILLE =====
  sectionTitle("2. Portfolio");
  if (data.projects.length > 0) {
    autoTable(doc, {
      startY: y + 1,
      margin: { left: margin, right: margin },
      head: [["Projekt", "CO2 A1-A3", "Bewertung BNB", "Status"]],
      body: data.projects.map((p) => [
        p.name,
        fmtCarbon(p.a1a3Kg),
        p.verdictLabel,
        p.overBudget ? "über Budget" : p.usedPct != null ? `${fmt(p.usedPct)} % vom Budget` : "—",
      ]),
      styles: { fontSize: 8, cellPadding: 2, textColor: [50, 50, 50] },
      headStyles: { fillColor: DARK, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 8;
  } else {
    paragraph("Noch kein Projekt mit CO2-Bilanz — importieren Sie ein IFC-Modell oder legen Sie das Beispielprojekt an.");
  }

  // ===== HONNÊTETÉ =====
  sectionTitle("Hinweise");
  paragraph(
    "Alle Angaben sind Orientierungswerte : CO2 aus Ökobaudat (BMWSB, A1-A3), Äquivalenzen als öffentliche Richtwerte " +
      "(20 kg CO2e/Baum·Jahr, 0,15 kg/Pkw-km, 150 kg/Flug). Dieser Bericht ist ein Kommunikations- und Motivationswerkzeug — kein zertifizierter Klima-Nachweis.",
  );

  addPageFooter();
  return doc;
}

export function generateKlimaBerichtPdf(data: KlimaBerichtData, branding?: PdfBranding) {
  buildKlimaBerichtPdf(data, {}, branding).save("Narchi-Klima-Bericht.pdf");
}
