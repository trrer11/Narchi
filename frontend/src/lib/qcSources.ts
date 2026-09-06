// NARCHI — Source d'entrée du BIM-IQ (QC & Conformité).
//
// PANNE CONSTATÉE (2026-08-06, retour utilisateur) : « il montre les clashs
// dans le bâtiment qui avait des cubes même si les cubes ne sont plus là »,
// « des places où il n'y a aucun mur », « des fois le même endroit ».
//
// CAUSE : l'ancienne priorité (PROJET d'abord) faisait analyser les Bauteile
// d'un ANCIEN import sauvegardé (persistés en IndexedDB) pendant que la
// Maquette 3D affichait la NOUVELLE maquette non sauvegardée. Les marqueurs
// 3D, positionnés avec les coordonnées du fantôme, tombaient sur des places
// sans murs — et les éléments sauvegardés en double (même Express ID)
// s'empilaient sur le même endroit.
//
// RÈGLE PROFESSIONNELLE DÉSORMAIS (une seule, irréfutable) :
//   **le BIM-IQ analyse TOUJOURS la maquette affichée dans le viewer 3D**
//   (what you see is what you check) :
//   1. le takeoff de la maquette importée (ModelTakeoff) — c'est ELLE que
//      Maquette 3D rend (mesh web-ifc ou boîtes) : clash et focus parlent
//      de la MÊME géométrie, au même repère, zéro décalage possible ;
//   2. à défaut, les éléments du projet actif (aucune maquette chargée) ;
//   3. rien : état vide explicite.
//   + DÉDUPLICATION par Express ID dans les deux cas : un élément sauvegardé
//     deux fois (double import) n'apparaît qu'UNE fois — fini les clashs
//     « même endroit » entre jumeaux.

import type { BuildingElement } from "@/data/types";
import type { MeshBox } from "@/lib/ifcGeometry";
import type { ModelTakeoff } from "@/lib/modelTakeoff";

export type QcSourcesKind = "project" | "takeoff" | "none";

export interface QcAuditInput {
  elements: BuildingElement[];
  source: QcSourcesKind;
  /** Part des éléments dotés d'une bbox réelle (0..1). */
  geometryCoverage: number;
  /** Éléments sauvegardés en double (même Express ID) écartés — sinon le
      même clash est détecté deux fois au MÊME endroit. */
  duplicatesSkipped: number;
  /// Libellé allemand court affiché dans le badge de la page.
  sourceLabel: string;
}

const BBOX_KEY = "bbox";

function hasBBox(element: BuildingElement): boolean {
  return element.properties.some((p) => p.key === BBOX_KEY);
}

/// Express ID résolu d'un élément projeté/sauvegardé (propriété « Express
/// ID » ou suffixe « el-<n> »). Local — évite la dépendance circulaire avec
/// le module planpruefung.
export function expressIdKey(element: BuildingElement): number | null {
  const prop = element.properties.find((p) => p.key === "Express ID" || p.key === "ExpressID");
  if (prop) {
    const n = Number(prop.value);
    if (Number.isFinite(n)) return n;
  }
  const match = element.id.match(/^el-(\d+)$/);
  return match ? Number(match[1]) : null;
}

/// Déduplication par Express ID (ordre stable, premier conservé). Un même
/// objet IFC sauvegardé deux fois = UN élément d'audit, pas deux jumeaux
/// qui se collisionnent mutuellement au mètre près.
export function dedupeByExpressId(elements: BuildingElement[]): {
  unique: BuildingElement[];
  skipped: number;
} {
  const seen = new Set<number>();
  const unique: BuildingElement[] = [];
  let skipped = 0;
  for (const element of elements) {
    const key = expressIdKey(element);
    if (key !== null) {
      if (seen.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);
    }
    unique.push(element);
  }
  return { unique, skipped };
}

/// Propriété bbox au format attendu par ClashDetector :
/// [xmin, ymin, zmin, xmax, ymax, zmax] — calculée depuis MeshBox
/// (centre ± demi-taille dans le repère monde).
export function bboxFromMeshBox(box: MeshBox): number[] {
  return [
    box.center.x - Math.abs(box.size.x),
    box.center.y - Math.abs(box.size.y),
    box.center.z - Math.abs(box.size.z),
    box.center.x + Math.abs(box.size.x),
    box.center.y + Math.abs(box.size.y),
    box.center.z + Math.abs(box.size.z),
  ];
}

interface TakeoffElementLite {
  expressId: number;
  globalId?: string;
  kg: string;
  kgLabel: string;
  name: string;
  ifcType: string;
  level: string;
  qty: number;
  unit: string;
  weightKg: number;
  cost: number;
  carbonKg: number;
  rawQty?: Record<string, number | undefined>;
}

/// Projection harmonisée takeoff → BuildingElement (miroir de la
/// sauvegarde projet de ModelImport) avec bbox réelle quand disponible.
export function takeoffElementToBuildingElement(
  element: TakeoffElementLite,
  box: MeshBox | null,
  projectId: string,
): BuildingElement {
  const properties = [
    { key: "Express ID", value: String(element.expressId), source: "IFC" },
    { key: "IFC Class", value: element.ifcType, source: "IFC Parser" },
    ...(element.rawQty
      ? Object.entries(element.rawQty)
          .filter(([, v]) => typeof v === "number" && v > 0)
          .map(([k, v]) => ({ key: k, value: String(v), source: "BaseQuantities" }))
      : []),
    ...(box
      ? [{ key: BBOX_KEY, value: JSON.stringify(bboxFromMeshBox(box)), source: "IFC Geometrie" }]
      : []),
  ];
  return {
    id: `el-${element.expressId}`,
    guid: element.globalId || `${projectId}-${element.expressId}`,
    code: element.kg,
    classificationLabel: element.kgLabel,
    name: element.name,
    type: element.ifcType,
    materialId: element.kg === "340" ? "mat-glass" : "mat-concrete",
    level: element.level || "—",
    projectId,
    status: "modeled",
    qty: element.qty,
    unit: element.unit,
    weightKg: element.weightKg,
    cost: element.cost,
    carbonKg: element.carbonKg,
    properties,
    lastUpdated: new Date().toISOString(),
    conflicts: 0,
  };
}

/// Choix de la source d'audit BIM-IQ.
/// RÈGLE IRRÉFUTABLE : la maquette affichée (takeoff) est analysée EN
/// PRIORITÉ — le focus 3D et l'audit parlent de la MÊME géométrie. Le projet
/// n'est analysé que si aucune maquette n'est chargée.
export function resolveAuditInput(
  projectElements: BuildingElement[],
  takeoff: ModelTakeoff | null,
): QcAuditInput {
  if (takeoff && takeoff.elements.length > 0) {
    const boxesByExpressId = new Map((takeoff.boxes ?? []).map((b) => [b.id, b]));
    let withBBox = 0;
    const projected = takeoff.elements.map((element) => {
      const box = boxesByExpressId.get(element.expressId) ?? null;
      if (box) withBBox += 1;
      return takeoffElementToBuildingElement(
        element as unknown as TakeoffElementLite,
        box,
        takeoff.fileName,
      );
    });
    const { unique, skipped } = dedupeByExpressId(projected);
    return {
      elements: unique,
      source: "takeoff",
      geometryCoverage: withBBox / projected.length,
      duplicatesSkipped: skipped,
      sourceLabel: `${unique.length} Bauteile aus „${takeoff.fileName}“ (Modell der Maquette 3D)`,
    };
  }

  if (projectElements.length > 0) {
    const { unique, skipped } = dedupeByExpressId(projectElements);
    const withBBox = unique.filter(hasBBox).length;
    return {
      elements: unique,
      source: "project",
      geometryCoverage: withBBox / unique.length,
      duplicatesSkipped: skipped,
      sourceLabel: `${unique.length} Bauteile des aktiven Projekts (keine Maquette geladen)`,
    };
  }

  return { elements: [], source: "none", geometryCoverage: 0, duplicatesSkipped: 0, sourceLabel: "Keine Daten" };
}
