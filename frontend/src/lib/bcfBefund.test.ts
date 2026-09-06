import { describe, expect, it } from "vitest";
import { befundTopics, generateBcf } from "@/lib/bcfExport";
import { classOfElements, groupClashes, withGroupLevels } from "@/lib/clashGroups";
import type { BuildingElement } from "@/data/types";
import type { Clash } from "@/lib/planpruefung";

function element(id: string, type: string, level = "EG"): BuildingElement {
  return {
    id, guid: `g-${id}`, code: "320", classificationLabel: "T", name: id, type,
    materialId: "m", level, projectId: "p", status: "modeled", qty: 1, unit: "m",
    weightKg: 1, cost: 1, carbonKg: 1, properties: [], lastUpdated: "2026-08-06T00:00:00.000Z", conflicts: 0,
  };
}

function clash(id: string, elA: string, elB: string, severity: Clash["severity"], at: [number, number, number], exA: number | null = null, exB: number | null = null): Clash {
  return {
    id, elementA: elA, elementB: elB, expressIdA: exA, expressIdB: exB,
    center: at, size: [1, 1, 1], nameA: `A-${id}`, nameB: `B-${id}`, overlap: [0.2, 0.2, 0.2],
    hotspot: { center: at, size: [0.2, 0.2, 0.2] }, severity, type: "hard", description: `${elA} ⇄ ${elB}`,
  };
}

const groups = () => {
  const m = new Map([["s1", "IFCCOLUMN"], ["d1", "IFCSLAB"], ["w1", "IFCWALL"]].map(([id, t]) => [id, element(id, t, id === "w1" ? "1. OG" : "EG")]));
  const classOf = classOfElements((id) => m.get(id));
  const cs = [
    clash("c1", "s1", "d1", "critical", [0, 0, 3], 101, 202),
    clash("c2", "s1", "d1", "critical", [2, 0, 3]),
    clash("c3", "w1", "d1", "major", [40, 0, 3]),
  ];
  return withGroupLevels(groupClashes(cs, classOf), (id) => m.get(id));
};

describe("befundTopics — BCF par constat (un ticket par PROBLÈME)", () => {
  it("un topic par groupe, PAS par paire (2 groupes ← 3 paires)", () => {
    const topics = befundTopics(groups());
    expect(topics).toHaveLength(2);
    // BG-01 = le groupe critical (tri bureau : le pire d'abord).
    expect(topics[0].title).toContain("BG-01");
    expect(topics[0].title).toContain("2 Stellen");
    expect(topics[0].title).toContain("Kritisch");
    expect(topics[0].status).toBe("open");
  });

  it("contenu auditable : niveaux, Ø profondeur, porte-parole, Express IDs, Trefferliste", () => {
    const [first] = befundTopics(groups());
    expect(first.note).toContain("Ebenen: EG");
    expect(first.note).toContain("Ø Eindringtiefe 200 × 200 × 200 mm");
    expect(first.note).toContain("Stellvertreter: A-c1 ⇄ B-c1");
    expect(first.note).toContain("Hotspot centre [0.00, 0.00, 3.00] m");
    expect(first.note).toContain("Express IDs: #101 / #202");
    expect(first.note).toContain("A-c1 ⇄ B-c1 · A-c2 ⇄ B-c2");
  });

  it("passe par generateBcf → XML BCF 3.0 avec un Topic par constat", () => {
    const xml = generateBcf(befundTopics(groups()));
    expect((xml.match(/<Topic>/g) ?? []).length).toBe(2);
    expect(xml).toContain("BG-01");
    expect(xml).toContain("<TopicStatus>Open</TopicStatus>");
  });
});
