// NARCHI V5 — IFC geometry extractor (PATCH ANTI-SCATTERING).
// Résolution matricielle complète des IfcLocalPlacement imbriqués avec
// détection de cycle et unification du barycentre du projet à (0, 0, 0).

import { Box3, Matrix4, Quaternion, Vector3 } from "three";
import type { IfcEntity, IfcModel } from "./ifcParser";

export interface Vec3 { x: number; y: number; z: number; }

export interface MeshBox {
  id: number;
  type: string;
  center: Vec3;
  size: Vec3;     // half-extents dans le repère monde (axes alignés)
  rotationY: number; // conservé pour rétrocompatibilité UI
  level: string;
}

// ---------------------------------------------------------------------------
// Helpers de parsing bas-niveau
// ---------------------------------------------------------------------------

function parseNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof (v as any).value === "number") return (v as any).value;
  if (v && typeof (v as any).value === "string") return Number((v as any).value);
  return 0;
}

function parseList(raw: unknown): number[] {
  if (!raw) return [];
  if (raw && (raw as any).kind === "list") {
    const arr = (raw as any).value as unknown[];
    return arr.map(parseNumber);
  }
  if (Array.isArray(raw)) return raw.map(parseNumber);
  return [];
}

function parseCartesianPoint(entity?: IfcEntity): number[] {
  if (!entity || entity.type !== "IFCCARTESIANPOINT") return [0, 0, 0];
  const coords = parseList(entity.args[0]);
  return [coords[0] ?? 0, coords[1] ?? 0, coords[2] ?? 0];
}

function parseDirection(entity?: IfcEntity): number[] | undefined {
  if (!entity || entity.type !== "IFCDIRECTION") return undefined;
  const coords = parseList(entity.args[0]);
  if (coords.length < 2) return undefined;
  return coords;
}

interface Axis2Placement3D {
  location: number[];
  axis?: number[];
  refDirection?: number[];
}

function parseAxis2Placement3D(entity: IfcEntity, byId: Map<number, IfcEntity>): Axis2Placement3D {
  const locationRef = entity.args[0]?.kind === "ref" ? (entity.args[0].value as number) : null;
  const axisRef = entity.args[1]?.kind === "ref" ? (entity.args[1].value as number) : null;
  const refDirRef = entity.args[2]?.kind === "ref" ? (entity.args[2].value as number) : null;

  return {
    location: locationRef ? parseCartesianPoint(byId.get(locationRef)) : [0, 0, 0],
    axis: axisRef ? parseDirection(byId.get(axisRef)) : undefined,
    refDirection: refDirRef ? parseDirection(byId.get(refDirRef)) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Conversion IfcAxis2Placement3D → Matrix4
// ---------------------------------------------------------------------------

function axisToMatrix(ap: Axis2Placement3D): Matrix4 {
  const origin = new Vector3(ap.location[0] ?? 0, ap.location[1] ?? 0, ap.location[2] ?? 0);

  // Axe Z (Axis) — par défaut +Z
  const zAxis = ap.axis && ap.axis.length >= 3
    ? new Vector3(ap.axis[0], ap.axis[1], ap.axis[2]).normalize()
    : new Vector3(0, 0, 1);

  // Axe X (RefDirection) — par défaut +X
  let xAxis = ap.refDirection && ap.refDirection.length >= 3
    ? new Vector3(ap.refDirection[0], ap.refDirection[1], ap.refDirection[2]).normalize()
    : new Vector3(1, 0, 0);

  // Orthonormalisation de Gram-Schmidt
  const yAxis = new Vector3().crossVectors(zAxis, xAxis).normalize();
  // Recalcule X pour garantir un repère direct orthonormé
  xAxis.crossVectors(yAxis, zAxis).normalize();

  const m = new Matrix4();
  m.makeBasis(xAxis, yAxis, zAxis);
  m.setPosition(origin);
  return m;
}

// ---------------------------------------------------------------------------
// Résolution récursive mémoïsée des placements avec détection de cycle
// ---------------------------------------------------------------------------

function resolveAbsolutePlacement(
  entityId: number,
  byId: Map<number, IfcEntity>,
  memo: Map<number, Matrix4>,
  stack: Set<number> = new Set()
): Matrix4 {
  if (memo.has(entityId)) return memo.get(entityId)!.clone();
  if (stack.has(entityId)) {
    console.warn(`[IfcGeometry] Placement cycle detected at entity ${entityId}`);
    return new Matrix4();
  }

  const entity = byId.get(entityId);
  if (!entity || entity.type !== "IFCLOCALPLACEMENT") {
    return new Matrix4();
  }

  stack.add(entityId);

  const parentRef = entity.args[0]?.kind === "ref" ? (entity.args[0].value as number) : null;
  const axisRef = entity.args[1]?.kind === "ref" ? (entity.args[1].value as number) : null;

  let localMatrix = new Matrix4();
  if (axisRef) {
    const axisEntity = byId.get(axisRef);
    if (axisEntity && axisEntity.type === "IFCAXIS2PLACEMENT3D") {
      const ap = parseAxis2Placement3D(axisEntity, byId);
      localMatrix = axisToMatrix(ap);
    }
  }

  let result = localMatrix;
  if (parentRef) {
    const parentMatrix = resolveAbsolutePlacement(parentRef, byId, memo, stack);
    result = parentMatrix.multiply(localMatrix);
  }

  stack.delete(entityId);
  memo.set(entityId, result.clone());
  return result;
}

// ---------------------------------------------------------------------------
// Extraction des dimensions par type IFC
// ---------------------------------------------------------------------------

function isWallLike(type: string): boolean {
  return [
    "IFCWALL", "IFCWALLSTANDARDCASE", "IFCWALLELEMENTEDCASE", "IFCCURTAINWALL"
  ].includes(type);
}

function dimensionsForElement(el: IfcModel["elements"][number]): { dx: number; dy: number; dz: number } {
  const q = el.qty;
  const type = el.type;

  if (isWallLike(type)) {
    return {
      dx: Math.max(q.width ?? 0.25, 0.15),
      dy: Math.max(q.length ?? 1.0, 0.5),
      dz: Math.max(q.height ?? 3.0, 1.0),
    };
  }
  if (type === "IFCSITE" || type === "IFCGEOGRAPHICELEMENT") {
    const side = q.area ? Math.sqrt(q.area) : 80.0;
    return { dx: side, dy: side, dz: 0.2 };
  }
  if (type === "IFCSLAB" || type === "IFCFOOTING" || type === "IFCFOUNDATION") {
    const area = (q.area && q.area > 0.1) ? q.area : (q.length && q.width ? q.length * q.width : 400.0);
    const side = Math.sqrt(area);
    return {
      dx: Math.max(side, 10.0),
      dy: Math.max(side, 10.0),
      dz: Math.max(q.height ?? q.width ?? 0.25, 0.15),
    };
  }
  if (type === "IFCCOLUMN" || type === "IFCPILE") {
    const side = q.width ?? 0.3;
    return { dx: side, dy: side, dz: Math.max(q.height ?? q.length ?? 3.0, 1.0) };
  }
  if (type === "IFCBEAM") {
    return { dx: q.width ?? 0.2, dy: Math.max(q.length ?? 2.0, 0.5), dz: q.width ?? 0.2 };
  }
  if (type === "IFCWINDOW" || type === "IFCDOOR" || type === "IFCWINDOWSTANDARDCASE" || type === "IFCDOORSTANDARDCASE") {
    return { dx: 0.1, dy: q.width ?? 1.0, dz: q.height ?? 1.5 };
  }
  if (type === "IFCCOVERING") {
    const area = (q.area && q.area > 0.1) ? q.area : 15.0;
    const side = Math.sqrt(area);
    return { dx: Math.max(side, 4.0), dy: Math.max(side, 4.0), dz: 0.05 };
  }

  return {
    dx: q.width ?? q.length ?? 1.0,
    dy: q.length ?? q.width ?? 1.0,
    dz: q.height ?? 1.0,
  };
}

// ---------------------------------------------------------------------------
// Recentrage du barycentre du projet à l'origine
// ---------------------------------------------------------------------------

function centerBoxesToOrigin(boxes: MeshBox[]): [number, number, number] | null {
  if (boxes.length === 0) return null;
  const bbox = new Box3();
  for (const b of boxes) {
    const c = new Vector3(b.center.x, b.center.y, b.center.z);
    const h = new Vector3(b.size.x, b.size.y, b.size.z);
    bbox.expandByPoint(c.clone().add(h));
    bbox.expandByPoint(c.clone().sub(h));
  }
  const centroid = bbox.getCenter(new Vector3());
  for (const b of boxes) {
    b.center.x -= centroid.x;
    b.center.y -= centroid.y;
    b.center.z -= centroid.z;
  }
  // Le vecteur exactement soustrait est renvoyé : c'est l'ANCRE brute (repère
  // IFC natif Z-up) qui permettra à la 3D de réconcilier les deux mondes SANS
  // heuristique de bbox (cause établie des marqueurs « hors modèle »).
  return [centroid.x, centroid.y, centroid.z];
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/// Résultat d'extraction : les boîtes centrées + le vecteur d'ancre
/// exactement soustrait (repère IFC natif Z-up) — voir centerBoxesToOrigin.
export interface ExtractedGeometry {
  boxes: MeshBox[];
  anchor: [number, number, number] | null;
}

/// Types NON PHYSIQUES exclus des boîtes : un IfcSite de 80×80 m ou une
/// grille IFC embarqués dans le set de boîtes déforment le recentrage, la
/// bbox (anciennement utilisée pour la réconciliation du focus) ET rendent
/// une plaque fantôme sous le bâtiment dans la vue analytique.
const NON_PHYSICAL_BOX_TYPES =
  /^(IFCSITE|IFCBUILDING|IFCBUILDINGSTOREY|IFCSPACE|IFCSPATIALZONE|IFCGRID|IFCANNOTATION)$/;

export function extractGeometry(model: IfcModel, byId: Map<number, IfcEntity>): ExtractedGeometry {
  const boxes: MeshBox[] = [];
  const placementMemo = new Map<number, Matrix4>();

  for (const el of model.elements) {
    if (NON_PHYSICAL_BOX_TYPES.test(el.type.toUpperCase())) continue;
    const entity = byId.get(el.id);
    if (!entity) continue;

    const placementRef = entity.args[5]?.kind === "ref"
      ? (entity.args[5].value as number)
      : null;

    const matrix = placementRef
      ? resolveAbsolutePlacement(placementRef, byId, placementMemo)
      : new Matrix4();

    const pos = new Vector3();
    const scale = new Vector3();
    matrix.decompose(pos, new Quaternion(), scale);

    const dims = dimensionsForElement(el);

    boxes.push({
      id: el.id,
      type: el.type,
      center: { x: pos.x, y: pos.y, z: pos.z },
      size: { x: dims.dx / 2, y: dims.dy / 2, z: dims.dz / 2 },
      rotationY: Math.atan2(matrix.elements[4], matrix.elements[0]),
      level: el.storey,
    });
  }

  const anchor = centerBoxesToOrigin(boxes);
  return { boxes, anchor };
}
