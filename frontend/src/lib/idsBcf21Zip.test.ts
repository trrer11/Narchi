import { describe, expect, it } from "vitest";
import { bboxCenter, buildIdsBcf21Zip, idsFailuresToTopics } from "./idsBcf21Zip";
import { parseBcf21Zip } from "./bcfImport";
import type { BuildingElement } from "@/data/types";
import type { IdsReport } from "./idsEngine";

function el(partial: Partial<BuildingElement> & { id: string }): BuildingElement {
  return {
    guid: "short",
    code: "330",
    classificationLabel: "T",
    name: partial.name ?? partial.id,
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
    ...partial,
  };
}

function report(failing: IdsReport["requirements"][0]["failing"]): IdsReport {
  return {
    measurableElements: 1,
    totalElements: 1,
    overallPassRate: 0,
    overallLabel: "x",
    requirements: [
      {
        id: "NQI-06",
        title: "U-Wert",
        category: "TRAG",
        basis: "GEG 2024",
        suggestion: "Daemmung",
        checked: 1,
        passed: 0,
        failed: failing.length,
        na: 0,
        passRate: 0,
        failing,
      },
    ],
  };
}

describe("§263 IDS → BCF 2.1", () => {
  it("kein Fail → Fehler ehrlich, n.a. nicht exportiert", async () => {
    const empty = report([]);
    expect(idsFailuresToTopics(empty, [])).toEqual([]);
    await expect(buildIdsBcf21Zip(empty, [])).rejects.toThrow(/Keine IDS-Fehler/);
  });

  it("IfcGuid nur 22 Zeichen, Hotspot aus BBox, Express-ID im Text", async () => {
    const wall = el({
      id: "w1",
      name: "AW-EG-01",
      guid: "0u4M6q6iv4lxtm2l99j4X_",
      properties: [
        { key: "bbox", value: JSON.stringify([0, 0, 0, 2, 2, 4]) },
        { key: "Express ID", value: "77" },
      ],
    });
    const topics = idsFailuresToTopics(
      report([{ elementId: "w1", expressId: 77, name: "AW-EG-01", level: "EG", detail: "U = 0.40" }]),
      [wall],
    );
    expect(topics).toHaveLength(1);
    expect(topics[0].ifcGuids).toEqual(["0u4M6q6iv4lxtm2l99j4X_"]);
    expect(topics[0].hotspot).toEqual([1, 1, 2]);
    expect(topics[0].description).toContain("Express-ID #77");
    expect(topics[0].description).toContain("IDS-Abnahme");
    expect(topics[0].description).not.toContain("AABB-Radar");
  });

  it("kurzer GUID wird nicht als IfcGuid geschrieben", () => {
    const wall = el({ id: "w1", guid: "el-1" });
    const [t] = idsFailuresToTopics(
      report([{ elementId: "w1", expressId: null, name: "x", level: "EG", detail: "fail" }]),
      [wall],
    );
    expect(t.ifcGuids).toEqual([]);
    expect(t.description).toMatch(/Kein gültiger IfcGuid/);
  });

  it("ZIP round-trip: Title + Hotspot + IfcGuid", async () => {
    const wall = el({
      id: "w1",
      name: "AW-EG-01",
      guid: "0u4M6q6iv4lxtm2l99j4X_",
      properties: [
        { key: "bbox", value: JSON.stringify([0, 0, 0, 2, 2, 4]) },
        { key: "Express ID", value: "77" },
      ],
    });
    const bytes = await buildIdsBcf21Zip(
      report([{ elementId: "w1", expressId: 77, name: "AW-EG-01", level: "EG", detail: "U = 0.40" }]),
      [wall],
      { created: "2026-08-26T10:00:00.000Z" },
    );
    expect(bytes[0]).toBe(0x50);
    const imported = await parseBcf21Zip(bytes);
    expect(imported[0].title).toContain("NQI-06");
    expect(imported[0].ifcGuids).toContain("0u4M6q6iv4lxtm2l99j4X_");
    expect(imported[0].hotspot).toEqual([1, 1, 2]);
    expect(imported[0].expressIds).toEqual([77]);
  });

  it("bboxCenter ablehnt Muell", () => {
    expect(bboxCenter(el({ id: "a", properties: [{ key: "bbox", value: "nein" }] }))).toBeNull();
  });
});
