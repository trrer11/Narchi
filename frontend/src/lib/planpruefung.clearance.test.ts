import { describe, expect, it } from "vitest";
import { ClashDetector } from "./planpruefung";
import type { BuildingElement } from "@/data/types";

function el(id: string, type: string, bbox: number[]): BuildingElement {
  return {
    id,
    projectId: "p",
    name: id,
    type,
    level: "EG",
    material: "",
    status: "modeled",
    conflicts: 0,
    volume: 0,
    area: 0,
    properties: [{ key: "bbox", value: JSON.stringify(bbox) }],
  } as BuildingElement;
}

describe("AABB clearance §272", () => {
  it("aabbGap: getrennt um 4 cm", () => {
    const a = [0, 0, 0, 1, 1, 1];
    const b = [1.04, 0, 0, 2, 1, 1];
    expect(ClashDetector.aabbGap(a, b)).toBeCloseTo(0.04, 6);
  });

  it("aabbGap: Überlappung = 0", () => {
    expect(ClashDetector.aabbGap([0, 0, 0, 1, 1, 1], [0.5, 0, 0, 2, 1, 1])).toBe(0);
  });

  it("Rohr 4 cm neben Wand = clearance, kein hard", () => {
    const wall = el("w", "IfcWall", [0, 0, 0, 1, 0.3, 3]);
    const pipe = el("p", "IfcPipeSegment", [1.04, 0, 1, 1.14, 0.1, 1.1]);
    const hits = ClashDetector.detectClashes([wall, pipe]);
    expect(hits.some((c) => c.type === "hard")).toBe(false);
    const clr = hits.find((c) => c.type === "clearance");
    expect(clr).toBeDefined();
    expect(clr!.gapM).toBeGreaterThan(0.03);
    expect(clr!.gapM!).toBeLessThanOrEqual(0.05);
    expect(clr!.description).toContain("AABB");
  });

  it("zwei Wände 4 cm Abstand = kein clearance (nur TGA×Tragwerk)", () => {
    const a = el("w1", "IfcWall", [0, 0, 0, 1, 0.3, 3]);
    const b = el("w2", "IfcWall", [1.04, 0, 0, 2, 0.3, 3]);
    const hits = ClashDetector.detectClashes([a, b]);
    expect(hits.filter((c) => c.type === "clearance")).toHaveLength(0);
  });
});
