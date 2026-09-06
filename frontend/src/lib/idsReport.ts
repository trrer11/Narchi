// NARCHI V6.11 — Bericht IDS-Abnahme exportierbar §45.
// Le panneau §41 prouve l'Eingangskontrolle À L'ÉCRAN ; ce module la rend
// LIVRABLE au bureau / au Bauherrn : un CSV allemand (audit traçable) et un
// document HTML autonome imprimable → « Als PDF speichern » (bouton intégré).
// Zéro ressource externe dans le HTML (aperçu sandbox + autonomie archivage).
//
// Les CHIFFRES viennent 1:1 de l'IdsReport §41 — rien n'est recalculé,
// reformulé ou embelli. « n.a. » = donnée absente, jamais un conforme muet.

import type { IdsReport, IdsRuleStat } from "@/lib/idsEngine";

export interface IdsReportMeta {
  projectName: string;
  /** Libellé de la source d'entrée (resolveAuditInput § QC — auditable). */
  sourceLabel: string;
  generatedAt: Date;
}

// ---------------------------------------------------------------------------
// Étiquettes honnêtes (même barème que §41, relu sans surprise)
// ---------------------------------------------------------------------------

export function idsVerdictLabel(rule: IdsRuleStat): string {
  if (rule.passRate === null) return "nicht prüfbar (Daten fehlen)";
  if (rule.failed > 0) return "FEHLER";
  return "OK";
}

// ---------------------------------------------------------------------------
// CSV allemand (séparateur ;, virgule décimale, CRLF — ouvrable d'Excel DE)
// ---------------------------------------------------------------------------

function fmtDe(n: number, digits = 1): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function csvCell(s: string): string {
  const clean = s.replace(/[\r\n]+/g, " ").trim();
  return /[";]/.test(clean) ? `"${clean.replace(/"/g, '""')}"` : clean;
}

export function idsReportCsv(report: IdsReport, meta: IdsReportMeta): string {
  const head = [
    "IDS-EINGANGSKONTROLLE DER MAQUETTE (DIN EN 17412 · buildingSMART IDS · COBie-Basisfelder)",
    `Projekt;${csvCell(meta.projectName)}`,
    `Erstellt;${meta.generatedAt.toLocaleString("de-DE")}`,
    `Quelle;${csvCell(meta.sourceLabel)}`,
    `Messbar geprüfte Bauteile;${report.measurableElements} von ${report.totalElements}`,
    report.overallPassRate !== null
      ? `GESAMT;${fmtDe(report.overallPassRate * 100)} % – ${report.overallLabel}`
      : `GESAMT;nicht prüfbar`,
    "",
    "Anforderung;Titel;Kategorie;Grundlage;Geprüft;Bestanden;Fehlgeschlagen;n.a.;Quote [%];Status",
  ];
  const rows = report.requirements.map((r) =>
    [
      r.id,
      csvCell(r.title),
      r.category,
      csvCell(r.basis),
      String(r.checked),
      String(r.passed),
      String(r.failed),
      String(r.na),
      r.passRate !== null ? fmtDe(r.passRate * 100) : "",
      idsVerdictLabel(r),
    ].join(";"),
  );
  const failingHeader = ["", "FEHLERHAFTE BAUTEILE (Top 12 je Anforderung)", "Anforderung;Element;Ebene;Express ID;Name;Feststellung"];
  const failingRows = report.requirements
    .filter((r) => r.failing.length > 0)
    .flatMap((r) =>
      r.failing.map((f) =>
        [r.id, f.elementId, f.level, f.expressId !== null ? String(f.expressId) : "", csvCell(f.name), csvCell(f.detail)].join(";"),
      ),
    );
  return [...head, ...rows, ...(failingRows.length > 0 ? [...failingHeader, ...failingRows] : [])].join("\r\n");
}

// ---------------------------------------------------------------------------
// HTML autonome imprimable (→ PDF via le bouton, zéro actif externe)
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function toneOf(rule: IdsRuleStat): { chip: string; bg: string } {
  if (rule.passRate === null) return { chip: "#64748b", bg: "#f1f5f9" };
  if (rule.failed > 0) return { chip: "#e11d48", bg: "#fff1f2" };
  return { chip: "#059669", bg: "#ecfdf5" };
}

export function idsReportHtml(report: IdsReport, meta: IdsReportMeta): string {
  const overallTone =
    report.overallPassRate === null ? "#64748b" : report.overallPassRate >= 0.9 ? "#059669" : report.overallPassRate >= 0.75 ? "#d97706" : "#e11d48";

  const requirementRows = report.requirements
    .map((r) => {
      const t = toneOf(r);
      return `<tr style="background:${t.bg}">
  <td class="mono">${esc(r.id)}</td>
  <td><strong>${esc(r.title)}</strong><br/><span class="small">${esc(r.basis)}</span></td>
  <td>${esc(r.category)}</td>
  <td class="num">${r.checked}</td>
  <td class="num">${r.passed}</td>
  <td class="num">${r.failed}</td>
  <td class="num">${r.na}</td>
  <td class="num">${r.passRate !== null ? fmtDe(r.passRate * 100) + " %" : "–"}</td>
  <td><span class="chip" style="background:${t.chip}">${idsVerdictLabel(r)}</span></td>
</tr>`;
    })
    .join("\n");

  const failingSections = report.requirements
    .filter((r) => r.failing.length > 0)
    .map(
      (r) => `
<h3>${esc(r.id)} — ${esc(r.title)} <span class="small">(${r.failing.length} von ${Math.max(r.failed, r.failing.length)} Fehlern gezeigt)</span></h3>
<table>
<thead><tr><th>Ebene</th><th>Name</th><th>Express ID</th><th>Feststellung</th></tr></thead>
<tbody>
${r.failing
  .map(
    (f) => `<tr><td>${esc(f.level)}</td><td>${esc(f.name)}</td><td class="mono">${f.expressId !== null ? `#${f.expressId}` : "–"}</td><td>${esc(f.detail)}</td></tr>`,
  )
  .join("\n")}
</tbody>
</table>
<p class="small"><em>💡 ${esc(r.suggestion)}</em></p>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8"/>
<title>IDS-Eingangskontrolle — ${esc(meta.projectName)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, sans-serif; color: #0f172a; margin: 32px; line-height: 1.45; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 10px; border-bottom: 2px solid #0f172a; padding-bottom: 4px; }
  h3 { font-size: 13px; margin: 18px 0 6px; }
  .meta { color: #475569; font-size: 12px; margin-bottom: 8px; }
  .overall { font-size: 16px; font-weight: 700; color: ${overallTone}; margin: 14px 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0 20px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11.5px; text-align: left; vertical-align: top; }
  th { background: #0f172a; color: #fff; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .mono { font-family: ui-monospace, monospace; font-size: 10.5px; }
  .small { color: #64748b; font-size: 10.5px; font-weight: 400; }
  .chip { color: #fff; border-radius: 999px; padding: 2px 10px; font-size: 10px; font-weight: 700; white-space: nowrap; }
  .honest { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 12px; font-size: 11px; color: #334155; }
  .printbar { margin: 18px 0; }
  .printbar button { background: #0f172a; color: #fff; border: 0; border-radius: 8px; padding: 10px 18px; font-size: 13px; cursor: pointer; }
  footer { margin-top: 28px; font-size: 10px; color: #94a3b8; }
  @media print { .printbar { display: none; } body { margin: 12mm; } }
</style>
</head>
<body>
  <h1>IDS-Eingangskontrolle der Maquette</h1>
  <p class="meta">DIN EN 17412 (IDS) · buildingSMART Information Delivery Specification · COBie-Basisfelder — Profil NARCHI marché allemand</p>
  <p class="meta">
    Projekt: <strong>${esc(meta.projectName)}</strong> · Quelle: ${esc(meta.sourceLabel)} ·
    Erstellt: ${meta.generatedAt.toLocaleString("de-DE")}
  </p>
  <p class="overall">GESAMT: ${
    report.overallPassRate !== null ? `${fmtDe(report.overallPassRate * 100)} % — ${esc(report.overallLabel)}` : "nicht prüfbar"
  }</p>
  <p class="honest">
    <strong>Lesehinweis (charte honeste) :</strong> ${report.measurableElements} von ${report.totalElements}
    Bauteilen messbar geprüft. « n.a. » = la donnée n'existe PAS dans la maquette livrée — elle n'est
    jamais comptée « conforme » silencieusement. Les quotas ne portent que sur les exigences mesurables.
    Les fehlerhaften Bauteiles sind in der App pro Klick in der 3D-Maquette lokalisierbar.
  </p>
  <div class="printbar noprint"><button onclick="window.print()">🖨️ Drucken / Als PDF speichern</button></div>

  <h2>1 · Anforderungen (${report.requirements.length})</h2>
  <table>
    <thead><tr><th>ID</th><th>Anforderung / Grundlage</th><th>Kategorie</th><th>Geprüft</th><th>Best.</th><th>Fehl.</th><th>n.a.</th><th>Quote</th><th>Status</th></tr></thead>
    <tbody>
${requirementRows}
    </tbody>
  </table>

  ${failingSections ? `<h2>2 · Fehlerhafte Bauteile (Top 12 je Anforderung)</h2>${failingSections}` : ""}

  <footer>
    NARCHI BIM-IQ · IDS-Abnahme — généré localement depuis la maquette réellement chargée
    (source : ${esc(meta.sourceLabel)}). Aucune valeur estimée.
  </footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Téléchargements
// ---------------------------------------------------------------------------

function downloadBlob(content: string, fileName: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadIdsCsv(report: IdsReport, meta: IdsReportMeta): void {
  const stamp = meta.generatedAt.toISOString().slice(0, 10);
  downloadBlob(idsReportCsv(report, meta), `ids-eingangskontrolle-${stamp}.csv`, "text/csv;charset=utf-8");
}

/** Ouvre le document imprimable dans un nouvel onglet → « Als PDF speichern ». */
export function openIdsPrintView(report: IdsReport, meta: IdsReportMeta): void {
  const url = URL.createObjectURL(new Blob([idsReportHtml(report, meta)], { type: "text/html" }));
  window.open(url, "_blank", "noopener");
}
