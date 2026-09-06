// NARCHI V5 — BIM-IQ ENGINE
// Advanced Spatial Analysis & Clash Detection

import { BuildingElement } from "@/data/types";

export interface Clash {
  id: string;
  elementA: string;
  elementB: string;
  /** Express IDs IFC des deux éléments (si résolvables). */
  expressIdA: number | null;
  expressIdB: number | null;
  /** Centre de la bbox d'union — cible caméra 3D (repère IFC Z-up). */
  center: [number, number, number];
  /** Taille de la bbox d'union — dimension du marqueur 3D. */
  size: [number, number, number];
  /** Noms lisibles des deux éléments. */
  nameA: string;
  nameB: string;
  /** Pénétration (m) de l'intersection par axe — sert à la suggestion de
      correction (on propose le plus PETIT déplacement qui résout). */
  overlap: [number, number, number];
  /** ZONE D'INTERSECTION EXACTE — la « place à corriger ». Bien plus petite
      que l'union des deux éléments (une bande de 160 mm au lieu de deux
      murs entiers) : c'est la SEULE zone marquée en rouge dans la 3D —
      la personne n'a plus à chercher (méthode Solibri/Navisworks). */
  hotspot: { center: [number, number, number]; size: [number, number, number] };
  severity: "critical" | "major" | "minor";
  type: "hard" | "soft" | "clearance";
  description: string;
  /** AABB only — kein Mesh. Abstand (m) bei type=clearance. */
  gapM?: number;
}

/// Résolution tolérante d'un Express ID IFC : propriété « Express ID »
/// (éléments takeoff/sauvegardés), puis suffixe numérique de l'id interne.
export function expressIdOf(element: BuildingElement): number | null {
  const prop = element.properties.find((p) => p.key === "Express ID" || p.key === "ExpressID");
  if (prop) {
    const n = Number(prop.value);
    if (Number.isFinite(n)) return n;
  }
  const match = element.id.match(/^el-(\d+)$/);
  if (match) return Number(match[1]);
  return null;
}

/// Extraction de l'Express ID depuis les identifiants sauvegardés au projet
/// (« el-<projet>-<expressId>-<idx> ») — utile pour les badges/liens BCF.
export function expressIdFromSavedId(id: string): number | null {
  const match = id.match(/^el-.+-(\d+)-\d+$/);
  return match ? Number(match[1]) : null;
}

/**
 * BIM-IQ Clash Detector
 * Detects geometric intersections between building elements using their Bounding Boxes.
 *
 * V6.2 — Performance : les bbox sont parsées UNE SEULE FOIS par élément
 * (avant : à chaque PAIRE → pour 1 814 éléments ≈ 6,6 M de JSON.parse et
 * plusieurs secondes de grogne à l'ouverture de QC & Conformité).
 */
export class ClashDetector {
  static detectClashes(
    elements: BuildingElement[],
    /// §43 — progression optionnelle (thread principal OU worker) : appelée
    /// à pas réguliers pendant la double boucle O(n²), fraction ∈ [0, 1].
    onProgress?: (fraction: number) => void,
  ): Clash[] {
    const clashes: Clash[] = [];
    const clearanceM = 0.05;

    // 1) Pré-lecture unique : élément → bbox parsée + Express ID (O(n), plus
    // de rescan de propriétés à chaque PAIRE).
    const prepared: { el: BuildingElement; bbox: number[]; tokens: string; expressId: number | null }[] = [];
    for (const el of elements) {
      const bbox = this.getBBox(el);
      if (bbox) {
        prepared.push({
          el,
          bbox,
          tokens: el.type.toUpperCase(),
          expressId: expressIdOf(el) ?? expressIdFromSavedId(el.id),
        });
      }
    }

    const severityRank: Record<Clash["severity"], number> = { critical: 0, major: 1, minor: 2 };

    // 2) Double boucle sur floats — coût ridicule même à 2 M de paires
    const progressStep = Math.max(1, Math.floor(prepared.length / 50));
    for (let i = 0; i < prepared.length; i++) {
      const a = prepared[i];
      if (onProgress && i % progressStep === 0) onProgress(i / prepared.length);
      for (let j = i + 1; j < prepared.length; j++) {
        const b = prepared[j];
        // Garde-fou « jumeaux » : le MÊME objet IFC sauvegardé deux fois (même
        // Express ID) se recouvrirait à 100 % — ce n'est pas une collision,
        // c'est un artefact de double sauvegarde (clashs empilés « même
        // endroit » constatés par l'utilisateur). Deux VRAIS duplicatas Revit
        // ont des Express ID DIFFÉRENTS et restent détectés.
        if (a.expressId !== null && a.expressId === b.expressId) continue;
        const overlap = this.overlap(a.bbox, b.bbox);
        if (overlap) {
        const union = this.unionBBox(a.bbox, b.bbox);
        // Zone d'intersection exacte : [max(minA,minB), min(maxA,maxB)] par axe.
        const hs = this.intersectionBBox(a.bbox, b.bbox);
        const elA = a.el;
        const elB = b.el;
        clashes.push({
          id: `clash-${elA.id}-${elB.id}`,
          elementA: elA.id,
          elementB: elB.id,
          expressIdA: a.expressId,
          expressIdB: b.expressId,
          center: [
            (union[0] + union[3]) / 2,
            (union[1] + union[4]) / 2,
            (union[2] + union[5]) / 2,
          ],
          size: [
            Math.max(union[3] - union[0], 0.25),
            Math.max(union[4] - union[1], 0.25),
            Math.max(union[5] - union[2], 0.25),
          ],
          nameA: elA.name,
          nameB: elB.name,
          overlap,
          hotspot: {
            center: [
              (hs[0] + hs[3]) / 2,
              (hs[1] + hs[4]) / 2,
              (hs[2] + hs[5]) / 2,
            ],
            size: [
              Math.max(hs[3] - hs[0], 0.05),
              Math.max(hs[4] - hs[1], 0.05),
              Math.max(hs[5] - hs[2], 0.05),
            ],
          },
          severity: ClashDetector.calculateSeverityFromTokens(a.tokens, b.tokens),
          type: "hard",
          description: `Hartkollision (AABB) zwischen ${elA.name} und ${elB.name}`,
        });
        continue;
        }

        if (clearanceM > 0 && this.isTgaVsStructure(a.tokens, b.tokens)) {
          const gap = this.aabbGap(a.bbox, b.bbox);
          if (gap > 0 && gap <= clearanceM) {
            const elA = a.el;
            const elB = b.el;
            const mid = this.gapHotspot(a.bbox, b.bbox);
            clashes.push({
              id: `clr-${elA.id}-${elB.id}`,
              elementA: elA.id,
              elementB: elB.id,
              expressIdA: a.expressId,
              expressIdB: b.expressId,
              center: mid.center,
              size: mid.size,
              nameA: elA.name,
              nameB: elB.name,
              overlap: [gap, 0, 0],
              hotspot: mid,
              severity: "minor",
              type: "clearance",
              gapM: gap,
              description: `Lichter Abstand ${Math.round(gap * 1000)} mm ≤ ${Math.round(clearanceM * 1000)} mm (AABB, TGA×Tragwerk) — ${elA.name} / ${elB.name}`,
            });
          }
        }
      }
    }

    // Tri par sévérité : les collisions critiques (structure) en premier.
    // Sévérité d'abord ; à sévérité égale, ordre alphabétique naturel —
    // règle « bureau » 2026-08-06 pour toutes les listes de NARCHI.
    clashes.sort(
      (x, y) =>
        severityRank[x.severity] - severityRank[y.severity] ||
        x.nameA.localeCompare(y.nameA, "de", { numeric: true }) ||
        x.nameB.localeCompare(y.nameB, "de", { numeric: true }),
    );
    return clashes;
  }

  /** Pénétration par axe [x, y, z] si intersection, sinon null. */
  private static overlap(a: number[], b: number[]): [number, number, number] | null {
    const ox = Math.min(a[3], b[3]) - Math.max(a[0], b[0]);
    if (ox < 0) return null;
    const oy = Math.min(a[4], b[4]) - Math.max(a[1], b[1]);
    if (oy < 0) return null;
    const oz = Math.min(a[5], b[5]) - Math.max(a[2], b[2]);
    if (oz < 0) return null;
    return [ox, oy, oz];
  }

  /** Abstand zweier AABB (m). 0 = berühren oder überlappen. */
  static aabbGap(a: number[], b: number[]): number {
    const dx = Math.max(0, a[0] - b[3], b[0] - a[3]);
    const dy = Math.max(0, a[1] - b[4], b[1] - a[4]);
    const dz = Math.max(0, a[2] - b[5], b[2] - a[5]);
    return Math.hypot(dx, dy, dz);
  }

  private static isTgaVsStructure(ta: string, tb: string): boolean {
    const tga = (t: string) =>
      t.includes("PIPE") || t.includes("DUCT") || t.includes("FLOW") || t.includes("CABLE") || t.includes("SANITARY");
    const trag = (t: string) =>
      t.includes("WALL") || t.includes("SLAB") || t.includes("BEAM") || t.includes("COLUMN") || t.includes("MEMBER");
    return (tga(ta) && trag(tb)) || (tga(tb) && trag(ta));
  }

  private static gapHotspot(a: number[], b: number[]): { center: [number, number, number]; size: [number, number, number] } {
    const ca: [number, number, number] = [(a[0] + a[3]) / 2, (a[1] + a[4]) / 2, (a[2] + a[5]) / 2];
    const cb: [number, number, number] = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
    return {
      center: [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2, (ca[2] + cb[2]) / 2],
      size: [0.12, 0.12, 0.12],
    };
  }

  private static calculateSeverityFromTokens(ta: string, tb: string): Clash["severity"] {
    const types = [ta, tb];
    if (types.some(t => t.includes("COLUMN") || t.includes("BEAM"))) return "critical";
    if (types.some(t => t.includes("WALL") || t.includes("SLAB"))) return "major";
    return "minor";
  }

  private static unionBBox(a: number[], b: number[]): number[] {
    return [
      Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]),
      Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5]),
    ];
  }

  /// Bbox de l'INTERSECTION (l'appelant garantit que les deux boîtes se
  /// recouvrent : overlap() non nul).
  private static intersectionBBox(a: number[], b: number[]): number[] {
    return [
      Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]),
      Math.min(a[3], b[3]), Math.min(a[4], b[4]), Math.min(a[5], b[5]),
    ];
  }

  private static getBBox(el: BuildingElement) {
    const bboxProp = el.properties.find(p => p.key === 'bbox');
    if (!bboxProp) return null;
    try {
      // BBox format: [xmin, ymin, zmin, xmax, ymax, zmax]
      return JSON.parse(bboxProp.value) as number[];
    } catch { return null; }
  }
}

// ============================================================================
// PLAN REVIEW (Sheets & Pins) — API minimale restaurée
// Ces exports étaient référencés par Planpruefung.tsx et bcfExport.ts mais
// absents du module (build cassé). Implémentation locale en mémoire +
// pub/sub léger, sans dépendance externe.
// ============================================================================

export interface Sheet {
  id: string;
  name: string;
  imageUrl?: string;
  createdAt: string;
}

export interface Pin {
  id: string;
  sheetId: string;
  x: number; // % horizontal sur la planche
  y: number; // % vertical sur la planche
  title: string;
  note?: string;
  status: "open" | "resolved";
  author?: string;
  createdAt: string;
}

const sheets: Sheet[] = [];
const pins: Pin[] = [];
const planListeners = new Set<() => void>();

function notifyPlan(): void {
  planListeners.forEach((listener) => { try { listener(); } catch { /* noop */ } });
}

let sheetsSeeded = false;

export function listSheets(): Sheet[] {
  // Un plan de révision par défaut la première fois (évite la colonne vide).
  if (!sheetsSeeded && sheets.length === 0) {
    sheetsSeeded = true;
    sheets.push({
      id: "sheet-grundriss-eg-a",
      name: "Grundriss EG — Rev A",
      createdAt: new Date().toISOString(),
    });
  }
  return [...sheets];
}

export function addSheet(input: { name: string; imageUrl?: string }): Sheet {
  const sheet: Sheet = {
    id: `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    imageUrl: input.imageUrl,
    createdAt: new Date().toISOString(),
  };
  sheets.push(sheet);
  notifyPlan();
  return sheet;
}

export function pinsForSheet(sheetId: string): Pin[] {
  return pins.filter((p) => p.sheetId === sheetId);
}

export function addPin(input: Omit<Pin, "id" | "createdAt" | "status"> & { status?: Pin["status"] }): Pin {
  const pin: Pin = {
    ...input,
    id: `pin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: input.status ?? "open",
    createdAt: new Date().toISOString(),
  };
  pins.push(pin);
  notifyPlan();
  return pin;
}

export function setPinStatus(pinId: string, status: Pin["status"]): void {
  const pin = pins.find((p) => p.id === pinId);
  if (pin) { pin.status = status; notifyPlan(); }
}

export function reviewSummary(): { total: number; open: number; resolved: number } {
  const open = pins.filter((p) => p.status === "open").length;
  return { total: pins.length, open, resolved: pins.length - open };
}

export function subscribePlan(listener: () => void): () => void {
  planListeners.add(listener);
  return () => { planListeners.delete(listener); };
}

// Mock data for rules since we don't have a full rule-engine DB yet
export const BIM_RULES = [
  { id: "R01", name: "Accessibilité PMR", description: "Largeur porte min 90cm", critical: true },
  { id: "R02", name: "Isolation Thermique", description: "Épaisseur isolant min 12cm", critical: false },
  { id: "R03", name: "Sécurité Incendie", description: "Distance max sortie 30m", critical: true },
];
