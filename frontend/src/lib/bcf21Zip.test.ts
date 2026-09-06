import { describe, expect, it } from "vitest";
import {
  bcfVersionXml,
  buildTopicFiles,
  cameraFromHotspot,
  isIfcGuid22,
  newBcfGuid,
} from "./bcf21Zip";
import type { ClashGroup } from "./clashGroups";
import type { Clash } from "./planpruefung";
import type { BuildingElement } from "@/data/types";

function clash(): Clash {
  return {
    id: "clash-a-b",
    elementA: "el-1",
    elementB: "el-2",
    expressIdA: 10,
    expressIdB: 20,
    center: [0, 0, 0],
    size: [1, 1, 1],
    nameA: "Wand A",
    nameB: "Decke B",
    overlap: [0.1, 0.2, 0.05],
    hotspot: { center: [1, 2, 3], size: [0.1, 0.1, 0.1] },
    severity: "major",
    type: "hard",
    description: "AABB",
  };
}

function group(): ClashGroup {
  const c = clash();
  return {
    id: "BG-01",
    title: "Wand × Decke/Gründung",
    classes: ["WAND", "DECKE"],
    severity: "major",
    count: 1,
    clashes: [c],
    collisionIds: [c.id],
    levels: ["EG"],
    centroid: [1, 2, 3],
    typicalOverlap: [0.1, 0.2, 0.05],
    representative: c,
  };
}

describe("bcf21Zip §258", () => {
  it("GUID ist UUID-förmig", () => {
    expect(newBcfGuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("IfcGuid nur 22 Zeichen IFC, kein Express-ID als GUID", () => {
    expect(isIfcGuid22("0u4M6q6iv4lxtm2l99j4X_")).toBe(true);
    expect(isIfcGuid22("el-1")).toBe(false);
    expect(isIfcGuid22("10")).toBe(false);
  });

  it("Kamera blickt auf Hotspot, Up = Z", () => {
    const cam = cameraFromHotspot([0, 0, 0]);
    expect(cam.up).toEqual([0, 0, 1]);
    const len = Math.hypot(...cam.dir);
    expect(len).toBeGreaterThan(0.99);
    expect(len).toBeLessThan(1.01);
  });

  it("Version 2.1, kein Fake-3.0-Wurzelknoten", () => {
    const v = bcfVersionXml();
    expect(v).toContain('VersionId="2.1"');
    expect(v).not.toContain("<BCF version");
  });

  it("Markup + Viewpoint: Topic Guid, AABB-Hinweis, keine erfundene IfcGuid", () => {
    const files = buildTopicFiles(group(), new Map(), "2026-08-25T12:00:00.000Z", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "ffffffff-1111-4222-8333-444444444444");
    expect(files.markup).toContain('Topic Guid="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"');
    expect(files.markup).toContain("AABB-Radar");
    expect(files.markup).toContain("Express-ID #10");
    expect(files.markup).toContain("Hotspot [1.000, 2.000, 3.000] m");
    expect(files.markup).not.toContain('IfcGuid="el-1"');
    expect(files.viewpoint).toContain("PerspectiveCamera");
    expect(files.viewpoint).toContain("CameraViewPoint");
    expect(files.viewpoint).not.toContain("<Component");
  });

  it("IfcGuid 22 Zeichen landet in Selection", () => {
    const el: BuildingElement = {
      id: "el-1",
      guid: "0u4M6q6iv4lxtm2l99j4X_",
      code: "",
      classificationLabel: "",
      name: "Wand A",
      type: "IfcWall",
      materialId: "",
      level: "EG",
      projectId: "p",
      status: "modeled",
      qty: 1,
      unit: "m",
      weightKg: 0,
      cost: 0,
      carbonKg: 0,
      properties: [],
      lastUpdated: "",
      conflicts: 0,
    };
    const files = buildTopicFiles(
      group(),
      new Map([["el-1", el]]),
      "2026-08-25T12:00:00.000Z",
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      "ffffffff-1111-4222-8333-444444444444",
    );
    expect(files.viewpoint).toContain('IfcGuid="0u4M6q6iv4lxtm2l99j4X_"');
  });
});
