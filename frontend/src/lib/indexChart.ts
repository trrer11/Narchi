/**
 * §98 (#6 diagnostic) — Graphique d'évolution de l'indice Destatis.
 *
 * Décisions PURES et déterministes : la série officielle (src/data,
 * miroir backend épinglé des deux côtés) → vue SVG dessinée à la main
 * (zéro dépendance de graphique — le produit reste 100 % hors-ligne,
 * donc vérifiable). Aucune valeur officielle n'est codée ici : tout
 * descend de DESTATIS_WOHNGEBAEUDE ; seule la GÉOMÉTRIE est locale.
 *
 * Honnêteté d'affichage :
 * - l'axe Y ne commence PAS à 0 (usage indices : 96,7…140,3) — les
 *   bornes choisies (≈ déciles) sont rendues par la fonction et
 *   affichées sur l'axe, jamais en trompe-l'œil implicite ;
 * - le repère annuel se place sur le Q1 de chaque année ;
 * - la variation « ggü. Vorjahresquartal » est un calcul 1 décimale
 *   signé, null s'il n'y a pas de point un an avant (jamais deviné).
 */
import type { IndexPoint } from "@/data/destatisIndex";

export interface ChartGeom {
  width: number;
  height: number;
  padLeft: number;
  padTop: number;
  padRight: number;
  padBottom: number;
}

export const DEFAULT_GEOM: ChartGeom = {
  width: 640, height: 200, padLeft: 44, padTop: 12, padRight: 14, padBottom: 22,
};

export interface ChartPointView {
  x: number;
  y: number;
  point: IndexPoint;
}

export interface ChartView {
  linePath: string;
  points: ChartPointView[];
  yTicks: { value: number; y: number }[];
  xTicks: { year: string; x: number }[];
  axisFrom: number;   // borne basse affichée (≠ 0 — rendue et montrée)
  axisTo: number;     // borne haute affichée
  latest: ChartPointView;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Borne « décile » englobante STRICTE vers le haut : 96,7 → 90 (bas),
 *  140,3 → 150 (haut) ; un multiple de 10 exact monte quand même (130 → 140)
 *  sinon le point collerait le cadre — artéfact attrapé par les tests. */
function _axisBound(value: number, up: boolean): number {
  const d = Math.floor(value / 10) * 10;
  return up ? (d > value ? d : d + 10) : d;
}

/** Série + géométrie → vue complète ; null si < 2 points (rien à tracer). */
export function buildChartView(
  points: IndexPoint[],
  geom: ChartGeom = DEFAULT_GEOM,
): ChartView | null {
  if (!points || points.length < 2) return null;
  const values = points.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const axisFrom = _axisBound(minV, false);
  const axisTo = _axisBound(maxV, true);
  if (axisTo <= axisFrom) return null;

  const innerW = geom.width - geom.padLeft - geom.padRight;
  const innerH = geom.height - geom.padTop - geom.padBottom;
  const n = points.length;
  const toXY = (p: IndexPoint, i: number): ChartPointView => ({
    x: round2(geom.padLeft + (innerW * i) / (n - 1)),
    y: round2(geom.padTop + innerH * (1 - (p.value - axisFrom) / (axisTo - axisFrom))),
    point: p,
  });
  const views = points.map(toXY);

  const yTicks: { value: number; y: number }[] = [];
  for (let v = axisFrom; v <= axisTo; v += 10) {
    yTicks.push({
      value: v,
      y: round2(geom.padTop + innerH * (1 - (v - axisFrom) / (axisTo - axisFrom))),
    });
  }

  const xTicks: { year: string; x: number }[] = [];
  points.forEach((p, i) => {
    const [year, q] = p.quarter.split("-Q");
    if (q === "1") xTicks.push({ year, x: views[i].x });
  });
  // Si la série ne commence pas un Q1 (troncature future), l'année du
  // premier point est tout de même marquée — le premier point sait dire.
  if (xTicks.length === 0 || xTicks[0].year !== points[0].quarter.split("-Q")[0]) {
    xTicks.unshift({ year: points[0].quarter.split("-Q")[0], x: views[0].x });
  }

  return {
    linePath:
      `M ${views[0].x},${views[0].y} ` +
      views.slice(1).map((v) => `L ${v.x},${v.y}`).join(" "),
    points: views,
    yTicks,
    xTicks,
    axisFrom,
    axisTo,
    latest: views[views.length - 1],
  };
}

/** « Q2/2026 » — étiquette compacte du trimestre. */
export function quarterLabel(quarter: string): string {
  const [year, q] = quarter.split("-Q");
  return q ? `Q${q}/${year}` : quarter;
}

/** « +5,0 % » signé, 1 décimale, virgule allemande ; null sans base. */
export function yoyPercent(latest: IndexPoint, points: IndexPoint[]): number | null {
  const [year, q] = latest.quarter.split("-Q");
  const prev = points.find((p) => p.quarter === `${Number(year) - 1}-Q${q}`);
  if (!prev || prev.value <= 0) return null;
  return Math.round(((latest.value - prev.value) / prev.value) * 1000) / 10;
}

/** « +5,0 % ggü. Vorjahresquartal (Q2/2026 vs Q2/2025) » ; null si null. */
export function yoyText(latest: IndexPoint, points: IndexPoint[]): string | null {
  const pct = yoyPercent(latest, points);
  if (pct === null) return null;
  const shown = Math.abs(pct).toLocaleString("de-DE", {
    minimumFractionDigits: 1, maximumFractionDigits: 1,
  });
  const [year, q] = latest.quarter.split("-Q");
  return (
    `${pct < 0 ? "-" : "+"}${shown} % ggü. Vorjahresquartal ` +
    `(${quarterLabel(latest.quarter)} vs Q${q}/${Number(year) - 1})`
  );
}
