/**
 * §49 Indice Destatis officiel des prix de construction — Bauliche Anlagen
 * an Wohngebäuden (Genesis 61261-0002, série bpr110), **base 2021 = 100,
 * Y COMPRIS TVA (USt)**, publication du 10.07.2026.
 *
 * Source : Statistisches Bundesamt (Destatis), « Preisindizes für die
 * Bauwirtschaft, 2. Vierteljahr 2026 » (communiqué n° 265 du 10.07.2026) —
 * https://www.destatis.de/DE/Themen/Wirtschaft/Konjunkturindikatoren/Preise/bpr110.html
 *
 * C'est la **seule série d'indices** de l'application : countries.ts
 * (COST_INDEX, facteur d'année de l'estimation rapide) et le script d'import
 * backend la consomment. Ne plus dupliquer de constantes d'indice ailleurs.
 */

export interface IndexPoint {
  /** ex. "2024-Q1" */
  quarter: string;
  /** indice officiel, base 2021 = 100, inkl. USt, 1 décimale */
  value: number;
}

/** Série trimestrielle officielle (Stand 10.07.2026). */
export const DESTATIS_WOHNGEBAEUDE: IndexPoint[] = [
  { quarter: "2021-Q1", value: 96.7 },
  { quarter: "2021-Q2", value: 99.5 },
  { quarter: "2021-Q3", value: 101.6 },
  { quarter: "2021-Q4", value: 102.2 },
  { quarter: "2022-Q1", value: 108.2 },
  { quarter: "2022-Q2", value: 112.1 },
  { quarter: "2022-Q3", value: 112.7 },
  { quarter: "2022-Q4", value: 113.1 },
  { quarter: "2023-Q1", value: 114.7 },
  { quarter: "2023-Q2", value: 115.7 },
  { quarter: "2023-Q3", value: 115.9 },
  { quarter: "2023-Q4", value: 116.2 },
  { quarter: "2024-Q1", value: 128.5 },
  { quarter: "2024-Q2", value: 129.4 },
  { quarter: "2024-Q3", value: 130.3 },
  { quarter: "2024-Q4", value: 130.8 },
  { quarter: "2025-Q1", value: 132.6 },
  { quarter: "2025-Q2", value: 133.6 },
  { quarter: "2025-Q3", value: 134.3 },
  { quarter: "2025-Q4", value: 135.0 },
  { quarter: "2026-Q1", value: 137.0 },
  { quarter: "2026-Q2", value: 140.3 },
];

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Dernier point publié (dérivé de la série — ne jamais coder en dur). */
export const INDEX_LATEST = DESTATIS_WOHNGEBAEUDE[DESTATIS_WOHNGEBAEUDE.length - 1];

export const INDEX_SOURCE_LABEL = "Destatis 61261-0002 \u00b7 Basis 2021=100 \u00b7 inkl. USt";

/** « Destatis \u00b7 Stand 06/2026 » : mois de r\u00e9f\u00e9rence du trimestre (Q2 = juin).
 *  La date de publication (10.07.2026) figure dans le commentaire de source. */
export function indexStandLabel(): string {
  const [year, q] = INDEX_LATEST.quarter.split("-Q");
  const month = (Number(q) * 3).toString().padStart(2, "0");
  return `Destatis \u00b7 Stand ${month}/${year}`;
}

function yearlyFromSeries(year: number): number | null {
  const pts = DESTATIS_WOHNGEBAEUDE.filter((p) => p.quarter.startsWith(`${year}-`));
  if (pts.length >= 4) return round2(pts.reduce((s, p) => s + p.value, 0) / pts.length);
  // année incomplète (année en cours) : dernier point publié
  if (pts.length > 0) return pts[pts.length - 1].value;
  return null;
}

/** Facteur de rétrocétion base 2021 → base 2020 (Wechsel Genesis, Jahres-
 * durchschnitt 2021 base 2020 = 112,7). Publié et traçable. */
const RETRO_2021_TO_2020 = 1.127;

/**
 * Indice annuel pour l'année `year` (par ex. indexForYear(2024) = 129,75).
 * - années couvertes par 4 trimestres : moyenne annuelle officielle ;
 * - année en cours (2026) : dernier point publié (Q2/2026 = 140,3) ;
 * - 2020 : rétrocédé de la moyenne 2021 (100,0 / 1,127 = 88,73) ;
 * - avant 2020 : non supporté (null) — le référentiel serait trop vieux.
 */
export function indexForYear(year: number): number | null {
  if (year < 2020) return null;
  if (year === 2020) return round2(100 / RETRO_2021_TO_2020);
  return yearlyFromSeries(year);
}

/** Table annuelle prête à l'emploi (clé = année, 2020..2026). */
export const YEARLY_INDEX: Readonly<Record<number, number>> = (() => {
  const out: Record<number, number> = {};
  for (let y = 2020; y <= 2026; y++) {
    const v = indexForYear(y);
    if (v !== null) out[y] = v;
  }
  return out;
})();

/**
 * Facteur multiplicatif pour convertir des prix de l'année `base` (par ex. les
 * référentiels catalogués 2024) vers l'année `year`. Plafonné à ±40 % — au-delà
 * le référentiel est trop vieux et l'estimation doit le dire (uncertaintyPct).
 */
export function yearFactorFor(base: number, year: number): number {
  const from = indexForYear(base);
  const to = indexForYear(year);
  if (from === null || to === null || from <= 0) return 1;
  const f = to / from;
  return Math.min(1.4, Math.max(0.6, f));
}
