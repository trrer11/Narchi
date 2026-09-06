import { describe, expect, it } from "vitest";
import { ClashDetector, expressIdFromSavedId, expressIdOf } from "@/lib/planpruefung";
import type { BuildingElement } from "@/data/types";

function element(id: string, name: string, type: string, bbox: [number, number, number, number, number, number] | null, expressId?: number): BuildingElement {
  return {
    id,
    guid: `g-${id}`,
    code: "320",
    classificationLabel: "Wände",
    name,
    type,
    materialId: "mat-concrete",
    level: "EG",
    projectId: "p1",
    status: "modeled",
    qty: 1,
    unit: "m",
    weightKg: 10,
    cost: 1,
    carbonKg: 1,
    properties: [
      ...(expressId ? [{ key: "Express ID", value: String(expressId) }] : []),
      ...(bbox ? [{ key: "bbox", value: JSON.stringify(bbox) }] : []),
    ],
    lastUpdated: "2026-08-06T00:00:00.000Z",
    conflicts: 0,
  };
}

describe("ClashDetector — localisation 3D du clash", () => {
  it("clash : centre/taille de l'union bbox + expressIds résolus", () => {
    const a = element("el-prj-x-2958-0", "Wand A", "IFCWALL", [0, 0, 0, 2, 0.3, 3]);
    const b = element("el-prj-x-3144-6", "Decke B", "IFCSLAB", [1, -1, 2.5, 4, 1, 3.1], 3144);
    const [clash] = ClashDetector.detectClashes([a, b]);
    expect(clash).toBeDefined();
    // Union = [0,-1,0 .. 4,1,3.1] → centre (2, 0, 1.55)
    expect(clash.center[0]).toBeCloseTo(2);
    expect(clash.center[1]).toBeCloseTo(0);
    expect(clash.center[2]).toBeCloseTo(1.55);
    expect(clash.size[0]).toBeCloseTo(4);
    expect(clash.size[1]).toBeCloseTo(2);
    expect(clash.nameA).toBe("Wand A");
    expect(clash.nameB).toBe("Decke B");
    // A : id sauvegardé parsé ; B : propriété Express ID directe
    expect(clash.expressIdA).toBe(2958);
    expect(clash.expressIdB).toBe(3144);
  });

  it("pas d'intersection → aucun clash", () => {
    const a = element("e1", "A", "IFCWALL", [0, 0, 0, 1, 1, 1]);
    const b = element("e2", "B", "IFCWALL", [5, 5, 5, 6, 6, 6]);
    expect(ClashDetector.detectClashes([a, b])).toHaveLength(0);
  });

  it("jumeaux Express ID (double sauvegarde) → PAS de clash fantôme", () => {
    // Le même mur IFC sauvegardé deux fois se recouvre à 100 % : ce n'est
    // pas une collision (clashs empilés « même endroit » de l'utilisateur).
    const a = element("el-p1-2958-0", "Wand x2", "IFCWALL", [0, 0, 0, 4, 0.3, 3], 2958);
    const b = element("el-p2-2958-0", "Wand x2 (copie)", "IFCWALL", [0, 0, 0, 4, 0.3, 3], 2958);
    expect(ClashDetector.detectClashes([a, b])).toHaveLength(0);
  });

  it("vrais duplicatas Revit (Express ID différents) → clash CONSERVÉ", () => {
    const a = element("el-p1-2958-0", "Wand A", "IFCWALL", [0, 0, 0, 4, 0.3, 3], 2958);
    const b = element("el-p1-3001-0", "Wand B (co-planifié)", "IFCWALL", [0, 0, 0, 4, 0.3, 3], 3001);
    expect(ClashDetector.detectClashes([a, b])).toHaveLength(1);
  });

  it("taille minimale du marqueur garantie (collision ponctuelle)", () => {
    const a = element("e1", "A", "IFCWALL", [0, 0, 0, 0.1, 0.1, 0.1]);
    const b = element("e2", "B", "IFCBEAM", [0.05, 0.05, 0.05, 0.2, 0.2, 0.2]);
    const [clash] = ClashDetector.detectClashes([a, b]);
    expect(Math.min(...clash.size)).toBeGreaterThanOrEqual(0.25);
  });
});

describe("ClashDetector — zone d'intersection exacte (hotspot)", () => {
  it("hotspot = ∩ des deux boîtes — la SEULE place à corriger", () => {
    // Mur 10 m (0..10) traversé par une dalle (8..12) : zone exacte 8..10.
    const a = element("e1", "Wand", "IFCWALL", [0, 0, 0, 10, 0.3, 3]);
    const b = element("e2", "Decke", "IFCSLAB", [8, -1, 2.4, 12, 1, 3]);
    const [clash] = ClashDetector.detectClashes([a, b]);
    expect(clash.hotspot).toBeDefined();
    // ∩ = [8,0,2.4 .. 10,0.3,3] → centre (9, 0.15, 2.7), taille (2, 0.3, 0.6)
    expect(clash.hotspot.center[0]).toBeCloseTo(9);
    expect(clash.hotspot.center[1]).toBeCloseTo(0.15);
    expect(clash.hotspot.center[2]).toBeCloseTo(2.7);
    expect(clash.hotspot.size[0]).toBeCloseTo(2);
    expect(clash.hotspot.size[1]).toBeCloseTo(0.3);
    expect(clash.hotspot.size[2]).toBeCloseTo(0.6);
    // Crucial : la zone exacte est BIEN plus petite que l'union (12 > 2) —
    // c'est elle qui est marquée, pas les murs entiers.
    expect(clash.hotspot.size[0]).toBeLessThan(clash.size[0]);
  });

  it("le hotspot est contenu dans chacun des deux éléments", () => {
    const a = element("e1", "A", "IFCWALL", [0, 0, 0, 4, 4, 4]);
    const b = element("e2", "B", "IFCCOLUMN", [3, 3, 3, 6, 6, 6]);
    const [clash] = ClashDetector.detectClashes([a, b]);
    const [cx, cy, cz] = clash.hotspot.center;
    expect(cx).toBeGreaterThanOrEqual(3); // [3..4] dans les deux
    expect(cx).toBeLessThanOrEqual(4);
    expect(cy).toBeGreaterThanOrEqual(3);
    expect(cy).toBeLessThanOrEqual(4);
    expect(cz).toBeGreaterThanOrEqual(3);
    expect(cz).toBeLessThanOrEqual(4);
    // pénétration = taille du hotspot (par axe)
    expect(clash.hotspot.size[0]).toBeCloseTo(clash.overlap[0]);
    expect(clash.hotspot.size[1]).toBeCloseTo(clash.overlap[1]);
    expect(clash.hotspot.size[2]).toBeCloseTo(clash.overlap[2]);
  });
});

describe("résolution d'Express ID", () => {
  it("propriété « Express ID » prioritaire", () => {
    const el = element("el-1", "A", "IFCWALL", null, 777);
    expect(expressIdOf(el)).toBe(777);
  });

  it("repli sur l'id interne « el-<n> »", () => {
    expect(expressIdOf(element("el-42", "A", "IFCWALL", null))).toBe(42);
    expect(expressIdOf(element("el-prj-x-123-0", "A", "IFCWALL", null))).toBeNull();
  });

  it("identifiant sauvegardé « el-<projet>-<expressId>-<idx> »", () => {
    expect(expressIdFromSavedId("el-prj-12wc09-2958-0")).toBe(2958);
    expect(expressIdFromSavedId("el-prj-x-3144-6")).toBe(3144);
    expect(expressIdFromSavedId("autre")).toBeNull();
    // l'ancien bug : parseInt("120929580") n'a plus cours
    expect(expressIdFromSavedId("el-prj-12wc09-2958-0")).not.toBe(120929580);
  });
});
