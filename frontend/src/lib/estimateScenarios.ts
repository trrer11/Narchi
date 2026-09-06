// NARCHI — Scénarios de coûts (Kostenvergleich Soll/Ist).
//
// L'utilisateur fige une estimation éclair comme « scénario de référence »
// (persistance localStorage, max SCENARIO_LIMIT), puis la compare à
// l'estimation courante (autre région, autre modèle, autre fichier) :
// deltas par Kostengruppe, ajouts/suppressions de positions et delta total.

import type { QuickEstimateResponse } from "@/lib/quickEstimate";

export interface ScenarioLine {
  kostengruppe: string;
  titel: string;
  gesamt_netto: number;
}

export interface EstimateSnapshot {
  id: string;
  label: string;
  region: string;
  savedAt: string;
  netto: number;
  brutto: number;
  lines: ScenarioLine[];
}

export const SCENARIO_STORAGE_KEY = "narchi:estimate-scenarios";
export const SCENARIO_LIMIT = 5;

/* ------------------------------- snapshots -------------------------------- */

export function snapshotFromEstimate(
  estimate: QuickEstimateResponse,
  label: string,
  now: Date = new Date(),
): EstimateSnapshot {
  return {
    id: `sz-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: label.trim() || `Szenario ${now.toLocaleString("de-DE")}`,
    region: estimate.region,
    savedAt: now.toISOString(),
    netto: estimate.totals.netto,
    brutto: estimate.totals.brutto,
    lines: estimate.lines.map((line) => ({
      kostengruppe: line.kostengruppe,
      titel: line.titel,
      gesamt_netto: line.gesamt_netto,
    })),
  };
}

/* ------------------------------- persistence ------------------------------ */

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadScenarios(storage: Storage | null = defaultStorage()): EstimateSnapshot[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(SCENARIO_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is EstimateSnapshot =>
        typeof item === "object" && item !== null &&
        typeof (item as EstimateSnapshot).id === "string" &&
        Array.isArray((item as EstimateSnapshot).lines),
    );
  } catch {
    return [];
  }
}

function persist(snapshots: EstimateSnapshot[], storage: Storage | null): void {
  if (!storage) return;
  try {
    storage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(snapshots));
  } catch {
    // quota dépassé / mode privé : dégradation silencieuse
  }
}

/// Ajoute (ou remplace si même id) un scénario — liste triée plus récent
/// d'abord, plafonnée à SCENARIO_LIMIT. Retourne la liste à jour.
export function saveScenario(
  snapshot: EstimateSnapshot,
  storage: Storage | null = defaultStorage(),
): EstimateSnapshot[] {
  const next = [snapshot, ...loadScenarios(storage).filter((s) => s.id !== snapshot.id)];
  const capped = next.slice(0, SCENARIO_LIMIT);
  persist(capped, storage);
  return capped;
}

export function ersetzeSzenarien(
  list: EstimateSnapshot[],
  storage: Storage | null = defaultStorage(),
): EstimateSnapshot[] {
  persist(list.slice(0, SCENARIO_LIMIT), storage);
  return list.slice(0, SCENARIO_LIMIT);
}

export function removeScenario(
  id: string,
  storage: Storage | null = defaultStorage(),
): EstimateSnapshot[] {
  const next = loadScenarios(storage).filter((s) => s.id !== id);
  persist(next, storage);
  return next;
}

/* ---------------------------------- diff ---------------------------------- */

export type DiffStatus = "same" | "changed" | "added" | "removed";

export interface ScenarioDiffRow {
  kostengruppe: string;
  titel: string;
  basis: number | null;
  vergleich: number | null;
  delta: number | null;
  deltaProzent: number | null;
  status: DiffStatus;
}

export interface EstimateDiff {
  rows: ScenarioDiffRow[];
  totalBasis: number;
  totalVergleich: number;
  totalDelta: number;
  totalDeltaProzent: number | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/// Compare deux instantanés d'estimation par Kostengruppe (prix unitaires et
/// métrés agrégés — seuls pertinents pour un écart Soll/Ist).
export function diffEstimates(basis: EstimateSnapshot, vergleich: EstimateSnapshot): EstimateDiff {
  const basisByKg = new Map(basis.lines.map((line) => [line.kostengruppe, line]));
  const vergleichByKg = new Map(vergleich.lines.map((line) => [line.kostengruppe, line]));
  const kgs = Array.from(new Set([...basisByKg.keys(), ...vergleichByKg.keys()])).sort();

  const rows: ScenarioDiffRow[] = kgs.map((kg) => {
    const b = basisByKg.get(kg)?.gesamt_netto ?? null;
    const v = vergleichByKg.get(kg)?.gesamt_netto ?? null;
    const titel = vergleichByKg.get(kg)?.titel ?? basisByKg.get(kg)?.titel ?? kg;
    let status: DiffStatus = "same";
    let delta: number | null = null;
    let deltaProzent: number | null = null;
    if (b === null && v !== null) {
      status = "added";
      delta = round2(v);
    } else if (v === null && b !== null) {
      status = "removed";
      delta = round2(-b);
    } else if (b !== null && v !== null) {
      delta = round2(v - b);
      deltaProzent = b !== 0 ? round2(((v - b) / b) * 100) : null;
      status = delta === 0 ? "same" : "changed";
    }
    return { kostengruppe: kg, titel, basis: b, vergleich: v, delta, deltaProzent, status };
  });

  const totalDelta = round2(vergleich.netto - basis.netto);
  return {
    rows,
    totalBasis: round2(basis.netto),
    totalVergleich: round2(vergleich.netto),
    totalDelta,
    totalDeltaProzent: basis.netto !== 0 ? round2(((vergleich.netto - basis.netto) / basis.netto) * 100) : null,
  };
}
