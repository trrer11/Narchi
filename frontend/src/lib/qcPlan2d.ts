// NARCHI — Vue 2D de localisation des clashs (remplace la « Plans de
// Révision » FACTICE supprimée le 2026-08-06 : feuille semée, toile vide,
// « Aucune issue » à vie — exactement ce que l'utilisateur a encerclé en
// rouge sur sa capture).
//
// Désormais le plan est CALCULÉ de la vraie géométrie : chaque Bauteil est
// projeté en plan (x, y IFC) depuis sa bbox, par étage ; les points chauds
// de clash y sont posés en rouge et CLIQUABLES (→ focus 3D chirurgical).
// Zéro donnée semée, zéro bouton mort : que du réel, local, instantané.

import type { BuildingElement } from "@/data/types";
import type { Clash } from "@/lib/planpruefung";
import { bboxArrayOf } from "@/lib/qcSimulation";

export interface Plan2DRect {
  id: string;
  type: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Plan2D {
  level: string;
  /** Rectangles projetés (repère plan IFC : x, y). */
  rects: Plan2DRect[];
  /** Étendue du plan (viewBox SVG). */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Total d'éléments de l'étage (avant plafond d'affichage). */
  totalElements: number;
  /** True si l'affichage a été plafonné. */
  capped: boolean;
}

/// Plafond de rectangles dessinés (SVG DOM) — les plus VOLUMINEUX d'abord.
export const PLAN_RECT_CAP = 800;

/// Étages présents dans la source d'audit, triés par nombre d'éléments.
export function levelsOf(elements: BuildingElement[]): string[] {
  const counts = new Map<string, number>();
  for (const el of elements) {
    if (!bboxArrayOf(el)) continue;
    const level = el.level && el.level !== "—" ? el.level : "Sans niveau";
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([level]) => level);
}

/// Projection plan d'un étage : tous les Bauteile avec bbox réelle.
export function buildPlan2D(elements: BuildingElement[], level: string): Plan2D | null {
  const rects: Plan2DRect[] = [];
  let total = 0;
  for (const el of elements) {
    const elLevel = el.level && el.level !== "—" ? el.level : "Sans niveau";
    if (elLevel !== level) continue;
    const bbox = bboxArrayOf(el);
    if (!bbox) continue;
    total += 1;
    const [minX, minY, , maxX, maxY] = bbox;
    if (!(maxX > minX) || !(maxY > minY)) continue;
    rects.push({ id: el.id, type: el.type.toUpperCase(), minX, minY, maxX, maxY });
  }
  if (rects.length === 0) return null;

  // Les plus grands volumes d'abord (plafond sans perdre la structure).
  rects.sort(
    (a, b) =>
      (b.maxX - b.minX) * (b.maxY - b.minY) - (a.maxX - a.minX) * (a.maxY - a.minY),
  );
  const capped = rects.length > PLAN_RECT_CAP;
  const kept = capped ? rects.slice(0, PLAN_RECT_CAP) : rects;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of kept) {
    minX = Math.min(minX, r.minX);
    minY = Math.min(minY, r.minY);
    maxX = Math.max(maxX, r.maxX);
    maxY = Math.max(maxY, r.maxY);
  }
  return { level, rects: kept, minX, minY, maxX, maxY, totalElements: total, capped };
}

/// Famille de couleur plan : structure / enveloppe / ouvertures / reste.
export function planColorOf(type: string): string {
  if (type.includes("WALL") || type.includes("CURTAIN")) return "#94a3b8";
  if (type.includes("SLAB") || type.includes("ROOF") || type.includes("FOOT")) return "#cbd5e1";
  if (type.includes("COLUMN") || type.includes("BEAM") || type.includes("MEMBER")) return "#f59e0b";
  if (type.includes("DOOR") || type.includes("WINDOW")) return "#38bdf8";
  return "#64748b";
}

/// Clashs dont au moins un fautif vit sur l'étage affiché (point rouge au
/// niveau du HOTSPOT — pas au centre de l'élément).
export function clashesOnLevel(
  clashes: Clash[],
  elements: BuildingElement[],
  level: string,
  cap = 120,
): Clash[] {
  const levelByElement = new Map(
    elements.map((el) => [el.id, el.level && el.level !== "—" ? el.level : "Sans niveau"]),
  );
  return clashes
    .filter(
      (c) => levelByElement.get(c.elementA) === level || levelByElement.get(c.elementB) === level,
    )
    .slice(0, cap);
}
