// NARCHI — Réconciliation des repères 3D pour le focus QC (clash).
//
// PANNES CONSTATÉES (retours utilisateur 2026-08-06) :
//   1) marqueur SOUS le bâtiment (origines différentes) ;
//   2) « des places où il n'y a aucun mur », « des fois le même endroit » —
//      sonde chiffrée : extents boîtes 80×3×80 m (une grille IFC géante
//      pollue la bbox) vs scène réelle 12×3,2×6 m.
//
// DEUX CAUSES RACINES, TOUTES DEUX CORRIGÉES :
//   A) MIROIR — web-ifc livre les sommets en repère three.js Y-up
//      x = IFC x, y = IFC z (hauteur), z = −IFC y. L'ancienne conversion
//      (x, z, y) a un déterminant −1 = MIROIR : tout point hors de l'axe
//      de symétrie du plan était REFLÉTÉ. Conversion correcte : (x, z, −y).
//   B) Δ EMPIRIQUE PAR BBOX — calculé sur deux ENSEMBLES différents (les
//      boîtes capturent des grilles/sites géants que la scène ne rend PAS) :
//      les centres de bbox ne coïncident pas, Δ était faux de plusieurs
//      mètres → marqueurs déplacés en bloc. Désormais Δ EXACT = ancre des
//      boîtes (centerBoxesToOrigin) − shift du loader (origin.shift) ;
//      l'empirique corrigé du miroir ne sert plus que de repli.

export interface FrameBBox {
  min: [number, number, number];
  max: [number, number, number];
}

export interface BoxLike {
  center: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
}

export interface FocusPoint {
  /** Centre demandé, repère MeshBox (IFC Z-up). */
  center: [number, number, number];
  /** Taille (inchangée par la translation). */
  size: [number, number, number];
}

/// Requête avec bboxes individuelles (marquage chirurgical des fautifs),
/// zone d'intersection exacte (hotspot) et aperçu avant/après éventuels.
export interface FocusBox {
  center: [number, number, number];
  size: [number, number, number];
}

export interface FocusAfterLike {
  from: FocusBox;
  to: FocusBox;
}

export interface FocusRequestLike {
  center: [number, number, number];
  size: [number, number, number];
  elements?: FocusBox[] | null;
  hotspot?: FocusBox | null;
  after?: FocusAfterLike | null;
}

export interface FocusCorners {
  /** Position corrigée de chaque marqueur en coordonnées three.js Y-up. */
  boxes: { position: [number, number, number]; size: [number, number, number] }[];
  /** Zone d'intersection exacte corrigée (marqueur rouge principal). */
  hotspot: { position: [number, number, number]; size: [number, number, number] } | null;
  /** Aperçu avant/après corrigé (fantôme vert animé). */
  after: {
    from: { position: [number, number, number]; size: [number, number, number] };
    to: { position: [number, number, number]; size: [number, number, number] };
  } | null;
  /** Cible caméra corrigée (centre d'union). */
  cameraTarget: [number, number, number];
  /** Taille d'union convertie Y-up (recul caméra). */
  cameraSize: [number, number, number];
  /** Translation appliquée (diagnostic). */
  delta: [number, number, number];
  reconciled: boolean;
}

export interface FocusPoint3D {
  /** Point corrigé en coordonnées three.js Y-up, prêt à dessiner. */
  position: [number, number, number];
  /** Taille convertie Y-up (x, z_ifc→hauteur, y_ifc). */
  size: [number, number, number];
  /** Translation appliquée (diagnostic). */
  delta: [number, number, number];
  /** true si la correction empirique a été calculée ; false = conversion naïve. */
  reconciled: boolean;
}

/// Bbox d'ensemble (min/max) des MeshBox — repère Z-up (x, y, z).
export function boxesFrameBBox(boxes: BoxLike[]): FrameBBox | null {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let count = 0;
  for (const box of boxes) {
    if (!box?.center || !box?.size) continue;
    const hx = Math.abs(box.size.x), hy = Math.abs(box.size.y), hz = Math.abs(box.size.z);
    minX = Math.min(minX, box.center.x - hx); maxX = Math.max(maxX, box.center.x + hx);
    minY = Math.min(minY, box.center.y - hy); maxY = Math.max(maxY, box.center.y + hy);
    minZ = Math.min(minZ, box.center.z - hz); maxZ = Math.max(maxZ, box.center.z + hz);
    count += 1;
  }
  if (count === 0) return null;
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function centerOf(bbox: FrameBBox): [number, number, number] {
  return [
    (bbox.min[0] + bbox.max[0]) / 2,
    (bbox.min[1] + bbox.max[1]) / 2,
    (bbox.min[2] + bbox.max[2]) / 2,
  ];
}

/// Conversion conforme web-ifc : frame boîtes (IFC natif Z-up) → three.js
/// Y-up (x, z, −y). Déterminant +1 = rotation propre ; l'ancienne (x, z, y)
/// était un MIROIR (dét −1) qui REFLÉTAIT les points hors axe de symétrie —
/// racine n°1 des marqueurs « places sans murs ».
export function ifcToThree(point: [number, number, number]): [number, number, number] {
  return [point[0], point[2], -point[1]];
}

/// Ancres exactes des deux pipelines de géométrie (ifcGeometry
/// centerBoxesToOrigin / ifcMeshLoader origin.shift) : la translation
/// boîtes → scène se calcule alors EXACTEMENT, sans heuristique de bbox
/// (racine n°2 : des grilles IFC géantes ne rendues pas par la scène
/// faussaient les deux bboxes de plusieurs mètres).
export interface FocusAnchors {
  /** Vecteur soustrait par centerBoxesToOrigin (repère IFC natif Z-up). */
  boxesAnchor: [number, number, number];
  /** Vecteur soustrait aux sommets web-ifc (repère Y-up : x, z, −IFC y). */
  sceneShift: [number, number, number];
}

const NOOP_DELTA: [number, number, number] = [0, 0, 0];

function diagOf(bbox: FrameBBox): number {
  return Math.hypot(
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2],
  );
}

/// Translation frame boîtes → frame scène (Y-up), avec garde-fous.
function frameDelta(
  boxes: BoxLike[] | null | undefined,
  sceneBBox: FrameBBox | null | undefined,
  anchors?: FocusAnchors | null,
): { delta: [number, number, number]; reconciled: boolean } {
  // 1) Δ EXACT depuis les ancres (source de vérité des deux pipelines).
  if (anchors) {
    const [bx, by, bz] = anchors.boxesAnchor;
    const [sx, sy, sz] = anchors.sceneShift;
    const exact: [number, number, number] = [bx - sx, bz - sy, -by - sz];
    const deltaLen = Math.hypot(exact[0], exact[1], exact[2]);
    const diag = sceneBBox ? diagOf(sceneBBox) : NaN;
    // Tolérance large (×4) : le shift scène inclut l'ancre d'étage ±0,00.
    if (Number.isFinite(deltaLen) && (!Number.isFinite(diag) || deltaLen <= Math.max(diag * 4, 1))) {
      return { delta: exact, reconciled: deltaLen > 1e-6 };
    }
    // Ancres incohérentes → on retombe sur l'empirique miroir-conscient.
  }

  // 2) Repli empirique miroir-conscient (ancre takeoff indisponible, ex.
  //    ancienne donnée persistée) : même miroir (x, z, −y) — sinon les
  //    marqueurs restent reflétés.
  const boxesB = boxes && boxes.length > 0 ? boxesFrameBBox(boxes) : null;
  if (!boxesB || !sceneBBox) return { delta: NOOP_DELTA, reconciled: false };

  const cScene = centerOf(sceneBBox); // Y-up : (x, hauteur, z)
  const cBoxes = centerOf(boxesB);    // Z-up : (x, y, z)
  const delta: [number, number, number] = [
    cScene[0] - cBoxes[0],
    cScene[1] - cBoxes[2],
    cScene[2] + cBoxes[1], // z_scène = −y_ifc → +cBoxes.y
  ];
  const diag = diagOf(sceneBBox);
  const deltaLen = Math.hypot(delta[0], delta[1], delta[2]);
  if (!Number.isFinite(deltaLen) || deltaLen > Math.max(diag * 2, 1)) return { delta: NOOP_DELTA, reconciled: false };
  return { delta, reconciled: deltaLen > 1e-6 };
}

/**
 * Corrige un point de focus (repère boîtes Z-up) pour la scène three.js Y-up.
 * @param focus   centre/taille demandés (repère MeshBox)
 * @param boxes   boîtes du takeoff (frame de référence du focus)
 * @param sceneBBox  bbox du modèle DANS la scène (Y-up) fournie par le loader
 */
export function reconcileFocusPoint(
  focus: FocusPoint,
  boxes: BoxLike[] | null | undefined,
  sceneBBox: FrameBBox | null | undefined,
  anchors?: FocusAnchors | null,
): FocusPoint3D {
  const naive = ifcToThree(focus.center);
  const sizeThree: [number, number, number] = [focus.size[0], focus.size[2], focus.size[1]];
  const { delta, reconciled } = frameDelta(boxes, sceneBBox, anchors);
  return {
    position: [naive[0] + delta[0], naive[1] + delta[1], naive[2] + delta[2]],
    size: sizeThree,
    delta,
    reconciled,
  };
}

/**
 * Réconciliation complète d'une requête de focus AU MARQUAGE CHIRURGICAL :
 * - `boxes` = chaque élément fautif (1 règle ou 2 clash) corrigé séparément ;
 * - `cameraTarget`/`cameraSize` = centre/taille d'union pour le recul caméra.
 * Sans bboxes individuelles : repli sur une seule cage d'union.
 */
export function reconcileFocusBoxes(
  focus: FocusRequestLike,
  boxes: BoxLike[] | null | undefined,
  sceneBBox: FrameBBox | null | undefined,
  anchors?: FocusAnchors | null,
): FocusCorners {
  const { delta, reconciled } = frameDelta(boxes, sceneBBox, anchors);
  const sources =
    focus.elements && focus.elements.length > 0
      ? focus.elements
      : [{ center: focus.center, size: focus.size }];

  const convert = (el: FocusBox) => {
    const naive = ifcToThree(el.center);
    return {
      position: [naive[0] + delta[0], naive[1] + delta[1], naive[2] + delta[2]] as [number, number, number],
      size: [el.size[0], el.size[2], el.size[1]] as [number, number, number],
    };
  };

  const out = sources.map(convert);
  const camNaive = ifcToThree(focus.center);
  return {
    boxes: out,
    hotspot: focus.hotspot ? convert(focus.hotspot) : null,
    after: focus.after ? { from: convert(focus.after.from), to: convert(focus.after.to) } : null,
    cameraTarget: [camNaive[0] + delta[0], camNaive[1] + delta[1], camNaive[2] + delta[2]],
    cameraSize: [focus.size[0], focus.size[2], focus.size[1]],
    delta,
    reconciled,
  };
}

// ---------------------------------------------------------------------------
// Cube de section chirurgical (méthode Solibri / Navisworks) — 2026-08-06
// Pendant le focus, la maquette est DÉCOUPÉE par 6 plans autour de la zone
// exacte : tout ce qui est hors du cube disparaît RÉELLEMENT (pas un simple
// fantôme) → la faute et sa zone restent seules, nettes, lisibles.
// ---------------------------------------------------------------------------

export interface SectionPlane3D {
  /** Normale unitaire du demi-espace à CONSERVER (produit scalaire ≥ 0). */
  normal: [number, number, number];
  /** Constante du plan (n·p + c = 0). */
  constant: number;
}

/// Demi-côté du cube de section : 4× le rayon du hotspot, borné [1,2 m – 8 m].
export function sectionHalfExtent(hotspotSize: [number, number, number]): number {
  const radius = Math.hypot(hotspotSize[0], hotspotSize[1], hotspotSize[2]) / 2;
  return Math.min(Math.max(radius * 4, 1.2), 8);
}

/// Les 6 plans du cube centré sur `center` (coordonnées scène Y-up).
export function clashSectionPlanes(
  center: [number, number, number],
  hotspotSize: [number, number, number],
): SectionPlane3D[] {
  const e = sectionHalfExtent(hotspotSize);
  const [cx, cy, cz] = center;
  return [
    { normal: [1, 0, 0], constant: -(cx - e) },
    { normal: [-1, 0, 0], constant: cx + e },
    { normal: [0, 1, 0], constant: -(cy - e) },
    { normal: [0, -1, 0], constant: cy + e },
    { normal: [0, 0, 1], constant: -(cz - e) },
    { normal: [0, 0, -1], constant: cz + e },
  ];
}

// ---------------------------------------------------------------------------
// Préférence d'affichage du focus QC : SOLIDE (défaut) ⇄ RÖNTGEN (fantôme)
// Retour utilisateur 2026-08-06 : « vaut mieux voir les clashs en mur solide
// et pas juste des reflets — comme ça les collisions apparaissent bien ».
// Le choix survit d'un clash à l'autre (localStorage) ; le bouton de bascule
// vit dans le bandeau de focus de la Maquette 3D.
// ---------------------------------------------------------------------------

export const QC_XRAY_STORAGE_KEY = "narchi:qc-xray";

/// Préférence lue : false = MURS SOLIDES (défaut), true = radiographie.
export function readQcXrayPreference(): boolean {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(QC_XRAY_STORAGE_KEY) === "1"
    );
  } catch {
    return false; // stockage indisponible (privacy mode) → SOLIDE par défaut
  }
}

/// Mémorise la préférence (échec silencieux si stockage indisponible).
export function writeQcXrayPreference(on: boolean): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(QC_XRAY_STORAGE_KEY, on ? "1" : "0");
    }
  } catch {
    /* stockage indisponible — la bascule reste valable pour ce focus */
  }
}
