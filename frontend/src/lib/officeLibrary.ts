/**
 * §50 — Bibliothèque de prix DU BUREAU : client API + helpers purs.
 *
 * Le backend est la SEULE source (parse déterministe, upsert, indexation
 * Destatis officielle). Ici : appels HTTP + petits calculs d'affichage
 * purs (testés) — jamais de logique tarifaire dupliquée.
 */

import { secureFetch } from "@/auth/SecuritySanitizer";
import { getApiBase } from "@/lib/apiClient";

/* ------------------------------- types mirroir ---------------------------- */

export interface ImportedPrice {
  oz: string;
  kurztext: string;
  einheit: string;
  einheitspreis_netto: number;
  preisstand_jahr: number;
  kostengruppe: string | null;
}

export interface ImportRejection {
  row: number;
  oz: string;
  reason: string;
}

export interface ImportPreview {
  kind: "csv" | "x31";
  detected_headers: Record<string, string>;
  accepted_count: number;
  rejected_count: number;
  sample_accepted: ImportedPrice[];
  sample_rejected: ImportRejection[];
  preisstand_jahr_effektiv: number;
  warnings: string[];
}

export interface ImportCommit {
  kind: "csv" | "x31";
  inserted: number;
  updated: number;
  rejected_count: number;
  total_active: number;
  sample_rejected: ImportRejection[];
  warnings: string[];
}

export interface OfficePriceItem {
  id: string;
  oz: string;
  kurztext: string;
  einheit: string;
  einheitspreis_netto: number;
  preisstand_jahr: number;
  kostengruppe: string | null;
  source_file: string;
  index_note: string | null;
}

export interface OfficePriceSearchPage {
  total: number;
  items: OfficePriceItem[];
}

export interface LibraryStats {
  total: number;
  by_jahr: Record<number, number>;
  kg_abgedeckt: number;
  kg_total: number;
  letzter_import: string | null;
  index_quelle: string;
}

/* §73 — V2.6 : historique des imports + fraîcheur (contrat /verlauf) */
export interface ImportBatch {
  source_file: string;
  source_kind: string;
  positionen: number;
  erst_import: string | null;
  letzte_aktualisierung: string | null;
  preisstand_von: number;
  preisstand_bis: number;
}

/** §76 — réponse de la suppression ciblée d'un lot (compte RÉEL du serveur). */
export interface BatchDeleteResult {
  deleted: number;
  source_file: string;
}

export interface LibraryVerlauf {
  veraltet: boolean | null;
  alter_tage: number | null;
  alter_monate: number | null;
  schwellwert_monate: number;
  imports: ImportBatch[];
}

/* --------------------------------- appels --------------------------------- */

async function postPreviewOrImport(
  path: "preview" | "import",
  file: File,
  preisstandJahr: number,
): Promise<Response> {
  const form = new FormData();
  form.append("file", file);
  form.append("preisstand_jahr", String(preisstandJahr));
  return secureFetch(`${getApiBase()}/api/v5/office-prices/${path}`, {
    method: "POST",
    body: form,
  });
}

export async function previewOfficePrices(file: File, preisstandJahr: number): Promise<ImportPreview> {
  const res = await postPreviewOrImport("preview", file, preisstandJahr);
  if (!res.ok) throw new Error(`Vorschau fehlgeschlagen (HTTP ${res.status})`);
  return (await res.json()) as ImportPreview;
}

export async function importOfficePrices(file: File, preisstandJahr: number): Promise<ImportCommit> {
  const res = await postPreviewOrImport("import", file, preisstandJahr);
  if (!res.ok) throw new Error(`Import fehlgeschlagen (HTTP ${res.status})`);
  return (await res.json()) as ImportCommit;
}

export async function searchOfficePrices(
  q: string,
  kostengruppe: string | null,
  limit = 50,
  offset = 0,
): Promise<OfficePriceSearchPage> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (q.trim()) params.set("q", q.trim());
  if (kostengruppe) params.set("kostengruppe", kostengruppe);
  const res = await secureFetch(`${getApiBase()}/api/v5/office-prices/search?${params}`);
  if (!res.ok) throw new Error(`Suche fehlgeschlagen (HTTP ${res.status})`);
  return (await res.json()) as OfficePriceSearchPage;
}

export async function fetchLibraryStats(): Promise<LibraryStats> {
  const res = await secureFetch(`${getApiBase()}/api/v5/office-prices/stats`);
  if (!res.ok) throw new Error(`Statistik fehlgeschlagen (HTTP ${res.status})`);
  return (await res.json()) as LibraryStats;
}

export async function fetchLibraryVerlauf(): Promise<LibraryVerlauf> {
  const res = await secureFetch(`${getApiBase()}/api/v5/office-prices/verlauf`);
  if (!res.ok) throw new Error(`Verlauf fehlgeschlagen (HTTP ${res.status})`);
  return (await res.json()) as LibraryVerlauf;
}

/** §76 — supprime UN lot d'import (chirurgical : les autres lots restent). */
export async function deleteLibraryBatch(sourceFile: string): Promise<BatchDeleteResult> {
  const res = await secureFetch(
    `${getApiBase()}/api/v5/office-prices/verlauf/${encodeURIComponent(sourceFile)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`Löschen fehlgeschlagen (HTTP ${res.status})`);
  return (await res.json()) as BatchDeleteResult;
}

export async function purgeOfficePrices(): Promise<{ deleted: number }> {
  const res = await secureFetch(`${getApiBase()}/api/v5/office-prices/purge`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Löschen fehlgeschlagen (HTTP ${res.status})`);
  return (await res.json()) as { deleted: number };
}

/* --------------------------- helpers purs (testés) ------------------------ */

/** Années proposables pour le Preisstand : 2015..année courante. */
export function preisstandYearOptions(nowYear = new Date().getFullYear()): number[] {
  const years: number[] = [];
  for (let y = nowYear; y >= 2015; y--) years.push(y);
  return years;
}

/** Résumé honnête du rapport d'import (DE, pour l'assistant). */
export function importSummary(commit: ImportCommit): string {
  const parts = [`${commit.inserted} neu`, `${commit.updated} aktualisiert`];
  if (commit.rejected_count > 0) parts.push(`${commit.rejected_count} abgelehnt (mit Grund)`);
  return `${parts.join(" · ")} — Bibliothek: ${commit.total_active} Positionen`;
}

/** §76 — confirmation honnête après suppression d'un lot (compte serveur). */
export function batchDeleteSummary(r: BatchDeleteResult): string {
  const noun = r.deleted === 1 ? "Position" : "Positionen";
  return `${r.deleted} ${noun} aus „${r.source_file}“ gelöscht – der Rest der Bibliothek bleibt unberührt.`;
}

/** Acceptation locale du fichier avant envoi (garde-fou UX, pas sécurité). */
export function isAcceptedLibraryFile(name: string): boolean {
  const n = name.toLowerCase();
  return n.endsWith(".csv") || n.endsWith(".txt") || n.endsWith(".x31") || n.endsWith(".xml") || n.endsWith(".gaeb");
}

/** Badge de couverture KG : « 12/26 KGs » → ton + label. */
export function kgCoverageBadge(stats: LibraryStats): { label: string; tone: "emerald" | "amber" | "slate" } {
  const { kg_abgedeckt, kg_total } = stats;
  const ratio = kg_total > 0 ? kg_abgedeckt / kg_total : 0;
  return {
    label: `${kg_abgedeckt}/${kg_total} KGs`,
    tone: ratio >= 0.5 ? "emerald" : ratio > 0 ? "amber" : "slate",
  };
}

/** % netto chiffré avec des prix du bureau, formaté « 62 % ». */
export function eigenpreisQuoteLabel(quote: number): string {
  return `${Math.round(Math.min(1, Math.max(0, quote)) * 100)} %`;
}
