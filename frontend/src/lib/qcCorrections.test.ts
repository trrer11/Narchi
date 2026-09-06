import { describe, expect, it } from "vitest";
import { buildCorrectionPlan, cheapestCorrectionAxis, clashCorrectionText } from "@/lib/qcCorrections";
import type { Clash } from "@/lib/planpruefung";
import type { AuditIssue } from "@/lib/AuditEngine";

function clash(over: Partial<Clash>): Clash {
  return {
    id: "clash-a-b",
    elementA: "a",
    elementB: "b",
    expressIdA: 1,
    expressIdB: 2,
    center: [0, 0, 0],
    size: [1, 1, 1],
    nameA: "Wand 22",
    nameB: "Decke 160",
    overlap: [0.5, 0.16, 0.042],
    hotspot: { center: [0.1, 0.1, 0.1], size: [0.5, 0.16, 0.042] },
    severity: "major",
    type: "hard",
    description: "Collision détectée entre Wand 22 et Decke 160",
    ...over,
  };
}

describe("qcCorrections — « Suggérer Correction IA » réel", () => {
  it("axe de correction = plus petite pénétration (Z ici : 42 mm)", () => {
    expect(cheapestCorrectionAxis([0.5, 0.16, 0.042])).toBe(2);
    expect(cheapestCorrectionAxis([0.01, 0.5, 0.5])).toBe(0);
  });

  it("suggestion chiffrée : mm + direction + geste (absenken pour Z)", () => {
    const { title, detail } = clashCorrectionText(clash({}));
    expect(title).toContain("Wand 22");
    expect(title).toContain("Decke 160");
    expect(detail).toContain("42 mm");
    expect(detail).toContain("Z-Richtung");
    expect(detail).toContain("absenken/anheben");
  });

  it("pénétration arrondie au mm supérieur, jamais 0", () => {
    const { detail } = clashCorrectionText(clash({ overlap: [0.0004, 0.2, 0.2] }));
    expect(detail).toContain("1 mm");
  });

  it("plan : collisions critiques d'abord, limite + compteurs exacts", () => {
    const clashes = [
      clash({ id: "c1", severity: "minor" }),
      clash({ id: "c2", severity: "critical" }),
      clash({ id: "c3", severity: "major" }),
    ];
    const issues: AuditIssue[] = [
      {
        id: "i1",
        elementId: "el-1",
        ruleId: "DIN-18040-DOOR-WIDTH",
        type: "accessibility",
        description: "Breite Türöffnung : Tür 01",
        measuredValue: "0.78 m",
        requiredValue: "≥ 0.85 m",
        severity: "critical",
        lawReference: "DIN 18040-1",
        suggestion: "Passage libre élargir.",
      },
    ];
    const plan = buildCorrectionPlan(clashes, issues, 2);
    expect(plan.totalClashes).toBe(3);
    expect(plan.totalIssues).toBe(1);
    expect(plan.items).toHaveLength(2);
    expect(plan.moreClashes).toBe(2); // 4 au total − 2 affichés
    expect(plan.items[0].severity).toBe("critical");
    expect(plan.items[0].clash?.id === "c2" || plan.items[0].issue?.id === "i1").toBe(true);
    // repli détail règle sans suggestion
    const noSug = buildCorrectionPlan([], [{ ...issues[0], suggestion: "" }], 6);
    expect(noSug.items[0].detail).toContain("0.78 m");
  });
});
