/**
 * IFC STOREY ZERO — ancrage du ±0,00 PROJET dans la visionneuse 3D
 * -----------------------------------------------------------------
 * Symptôme utilisateur : « le niveau 0.00 du projet n'est pas le même que
 * celui du programme » — le niveau 5 du projet Revit s'affichait au niveau
 * 0 de l'application. Cause : web-ifc `COORDINATE_TO_ORIGIN` re-centre la
 * géométrie selon ses propres règles, sans tenir compte du point de base
 * du projet (les offsets vivent dans la chaîne IfcSite → IfcBuilding →
 * IfcBuildingStorey ObjectPlacement).
 *
 * Ce module résout l'ancre : la position Z ABSOLUE du placement du niveau
 * le plus bas du projet, exprimée RELATIVEMENT à la racine de sa chaîne
 * (donc sans la géoréférence éventuelle, type hauteur NN — elle reste hors
 * de l'affichage, intentionnellement). La visionneuse soustrait cette ancre
 * : le niveau de référence du projet est alors posé exactement sur z = 0,
 * cohérent avec la lecture BTP allemande (±0,00 = Geschossfußboden).
 *
 * Pur, sans WASM : il navigue dans les entités produites par le parseur
 * streaming (lib/ifcParser.ts) — même source de vérité que les quantités.
 */

import type { IfcEntity, Token } from "./ifcParser";

export interface StoreyZeroAnchor {
  /** Z de l'ancre à soustraire de la géométrie (espace IFC, géoréf. exclue). */
  z: number;
  /** Nom du niveau retenu (affichage : « ±0,00 ↔ Erdgeschoss »). */
  storeyName: string | null;
  storeyCount: number;
}

// ---------------------------------------------------------------------------
// Navigation dans les tokens STEP
// ---------------------------------------------------------------------------

function refId(token: Token | undefined): number | null {
  return token && token.kind === "ref" ? (token.value as number) : null;
}

function listNumbers(token: Token | undefined): number[] {
  if (!token || token.kind !== "list" || !Array.isArray(token.value)) return [];
  return (token.value as Token[])
    .filter((item) => item && item.kind === "number")
    .map((item) => item.value as number);
}

function stringValue(token: Token | undefined): string {
  return token && token.kind === "string" ? String(token.value) : "";
}

/**
 * Z cumulé d'une chaîne IfcLocalPlacement (placement + ancêtres), avec le Z
 * de la RACINE séparé (offset que web-ifc retire déjà / géoréférence).
 * IfcLocalPlacement(placementRelTo, relativePlacement) →
 * IfcAxis2Placement3D(location=IfcCartesianPoint(x,y,z), …).
 */
function placementChainZ(
  entities: Map<number, IfcEntity>,
  placementId: number,
): { total: number; root: number } | null {
  const visited = new Set<number>();
  let total = 0;
  let root = 0;
  let current: number | null = placementId;
  let depth = 0;

  while (current !== null && depth < 64) {
    if (visited.has(current)) return null; // chaîne cyclique : entrée malformée
    visited.add(current);
    depth += 1;

    const placement = entities.get(current);
    if (!placement || placement.type !== "IFCLOCALPLACEMENT") return null;
    const axisRef = refId(placement.args[1]);
    const axis = axisRef !== null ? entities.get(axisRef) : undefined;
    const locationRef = axis ? refId(axis.args[0]) : null;
    const point = locationRef !== null ? entities.get(locationRef) : undefined;
    const coords = point ? listNumbers(point.args[0]) : [];
    const z = coords.length === 1 ? 0 : (coords[2] ?? 0); // point 2D autorisé en 3D?: non — z=0 si absent

    const parentRef = refId(placement.args[0]);
    if (parentRef === null) {
      root = z; // racine : son Z est l'offset géographique/projet retiré de l'ancre
      total += z;
    } else {
      total += z;
    }
    current = parentRef;
  }
  return { total, root };
}

/**
 * Ancre ±0,00 : sur le niveau le plus bas, (Z absolu de son placement) −
 * (Z de la racine de sa chaîne). Null si aucun niveau/placement résoluble —
 * l'appelant retombe alors sur la boîte englobante (dernier point à 0).
 */
export function resolveStoreyZeroAnchor(
  entities: Map<number, IfcEntity>,
): StoreyZeroAnchor | null {
  let best: { z: number; name: string | null } | null = null;
  let storeyCount = 0;

  for (const entity of entities.values()) {
    if (entity.type !== "IFCBUILDINGSTOREY") continue;
    storeyCount += 1;
    const placementRef = refId(entity.args[5]);
    if (placementRef === null) continue;
    const chain = placementChainZ(entities, placementRef);
    if (!chain) continue;
    const anchorZ = chain.total - chain.root;
    const name = stringValue(entity.args[2]) || stringValue(entity.args[7]) || null;
    if (best === null || anchorZ < best.z) {
      best = { z: anchorZ, name };
    }
  }

  if (best === null) return null;
  return { z: best.z, storeyName: best.name, storeyCount };
}
