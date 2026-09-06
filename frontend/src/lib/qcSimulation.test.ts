import { describe, expect, it } from "vitest";
import { ClashDetector, type Clash } from "@/lib/planpruefung";
import {
  SAFETY_MARGIN_M,
  applyClashFixes,
  bboxArrayOf,
  buildClashFix,
  moveRankOf,
  shiftedBox,
} from "@/lib/qcSimulation";
import type { BuildingElement } from "@/data/types";

function element(id: string, name: string, type: string, bbox: [number, number, number, number, number, number] | null): BuildingElement {
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
    properties: bbox ? [{ key: "bbox", value: JSON.stringify(bbox) }] : [],
    lastUpdated: "2026-08-06T00:00:00.000Z",
    conflicts: 0,
  };
}

describe("moveRankOf — hiérarchie de mobilité", () => {
  it("une canalisation est mobile, un poteau jamais", () => {
    expect(moveRankOf("IFCFLOWSEGMENT")).toBeLessThan(moveRankOf("IFCDOOR"));
    expect(moveRankOf("IFCDOOR")).toBeLessThan(moveRankOf("IFCWALL"));
    expect(moveRankOf("IFCWALL")).toBeLessThan(moveRankOf("IFCCOLUMN"));
  });
});

describe("buildClashFix — geste correcteur minimal", () => {
  it("choisit l'élément mobile (MEP) face à la structure", () => {
    // Poteau (immobile) traversé par une gaine (mobile).
    const column = element("c1", "Stütze", "IFCCOLUMN", [0, 0, 0, 0.5, 0.5, 3]);
    const duct = element("d1", "Kanal", "IFCFLOWSEGMENT", [-1, 0.1, 1.4, 1, 0.4, 1.6]);
    const [clash] = ClashDetector.detectClashes([column, duct]);
    const fix = buildClashFix(clash, [column, duct]);
    expect(fix).not.toBeNull();
    expect(fix!.elementId).toBe("d1"); // la gaine bouge, PAS la Stütze
  });

  it("signe le déplacement pour ÉCARTER les deux volumes (+ marge)", () => {
    // Dalle (rang 60, mobile) empiétant sur un mur (rang 70).
    const slab = element("s1", "Decke", "IFCSLAB", [0, 0, 2.5, 4, 4, 3]);
    const wall = element("w1", "Wand", "IFCWALL", [1, 1, 1.6, 2, 1.3, 2.7]);
    const [clash] = ClashDetector.detectClashes([slab, wall]);
    // pénétrations : x=1, y=0,3, z=0,2 → axe le moins coûteux = Z (0,2 m)
    const fix = buildClashFix(clash, [slab, wall])!;
    expect(fix.axis).toBe(2);
    // la dalle (mobile) est AU-DESSUS du mur → elle MONTE (+z), jamais vers le mur
    expect(fix.elementId).toBe("s1");
    expect(fix.offset[2]).toBeCloseTo(clash.overlap[2] + SAFETY_MARGIN_M);
    expect(fix.offset[0]).toBe(0);
    expect(fix.offset[1]).toBe(0);
    expect(fix.label).toContain("Decke");
    expect(fix.label).toContain("anheben");
    expect(fix.label).toContain("mm");
  });

  it("retourne null sans bbox exploitable", () => {
    const clash = { id: "x", elementA: "c1", elementB: "c2", overlap: [0.1, 0.1, 0.1] } as unknown as Clash;
    expect(buildClashFix(clash, [element("c1", "A", "IFCWALL", null), element("c2", "B", "IFCWALL", null)])).toBeNull();
  });
});

describe("applyClashFixes — la preuve par la simulation", () => {
  it("après application, la collision DISPARAÎT du radar", () => {
    const wall = element("w1", "Wand", "IFCWALL", [0, 0, 0, 10, 0.3, 3]);
    const slab = element("s1", "Decke", "IFCSLAB", [8, -1, 2.4, 12, 1, 3]);
    const before = ClashDetector.detectClashes([wall, slab]);
    expect(before).toHaveLength(1);

    const fix = buildClashFix(before[0], [wall, slab])!;
    const moved = applyClashFixes([wall, slab], [fix]);
    const after = ClashDetector.detectClashes(moved);
    expect(after.filter((c) => c.id === before[0].id)).toHaveLength(0);

    // L'élément déplacé a réellement changé de bbox ; l'autre est intact.
    const mover = [wall, slab].find((e) => e.id === fix.elementId)!;
    const movedMover = moved.find((e) => e.id === fix.elementId)!;
    const fixed = moved.find((e) => e.id !== fix.elementId)!;
    const originalMax = bboxArrayOf(mover)![fix.axis + 3];
    expect(bboxArrayOf(movedMover)![fix.axis + 3]).toBeCloseTo(originalMax + fix.offset[fix.axis]);
    expect(JSON.stringify(fixed)).toBe(
      JSON.stringify([wall, slab].find((e) => e.id === fixed.id)!),
    );
  });

  it("les décalages d'un même élément se CUMULENT (2 gestes)", () => {
    const a = element("a", "Kanal", "IFCFLOWSEGMENT", [0, 0, 0, 1, 1, 1]);
    const b = element("b", "Wand1", "IFCWALL", [0.9, 0, 0, 5, 0.2, 3]);
    const c = element("c", "Wand2", "IFCWALL", [-0.3, 2, 0, 0.2, 5, 3]);
    const clashes = ClashDetector.detectClashes([a, b, c]);
    const fixAB = clashes.find((cl) => cl.id.includes("a") && cl.id.includes("b"))!;
    const fixes = [fixAB].map((cl) => buildClashFix(cl, [a, b, c])!);
    // Deuxième geste sur le MÊME canal (autre collision) si existante
    const fixAC = clashes.find((cl) => cl.id.includes("a") && cl.id.includes("c"));
    if (fixAC) fixes.push(buildClashFix(fixAC, [a, b, c])!);
    const moved = applyClashFixes([a, b, c], fixes);
    // Le canal a été déplacé ; au moins la collision AB a disparu.
    const remaining = ClashDetector.detectClashes(moved);
    expect(remaining.some((cl) => cl.id === fixAB.id)).toBe(false);
  });

  it("pureté : les éléments d'origine ne sont jamais mutés", () => {
    const wall = element("w1", "Wand", "IFCWALL", [0, 0, 0, 10, 0.3, 3]);
    const slab = element("s1", "Decke", "IFCSLAB", [8, -1, 2.4, 12, 1, 3]);
    const originalJSON = JSON.stringify([wall, slab]);
    const fix = buildClashFix(ClashDetector.detectClashes([wall, slab])[0], [wall, slab])!;
    applyClashFixes([wall, slab], [fix]);
    expect(JSON.stringify([wall, slab])).toBe(originalJSON);
  });
});

describe("shiftedBox — bbox du fantôme vert « après »", () => {
  it("décale le centre, conserve la taille", () => {
    const box = { center: [1, 2, 3] as [number, number, number], size: [4, 5, 6] as [number, number, number] };
    const shifted = shiftedBox(box, [0, 0.16, 0]);
    expect(shifted.center).toEqual([1, 2.16, 3]);
    expect(shifted.size).toEqual([4, 5, 6]);
  });
});
