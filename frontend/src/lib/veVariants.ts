// §160 — VE-Varianten : figer et comparer des scénarios de substitution.
//
// Le what-if (§156) est éphémère (état React) : dès qu'on rafraîchit, la
// sélection est perdue. Or l'architecte ITÈRE : « Variante A béton → CLT » vs
// « Variante B Ziegel → KS », il faut pouvoir les FIGER et les COMPARER.
// Ce module reprend le pattern éprouvé de estimateScenarios.ts (§ d'origine) :
// persistance localStorage plafonnée (VEVARIANT_LIMIT), fonctions de
// lecture/écriture avec `Storage | null` injectable (testables sans DOM),
// et un diff pur entre deux variantes.
//
// HONNÊTETÉ : une variante ne stocke QUE la sélection + les totaux dérivés du
// moteur — jamais de chiffre recalculé à la volée (on réutilise le what-if).

import type { VEWhatIf } from "@/lib/veEngine";

export interface VEVariant {
  id: string;
  label: string;
  savedAt: string;
  projectName: string;
  /** Clés `substitutionKey()` sélectionnées (ré-applicables au what-if). */
  selectedKeys: string[];
  totalCo2SavedKg: number;
  totalEurDelta: number;
  co2SavedPct: number | null;
  newPerM2Kg: number | null;
  /** Nombre de substitutions de la variante. */
  count: number;
}

export const VEVARIANT_STORAGE_KEY = "narchi:ve-variants";
export const VEVARIANT_LIMIT = 5;

/** Fige le what-if courant en une variante (id unique, idempotent par id). */
export function snapshotFromWhatIf(
  whatIf: VEWhatIf,
  label: string,
  projectName: string,
  now: Date = new Date(),
): VEVariant {
  return {
    id: `ve-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: label.trim() || `Variante ${now.toLocaleString("de-DE")}`,
    savedAt: now.toISOString(),
    projectName,
    selectedKeys: whatIf.selected.map((o) => `${o.rec.from.key}->${o.rec.to.key}`),
    totalCo2SavedKg: whatIf.totalCo2SavedKg,
    totalEurDelta: whatIf.totalEurDelta,
    co2SavedPct: whatIf.co2SavedPct,
    newPerM2Kg: whatIf.newPerM2Kg,
    count: whatIf.selected.length,
  };
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function isVEVariant(item: unknown): item is VEVariant {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof (item as VEVariant).id === "string" &&
    Array.isArray((item as VEVariant).selectedKeys)
  );
}

export function loadVEVariants(storage: Storage | null = defaultStorage()): VEVariant[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(VEVARIANT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isVEVariant);
  } catch {
    return [];
  }
}

function persist(variants: VEVariant[], storage: Storage | null): void {
  if (!storage) return;
  try {
    storage.setItem(VEVARIANT_STORAGE_KEY, JSON.stringify(variants));
  } catch {
    // quota dépassé / mode privé : dégradation silencieuse
  }
}

/** Ajoute (ou remplace si même id) une variante — plus récent d'abord,
 * plafonnée à VEVARIANT_LIMIT. Retourne la liste à jour. */
export function saveVEVariant(
  variant: VEVariant,
  storage: Storage | null = defaultStorage(),
): VEVariant[] {
  const next = [variant, ...loadVEVariants(storage).filter((v) => v.id !== variant.id)];
  const capped = next.slice(0, VEVARIANT_LIMIT);
  persist(capped, storage);
  return capped;
}

export function removeVEVariant(
  id: string,
  storage: Storage | null = defaultStorage(),
): VEVariant[] {
  const next = loadVEVariants(storage).filter((v) => v.id !== id);
  persist(next, storage);
  return next;
}

/* ---------------------------------- diff ---------------------------------- */

/** Diff entre deux variantes (ou une variante et le what-if courant) :
 * « combien B économise de plus que A », et quelles substitutions diffèrent. */
export interface VEVariantDiff {
  /** Δ(CO₂ économisé) = B − A (positif = B économise plus). */
  co2Delta: number;
  /** Δ(€) = B − A. */
  eurDelta: number;
  /** Δ(kg/m²) si les deux variantes ont une NGF. */
  perM2Delta: number | null;
  /** Substitutions présentes dans A mais pas B. */
  aOnly: string[];
  /** Substitutions présentes dans B mais pas A. */
  bOnly: string[];
}

export function compareVEVariants(a: VEVariant, b: VEVariant): VEVariantDiff {
  const aKeys = new Set(a.selectedKeys);
  const bKeys = new Set(b.selectedKeys);
  return {
    co2Delta: b.totalCo2SavedKg - a.totalCo2SavedKg,
    eurDelta: b.totalEurDelta - a.totalEurDelta,
    perM2Delta:
      a.newPerM2Kg != null && b.newPerM2Kg != null
        ? b.newPerM2Kg - a.newPerM2Kg
        : null,
    aOnly: a.selectedKeys.filter((k) => !bKeys.has(k)),
    bOnly: b.selectedKeys.filter((k) => !aKeys.has(k)),
  };
}
