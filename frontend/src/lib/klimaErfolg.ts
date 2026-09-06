// §172 — « Klima-Erfolg » : le carbone économisé devient un SUCCÈS cumulatif.
//
// Le client veut un produit « addictif » : la dopamine, c'est de POUVOIR
// MESURER et MONTRER ce qu'on a accompli. Le VE-Studio économise du CO₂ sur
// chaque projet — mais rien ne cumulait ces gains, et rien ne les traduisait
// en équivalences parlantes pour le Bauherr (« = 3 Bäume pro Jahr », « = 2
// Flüge Berlin–Paris »). Ce module le fait.
//
// HONNÊTETÉ (charta §36) : les facteurs d'équivalence sont des RICHTWERTE
// publics, marqués comme tels — jamais des mesures exactes :
//   - 1 Baum ≈ 20 kg CO₂e/Jahr (arbre adulte, ordre de grandeur courant) ;
//   - 1 Pkw-km ≈ 0,15 kg CO₂e (moyenne Pkw ~150 g/km, Umweltbundesamt) ;
//   - 1 Flug Berlin–Paris (einfach) ≈ 150 kg CO₂e/passager (Richtwert).
// C'est un outil de COMMUNICATION (argumentaire client), pas un bilan certifié.

export interface KlimaEquivalences {
  trees: number;      // « X Bäume binden das in 1 Jahr »
  carKm: number;      // « X Pkw-Kilometer »
  flights: number;    // « X Flüge Berlin–Paris (einfach) »
}

/** Facteurs d'équivalence (Richtwerte publics — voir en-tête). */
export const KLIMA_EQUIV = {
  kgPerTreeYear: 20,
  kgPerCarKm: 0.15,
  kgPerFlight: 150,
} as const;

export function computeEquivalences(kgCo2Saved: number): KlimaEquivalences {
  const kg = Math.max(0, kgCo2Saved);
  return {
    trees: kg / KLIMA_EQUIV.kgPerTreeYear,
    carKm: kg / KLIMA_EQUIV.kgPerCarKm,
    flights: kg / KLIMA_EQUIV.kgPerFlight,
  };
}

// ---------------------------------------------------------------------------
// Persistance du total cumulé (localStorage, comme estimateScenarios §160).
// ---------------------------------------------------------------------------

export const KLIMA_STORAGE_KEY = "narchi:klima-erfolg";

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export interface KlimaTotals {
  /** kg CO₂e économisés cumulés (tous projets, toutes sessions VE). */
  totalKg: number;
  /** Nombre de substitutions « festgehalten » (le geste de compter). */
  records: number;
}

export function getKlimaTotals(storage: Storage | null = defaultStorage()): KlimaTotals {
  if (!storage) return { totalKg: 0, records: 0 };
  try {
    const raw = storage.getItem(KLIMA_STORAGE_KEY);
    if (!raw) return { totalKg: 0, records: 0 };
    const p = JSON.parse(raw) as Partial<KlimaTotals>;
    return {
      totalKg: typeof p.totalKg === "number" && p.totalKg >= 0 ? p.totalKg : 0,
      records: typeof p.records === "number" && p.records >= 0 ? p.records : 0,
    };
  } catch {
    return { totalKg: 0, records: 0 };
  }
}

/** Ajoute `kg` au total cumulé (retourne le nouveau total). Idempotent par
 * « record » : chaque appel correspond à UNE action utilisateur explicite. */
export function recordCo2Saved(
  kg: number,
  storage: Storage | null = defaultStorage(),
): KlimaTotals {
  const kgSafe = Number.isFinite(kg) && kg > 0 ? kg : 0;
  const cur = getKlimaTotals(storage);
  const next: KlimaTotals = {
    totalKg: cur.totalKg + kgSafe,
    records: cur.records + (kgSafe > 0 ? 1 : 0),
  };
  if (storage) {
    try {
      storage.setItem(KLIMA_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // quota / mode privé : dégradation silencieuse (rien ne casse).
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Jalons « Klima » (gamification) — cumulés, jamais décroissants.
// ---------------------------------------------------------------------------

export interface KlimaMilestone {
  id: string;
  /** Seuil en kg CO₂e. */
  thresholdKg: number;
  title: string;
  emoji: string;
}

export const KLIMA_MILESTONES: KlimaMilestone[] = [
  { id: "klima_1t", thresholdKg: 1_000, title: "1 Tonne CO2e gespart", emoji: "🌱" },
  { id: "klima_5t", thresholdKg: 5_000, title: "5 Tonnen — ein kleines Haus", emoji: "🌳" },
  { id: "klima_10t", thresholdKg: 10_000, title: "10 Tonnen — Champions-Liga", emoji: "🏆" },
  { id: "klima_50t", thresholdKg: 50_000, title: "50 Tonnen — Büro-Legende", emoji: "👑" },
];

/** Jalons franchis par le total cumulé (seuils ≤ total). */
export function reachedMilestones(totalKg: number): KlimaMilestone[] {
  return KLIMA_MILESTONES.filter((m) => totalKg >= m.thresholdKg);
}
