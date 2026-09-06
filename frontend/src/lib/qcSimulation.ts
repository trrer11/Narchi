// NARCHI — « Correction IA » : SIMULATION réelle du geste correcteur.
//
// Retour utilisateur : « Suggestion Correction IA ne fait rien de WAWE ».
// Désormais la suggestion n'est plus un simple texte : le moteur choisit
// L'ÉLÉMENT À DÉPLACER (jamais un poteau si une canalisation peut bouger),
// calcule le déplacement signé minimal (+ marge de sécurité) et peut
// l'APPLIQUER en simulation : les bbox des Bauteile sont décalées, le
// détecteur re-tourne et la collision DISPARAÎT du radar — la preuve que
// le geste proposé résout réellement le problème avant de l'ouvrir dans
// Revit. Approche inspirée des classements de responsabilité de Solibri /
// Navisworks (la MEP cède devant la structure porteuse).

import type { BuildingElement } from "@/data/types";
import type { Clash } from "@/lib/planpruefung";

/// Marge de sécurité ajoutée au déplacement minimal (5 mm de Luft).
export const SAFETY_MARGIN_M = 0.005;

/// Coût de déplacement par type : plus le chiffre est élevé, moins l'élément
/// doit bouger (une Stütze ne se déplace jamais pour une Leitung).
const MOVE_RANK: [test: RegExp, rank: number][] = [
  [/COLUMN|BEAM|PILE/, 100], // Stützen / Unterzüge — intouchables
  [/STAIR/, 85],
  [/WALL|CURTAIN/, 70], // Wände porteurs ou non — coûteux
  [/SLAB|FLOOR|ROOF/, 60],
  [/FOOT|FOUND/, 95],
  [/DOOR|WINDOW/, 35], // ouvertures — repositionnables
  [/FLOW|TERMINAL|SEGMENT|FITTING|FURNISH|COVER|EQUIP/, 10], // MEP / mobiliers — flexibles
];

/// Rang de « mobilité » d'un élément (étiquette de type IFC en majuscules).
export function moveRankOf(typeTokens: string): number {
  for (const [test, rank] of MOVE_RANK) if (test.test(typeTokens)) return rank;
  return 50; // inconnu : mobilité moyenne
}

/// Bbox [minX,minY,minZ,maxX,maxY,maxZ] d'un élément (propriété « bbox »).
export function bboxArrayOf(element: BuildingElement): number[] | null {
  const prop = element.properties.find((p) => p.key === "bbox");
  if (!prop) return null;
  try {
    const parsed = JSON.parse(prop.value) as number[];
    return Array.isArray(parsed) && parsed.length === 6 ? parsed : null;
  } catch {
    return null;
  }
}

export interface ClashFix {
  /** Id de la collision concernée (clé de remplacement). */
  clashId: string;
  /** Id de l'élément déplacé (le plus « mobile » des deux). */
  elementId: string;
  /** Nom de l'élément déplacé — pour le bandeau de simulation. */
  elementName: string;
  /** Déplacement signé appliqué [dx, dy, dz] en mètres. */
  offset: [number, number, number];
  /** Axe dominé (0=X, 1=Y, 2=Z) — diagnostic / tests. */
  axis: 0 | 1 | 2;
  /** Ligne d'action courte (allemand métier). */
  label: string;
}

const AXIS_WORDS = [
  { long: "in X-Richtung (Längsrichtung)", verb: "versetzen" },
  { long: "in Y-Richtung (Querrichtung)", verb: "versetzen" },
  { long: "in Z-Richtung (Höhe)", verb: "absenken*/*anheben" },
] as const;

/**
 * Calcule le geste correcteur minimal pour UNE collision :
 * - l'élément déplacé est le plus « mobile » des deux (MEP > Stütze) ;
 * - le déplacement suit l'axe de plus PETITE pénétration, signé de façon à
 *   écarter les deux volumes, + 5 mm de marge (les faces qui se touchent
 *   pile restent une collision → la marge garantit la séparation).
 */
export function buildClashFix(clash: Clash, elements: BuildingElement[]): ClashFix | null {
  const elementA = elements.find((e) => e.id === clash.elementA);
  const elementB = elements.find((e) => e.id === clash.elementB);
  if (!elementA || !elementB) return null;
  const bboxA = bboxArrayOf(elementA);
  const bboxB = bboxArrayOf(elementB);
  if (!bboxA || !bboxB) return null;

  // Qui bouge ? Le rang le plus FAIBLE (le plus mobile). À égalité : B.
  const rankA = moveRankOf(elementA.type.toUpperCase());
  const rankB = moveRankOf(elementB.type.toUpperCase());
  const moverIsA = rankA < rankB;
  const mover = moverIsA ? elementA : elementB;
  const moverBbox = moverIsA ? bboxA : bboxB;
  const stayBbox = moverIsA ? bboxB : bboxA;

  // Distance de SÉPARATION réelle par axe (pas la simple pénétration :
  // quand le mobile CONTIENT le fixe — dale de 2 m contre mur de 30 cm —
  // le geste minimal est la largeur du MOBILE, pas celle du recouvrement).
  //   pousser vers + : il faut mover.min + d > stay.max → d = stay.max − mover.min
  //   pousser vers − : il faut mover.max − d < stay.min → d = mover.max − stay.min
  const sepCosts: number[] = [];
  const sepSigns: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const dPlus = stayBbox[axis + 3] - moverBbox[axis];
    const dMinus = moverBbox[axis + 3] - stayBbox[axis];
    if (dPlus <= dMinus) {
      sepCosts.push(Math.max(dPlus, 0));
      sepSigns.push(1);
    } else {
      sepCosts.push(Math.max(dMinus, 0));
      sepSigns.push(-1);
    }
  }

  // Axe du plus petit VRAI geste séparateur.
  let axis: 0 | 1 | 2 = 0;
  for (let i = 1; i < 3; i++) if (sepCosts[i] < sepCosts[axis]) axis = i as 0 | 1 | 2;

  const distance = sepCosts[axis] + SAFETY_MARGIN_M;
  const offset: [number, number, number] = [0, 0, 0];
  offset[axis] = sepSigns[axis] * distance;

  const mm = Math.max(1, Math.ceil(distance * 1000));
  const { long, verb } = AXIS_WORDS[axis];
  const direction = axis === 2 ? (sepSigns[axis] < 0 ? "absenken" : "anheben") : verb;
  return {
    clashId: clash.id,
    elementId: mover.id,
    elementName: mover.name,
    offset,
    axis,
    label: `« ${mover.name} » um ${mm} mm ${long} ${direction}`,
  };
}

/**
 * Applique les gestes de simulation aux éléments (copie pure — le store
 * n'est jamais muté). Les décalages d'un MÊME élément se CUMULENT (plusieurs
 * collisions résolues successivement par le même mobile).
 */
export function applyClashFixes(
  elements: BuildingElement[],
  fixes: ClashFix[],
): BuildingElement[] {
  if (fixes.length === 0) return elements;
  const offsets = new Map<string, [number, number, number]>();
  for (const fix of fixes) {
    const current = offsets.get(fix.elementId) ?? [0, 0, 0];
    offsets.set(fix.elementId, [
      current[0] + fix.offset[0],
      current[1] + fix.offset[1],
      current[2] + fix.offset[2],
    ]);
  }
  return elements.map((element) => {
    const delta = offsets.get(element.id);
    if (!delta) return element;
    const bbox = bboxArrayOf(element);
    if (!bbox) return element;
    const shifted = [
      bbox[0] + delta[0], bbox[1] + delta[1], bbox[2] + delta[2],
      bbox[3] + delta[0], bbox[4] + delta[1], bbox[5] + delta[2],
    ];
    return {
      ...element,
      properties: element.properties.map((p) =>
        p.key === "bbox" ? { ...p, value: JSON.stringify(shifted) } : p,
      ),
    };
  });
}

/// Centre+taille décalés d'une bbox (pour le fantôme vert « position
/// corrigée » de l'aperçu 3D).
export function shiftedBox(
  box: { center: [number, number, number]; size: [number, number, number] },
  offset: [number, number, number],
): { center: [number, number, number]; size: [number, number, number] } {
  return {
    center: [box.center[0] + offset[0], box.center[1] + offset[1], box.center[2] + offset[2]],
    size: [...box.size],
  };
}
