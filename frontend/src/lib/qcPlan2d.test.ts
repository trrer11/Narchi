import { describe, expect, it } from "vitest";
import { ClashDetector } from "@/lib/planpruefung";
import { buildPlan2D, clashesOnLevel, levelsOf, planColorOf } from "@/lib/qcPlan2d";
import { clashesTopics } from "@/lib/bcfExport";
import type { BuildingElement } from "@/data/types";

function element(
  id: string,
  type: string,
  level: string,
  bbox: [number, number, number, number, number, number] | null,
): BuildingElement {
  return {
    id,
    guid: `g-${id}`,
    code: "320",
    classificationLabel: "Wände",
    name: `${type} ${id}`,
    type,
    materialId: "mat-concrete",
    level,
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

describe("qcPlan2d — vue en plan calculée de la vraie géométrie", () => {
  it("levelsOf : étages triés par population, éléments sans bbox ignorés", () => {
    const els = [
      element("a", "IFCWALL", "EG", [0, 0, 0, 1, 1, 1]),
      element("b", "IFCWALL", "EG", [2, 0, 0, 3, 1, 1]),
      element("c", "IFCSLAB", "OG", [0, 0, 3, 10, 10, 3.16]),
      element("d", "IFCDOOR", "Sans niveau", null),
    ];
    expect(levelsOf(els)).toEqual(["EG", "OG"]);
  });

  it("buildPlan2D : rectangles projetés + étendue + niveau filtré", () => {
    const els = [
      element("a", "IFCWALL", "EG", [0, 0, 0, 2, 0.3, 3]),
      element("b", "IFCDOOR", "EG", [0.8, -0.05, 0, 1.7, 0.1, 2.1]),
      element("c", "IFCSLAB", "OG", [0, 0, 3, 10, 10, 3.16]),
    ];
    const plan = buildPlan2D(els, "EG")!;
    expect(plan.rects).toHaveLength(2);
    expect(plan.minX).toBe(0);
    expect(plan.maxX).toBe(2);
    expect(plan.minY).toBeCloseTo(-0.05);
    expect(plan.totalElements).toBe(2);
    expect(plan.capped).toBe(false);
    // OG : seule la dalle
    expect(buildPlan2D(els, "OG")!.rects).toHaveLength(1);
    // étage absent → null
    expect(buildPlan2D(els, "DG")).toBeNull();
  });

  it("planColorOf : familles métier distinctes", () => {
    expect(planColorOf("IFCWALL")).not.toBe(planColorOf("IFCDOOR"));
    expect(planColorOf("IFCCOLUMN")).not.toBe(planColorOf("IFCSLAB"));
  });

  it("clashesOnLevel : un clash apparaît si UN fautif vit sur l'étage", () => {
    const wallEG = element("w1", "IFCWALL", "EG", [0, 0, 0, 4, 0.3, 3]);
    const slabOG = element("s1", "IFCSLAB", "OG", [1, -0.1, 2.6, 3, 0.4, 2.8]);
    const doorEG = element("d1", "IFCDOOR", "EG", [1, 0, 0.5, 1.2, 0.4, 2.5]);
    const els = [wallEG, slabOG, doorEG];
    const clashes = ClashDetector.detectClashes(els);
    const onEG = clashesOnLevel(clashes, els, "EG");
    const onOG = clashesOnLevel(clashes, els, "OG");
    expect(onEG.length).toBeGreaterThan(0);
    expect(onOG.some((c) => c.elementA === "s1" || c.elementB === "s1")).toBe(true);
    // Un clash EG↔EG n'est PAS dupliqué sur OG
    expect(onOG.filter((c) => c.elementA === "w1" && c.elementB === "d1")).toHaveLength(0);
  });
});

describe("bcfExport — topics sur les VRAIES collisions (fin du BCF vide)", () => {
  it("clashesTopics : un topic par clash, pénétration en mm, zero fake", () => {
    const wall = element("w1", "IFCWALL", "EG", [0, 0, 0, 4, 0.3, 3]);
    const slab = element("s1", "IFCSLAB", "OG", [1, -0.1, 2.6, 3, 0.4, 2.8]);
    const clashes = ClashDetector.detectClashes([wall, slab]);
    expect(clashes.length).toBe(1);
    const topics = clashesTopics(clashes);
    expect(topics).toHaveLength(1);
    const topic = topics[0];
    expect(topic.title).toContain("HARD");
    expect(topic.title).toContain("⇄");
    expect(topic.title).toContain("mm");
    expect(topic.status).toBe("open");
    expect(topic.author).toContain("BIM-IQ");
    expect(topic.note).toContain("Hotspot");
  });
});
