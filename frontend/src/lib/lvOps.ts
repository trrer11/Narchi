/**
 * §89 — V2.7 étape 3 (2/2) : positions LV STRUCTURÉES co-éditées.
 *
 * Le MÊME document Yjs que la Notiz (§81) — une seule connexion, une
 * seule persistance — porte une clé `lv` : Y.Array de Y.Map, une ligne
 * = une position de Leistungsverzeichnis (OZ, Kurztext, Menge, Einheit,
 * EP). Tout bougé ici se propage en direct à tous les collègues via
 * l'infra CRDT déjà prouvée ; le serveur (§89 lv_positions.py) extrait
 * les mêmes positions en JSON — matière première du futur export GAEB.
 *
 * Contrat d'honnêteté (miroir serveur) : toute donnée illisible est
 * IGNORÉE, pas devinée ; une position sans EP est LÉGALE (« ohne EP »,
 * comptée à part) ; les EP sont des saisies manuelles et dits comme
 * tels (charte §36 « kein Preis ohne Herkunft » — pas de Preisspiegel
 * automatique prétendu).
 */

import * as Y from "yjs";

export const LV_KEY = "lv";
/// Borne RÉELLE, servie aussi par GET /lv — l'UI l'affiche telle quelle.
export const LV_MAX_POSITIONS = 500;
export const LV_MAX_OZ_LEN = 32;
export const LV_MAX_TITLE_LEN = 300;
export const LV_MAX_NUMBER = 1_000_000_000;
export const PRICE_HINT_MANUAL = "manuell";
/// Unités usuelles VOB — liste PROPOSÉE, saisie libre admise.
export const LV_UNITS = ["Stk", "m", "m²", "m³", "kg", "t", "Std", "Tag", "psch"] as const;

export interface LvPosition {
  id: string;
  oz: string;            // Positionsnummer, ex. « 01.003.010 »
  title: string;         // Kurztext
  qty: number;           // Menge (≥ 0, fini, borné)
  unit: string;          // Einheit
  unitPrice: number | null; // EP €/Einheit — null = « ohne EP » (légal, dit)
  priceHint: string;     // herkunft du prix — « manuell » ici
}

export interface LvDraft {
  oz: string;
  title: string;
  qty: number;
  unit: string;
  unitPrice: number | null;
}

// --------------------------------------------------------------------------
// Nombres & texte (purs)
// --------------------------------------------------------------------------

/**
 * Nombre saisi à l'allemande OU à l'anglaise (« 12,5 », « 1.234,56 »,
 * « 12.5 ») → number fini ≥ 0 borné ; null si illisible.
 * Règle : la DERNIÈRE virgule/point fait office de séparateur décimal.
 */
export function parseLvNumber(raw: string, max: number = LV_MAX_NUMBER): number | null {
  const trimmed = raw.trim().replace(/\s+/g, "");
  if (!trimmed) return null;
  const lastComma = trimmed.lastIndexOf(",");
  const lastDot = trimmed.lastIndexOf(".");
  let normalized: string;
  if (lastComma > lastDot) {
    // Style allemand : points = milliers, virgule = décimal.
    normalized = trimmed.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    // Style anglais : virgules = milliers.
    normalized = trimmed.replace(/,/g, "");
  } else {
    normalized = trimmed;
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0 || num > max) return null;
  return num;
}

/// Centimes propres — 0.1+0.2 ne doit JAMAIS afficher 0.30000000000000004.
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatEuro(n: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatQty(n: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 }).format(n);
}

// --------------------------------------------------------------------------
// OZ (Positionsnummer) — tri NUMÉRIQUE par segments, jamais lexicographique
// --------------------------------------------------------------------------

/// Nettoie à « chiffres et points », borne 32 — jamais de rejet brutal.
export function normalizeOz(raw: string): string {
  return raw
    .trim()
    .replace(/[^\d.]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, LV_MAX_OZ_LEN);
}

/// « 01.10 » > « 01.2 » (numérique) — le lexicographique les inverserait.
export function ozCompare(a: string, b: string): number {
  const sa = a.split(".").filter(Boolean).map((s) => parseInt(s, 10));
  const sb = b.split(".").filter(Boolean).map((s) => parseInt(s, 10));
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i++) {
    const va = sa[i] ?? 0;
    const vb = sb[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return a.localeCompare(b, "de");
}

// --------------------------------------------------------------------------
// Validation & totaux (purs)
// --------------------------------------------------------------------------

/// Message d'erreur ALLEMAND affiché tel quel ; null = brouillon valide.
export function validateDraft(draft: LvDraft, currentCount: number): string | null {
  if (currentCount >= LV_MAX_POSITIONS) {
    return `Maximal ${LV_MAX_POSITIONS} Positionen — Grenze erreicht, nichts wurde angelegt.`;
  }
  if (!draft.oz) return "OZ (Positionsnummer) fehlt — z. B. 01.003.010.";
  if (!/^\d+(\.\d+)*$/.test(draft.oz)) {
    return "OZ nur aus Ziffern und Punkten — z. B. 01.003.010.";
  }
  if (draft.title.length > LV_MAX_TITLE_LEN) {
    return `Kurztext zu lang (max. ${LV_MAX_TITLE_LEN} Zeichen).`;
  }
  if (!Number.isFinite(draft.qty) || draft.qty < 0 || draft.qty > LV_MAX_NUMBER) {
    return "Menge ungültig — Zahl ≥ 0 erwartet.";
  }
  if (
    draft.unitPrice !== null &&
    (!Number.isFinite(draft.unitPrice) || draft.unitPrice < 0 || draft.unitPrice > LV_MAX_NUMBER)
  ) {
    return "EP ungültig — Zahl ≥ 0 oder leer („ohne EP“).";
  }
  return null;
}

/// Gesamtpreis d'UNE ligne ; null si sans EP (position honnêtement ouverte).
export function positionGp(p: LvPosition): number | null {
  if (p.unitPrice === null) return null;
  return round2(p.qty * p.unitPrice);
}

export interface LvTotals {
  count: number;
  ohneEp: number;      // positions SANS prix — comptées à part, jamais cachées
  gpTotal: number;     // somme des lignes AVEC prix (centimes propres)
}

export function lvTotals(positions: LvPosition[]): LvTotals {
  let gpTotal = 0;
  let ohneEp = 0;
  for (const p of positions) {
    const gp = positionGp(p);
    if (gp === null) ohneEp += 1;
    else gpTotal += gp;
  }
  return { count: positions.length, ohneEp, gpTotal: round2(gpTotal) };
}

// --------------------------------------------------------------------------
// Pont Yjs (défensif — miroir exact du validateur serveur §89)
// --------------------------------------------------------------------------

function cleanNumber(value: unknown, allowNull: true): number | null | undefined;
function cleanNumber(value: unknown, allowNull: false): number | undefined;
function cleanNumber(value: unknown, allowNull: boolean): number | null | undefined {
  if (value === null || value === undefined) return allowNull ? null : undefined;
  if (typeof value === "boolean" || typeof value !== "number") return undefined;
  if (!Number.isFinite(value) || value < 0 || value > LV_MAX_NUMBER) return undefined;
  return value;
}

/// Positions lisibles d'un Y.Array — entrées corrompues IGNORÉES (pas devinées).
export function positionsFromYArray(yarr: Y.Array<unknown>): LvPosition[] {
  const out: LvPosition[] = [];
  for (const raw of yarr.toArray()) {
    if (!(raw instanceof Y.Map)) continue;
    const id = raw.get("id");
    if (typeof id !== "string" || !id) continue;
    const qty = cleanNumber(raw.get("qty"), false);
    const unitPrice = cleanNumber(raw.get("unit_price"), true);
    if (qty === undefined || unitPrice === undefined) continue;
    const oz = typeof raw.get("oz") === "string" ? (raw.get("oz") as string) : "";
    const title = typeof raw.get("title") === "string" ? (raw.get("title") as string) : "";
    const unit = typeof raw.get("unit") === "string" ? (raw.get("unit") as string) : "";
    const hint = typeof raw.get("price_hint") === "string" && (raw.get("price_hint") as string)
      ? (raw.get("price_hint") as string)
      : PRICE_HINT_MANUAL;
    out.push({ id, oz, title, qty, unit, unitPrice, priceHint: hint });
  }
  return out;
}

/// Copie triée pour l'AFFICHAGE — l'ordre du Y.Array reste l'ordre d'entrée.
export function sortByOz(positions: LvPosition[]): LvPosition[] {
  return [...positions].sort((a, b) => ozCompare(a.oz, b.oz) || a.id.localeCompare(b.id));
}

// --------------------------------------------------------------------------
// Écritures (transactions Yjs — propagation automatique via l'infra §81)
// --------------------------------------------------------------------------

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/// Ajoute la position validée ; renvoie son id ou null si borne atteinte.
export function addPosition(doc: Y.Doc, yarr: Y.Array<unknown>, draft: LvDraft): string | null {
  if (yarr.length >= LV_MAX_POSITIONS) return null;
  const id = newId();
  doc.transact(() => {
    const ymap = new Y.Map<unknown>();
    ymap.set("id", id);
    ymap.set("oz", draft.oz);
    ymap.set("title", draft.title);
    ymap.set("qty", draft.qty);
    ymap.set("unit", draft.unit);
    ymap.set("unit_price", draft.unitPrice);   // null = « ohne EP »
    ymap.set("price_hint", PRICE_HINT_MANUAL); // charte §36 — dit honnêtement
    yarr.push([ymap]);
  });
  return id;
}

/// Champ modifié en une transaction — trouve la map par ID (pas par index
/// affiché : le tri d'affichage diffère de l'ordre du tableau).
export function setPositionCell(
  doc: Y.Doc,
  yarr: Y.Array<unknown>,
  id: string,
  field: "oz" | "title" | "qty" | "unit" | "unit_price",
  value: string | number | null,
): boolean {
  const target = findYMap(yarr, id);
  if (!target) return false;
  doc.transact(() => target.set(field, value));
  return true;
}

export function deletePosition(doc: Y.Doc, yarr: Y.Array<unknown>, id: string): boolean {
  for (let i = 0; i < yarr.length; i++) {
    const raw = yarr.get(i);
    if (raw instanceof Y.Map && raw.get("id") === id) {
      doc.transact(() => yarr.delete(i, 1));
      return true;
    }
  }
  return false;
}

function findYMap(yarr: Y.Array<unknown>, id: string): Y.Map<unknown> | null {
  for (let i = 0; i < yarr.length; i++) {
    const raw = yarr.get(i);
    if (raw instanceof Y.Map && raw.get("id") === id) return raw;
  }
  return null;
}
