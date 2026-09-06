// Tests de la source d'entrée du BIM-IQ (QC & Conformité).

import { describe, expect, it } from "vitest";
import type { BuildingElement } from "@/data/types";
import type { MeshBox } from "@/lib/ifcGeometry";
import type { ModelTakeoff } from "@/lib/modelTakeoff";
import {
  bboxFromMeshBox,
  dedupeByExpressId,
  resolveAuditInput,
  takeoffElementToBuildingElement,
} from "@/lib/qcSources";

const BOX: MeshBox = {
  id: 42,
  type: "IfcWall",
  center: { x: 5, y: 1.4, z: -2 },
  size: { x: 2, y: 1.4, z: 0.12 },
  rotationY: 0,
  level: "EG",
};

function projectElement(withBBox: boolean): BuildingElement {
  return {
    id: "e1",
    guid: "g1",
    code: "300",
    classificationLabel: "Rohbau",
    name: "Mur",
    type: "IfcWall",
    materialId: "mat-concrete",
    level: "EG",
    projectId: "p1",
    status: "modeled",
    qty: 2.4,
    unit: "m³",
    weightKg: 1000,
    cost: 400,
    carbonKg: 200,
    properties: withBBox ? [{ key: "bbox", value: JSON.stringify([0, 0, 0, 1, 1, 1]) }] : [],
    lastUpdated: "2026-08-05T00:00:00.000Z",
    conflicts: 0,
  };
}

function takeoff(): ModelTakeoff {
  return {
    format: "IFC",
    precision: "exact",
    precisionNote: "test",
    fileName: "meuble final.ifc",
    fileSize: 1000,
    projectName: "Projet",
    author: "Test",
    organization: "Revit",
    schema: "IFC4",
    storeys: ["EG"],
    ngf: 60,
    volume: 180,
    elements: [
      {
        expressId: 42,
        globalId: "g-42",
        kg: "300",
        kgLabel: "Rohbau",
        name: "AW Stahlbeton 24cm",
        ifcType: "IfcWall",
        level: "EG",
        qty: 2.4,
        unit: "m³",
        weightKg: 1200,
        cost: 430,
        carbonKg: 240,
        rawQty: { volume: 2.4, area: 10 },
      } as never,
      {
        expressId: 77,
        globalId: "g-77",
        kg: "340",
        kgLabel: "Fenster",
        name: "Kunststofffenster",
        ifcType: "IfcWindow",
        level: "EG",
        qty: 2,
        unit: "St",
        weightKg: 40,
        cost: 1000,
        carbonKg: 60,
        rawQty: undefined,
      } as never,
    ],
    kgBuckets: [],
    boxes: [BOX],
    totals: { count: 2, cost: 1430, carbonKg: 300, weightKg: 1240, perM2: 23 },
    warnings: [],
  };
}

describe("bboxFromMeshBox", () => {
  it("centre ± demi-taille → AABB mondiale", () => {
    expect(bboxFromMeshBox(BOX)).toEqual([3, 0, -2.12, 7, 2.8, -1.88]);
  });
});

describe("takeoffElementToBuildingElement", () => {
  it("projette quantités + bbox réelle en propriétés lisibles par l'audit", () => {
    const el = takeoffElementToBuildingElement(takeoff().elements[0] as never, BOX, "f.ifc");
    expect(el.type).toBe("IfcWall");
    expect(el.properties.some((p) => p.key === "bbox")).toBe(true);
    expect(el.properties.some((p) => p.key === "volume" && p.value === "2.4")).toBe(true);
  });
});

describe("resolveAuditInput — ce que tu vois est ce qui est vérifié", () => {
  it("priorité 1 : la MAQUETTE affichée, jamais un projet fantôme", () => {
    // Éléments projet présents (ancien import « cubes ») ET maquette chargée :
    // l'audit DOIT analyser la maquette — sinon les marqueurs 3D tombent sur
    // des places sans murs (retour utilisateur 2026-08-06).
    const input = resolveAuditInput([projectElement(false), projectElement(true)], takeoff());
    expect(input.source).toBe("takeoff");
    expect(input.elements).toHaveLength(2);
    expect(input.sourceLabel).toContain("meuble final.ifc");
    expect(input.sourceLabel).toContain("Maquette 3D");
  });

  it("priorité 2 : projet actif — seulement si AUCUNE maquette n'est chargée", () => {
    const input = resolveAuditInput([projectElement(false), projectElement(true)], null);
    expect(input.source).toBe("project");
    expect(input.elements).toHaveLength(2);
    expect(input.geometryCoverage).toBe(0.5);
    expect(input.duplicatesSkipped).toBe(0);
  });

  it("priorité 3 : rien → source none, tableau vide", () => {
    const input = resolveAuditInput([], null);
    expect(input.source).toBe("none");
    expect(input.elements).toEqual([]);
    expect(input.geometryCoverage).toBe(0);
  });

  it("jumeaux Express ID (élément sauvegardé 2×) → dédupliqués, comptés", () => {
    const twinA = projectElement(true);
    const twinB = { ...projectElement(true), id: "el-prj-2-2958-1", properties: [{ key: "Express ID", value: "2958" }] };
    twinA.properties.push({ key: "Express ID", value: "2958" });
    const input = resolveAuditInput([twinA, twinB], null);
    expect(input.elements).toHaveLength(1); // un seul objet IFC logique
    expect(input.duplicatesSkipped).toBe(1);
  });

  it("takeoff : chaque élément prend sa bbox réelle MeshBox", () => {
    const input = resolveAuditInput([], takeoff());
    expect(input.source).toBe("takeoff");
    expect(input.geometryCoverage).toBe(0.5); // 1 élément sur 2 a un MeshBox
    expect(input.elements[0].properties.some((p) => p.key === "bbox")).toBe(true);
  });
});

describe("dedupeByExpressId — fini les clashs « même endroit »", () => {
  it("ordre stable, premier conservé, éléments sans Express ID gardés", () => {
    const a = projectElement(true);
    a.properties.push({ key: "Express ID", value: "10" });
    const b = { ...projectElement(true), id: "x", name: "Doublon" };
    b.properties.push({ key: "Express ID", value: "10" });
    const c = projectElement(false); // sans Express ID → toujours gardé
    const { unique, skipped } = dedupeByExpressId([a, b, c]);
    expect(unique.map((e) => e.name)).toEqual(["Mur", "Mur"]);
    expect(skipped).toBe(1);
  });
});
