import { describe, expect, it, beforeEach } from "vitest";
import { listClashes, qcSummary, runBauteilQC, SEED_CLASHES } from "@/lib/clashRadar";

describe("Clash-Radar §241", () => {
  beforeEach(() => localStorage.clear());

  it("startet leer, ohne Hélios-Luftkanal", () => {
    expect(listClashes()).toEqual([]);
  });

  it("wirft gespeicherte Seed-IDs weg", () => {
    localStorage.setItem("narchi:clashes", JSON.stringify(SEED_CLASHES));
    expect(listClashes().some((c) => c.id === "cl-1")).toBe(false);
  });

  it("QC rät keine 8 % Türen", () => {
    const rules = runBauteilQC([
      { type: "IfcDoor", status: "modeled", conflicts: 0, properties: [] },
      { type: "IfcWindow", status: "modeled", conflicts: 0, properties: [] },
    ]);
    const swing = rules.find((r) => r.id === "qc-swing")!;
    const fall = rules.find((r) => r.id === "qc-fall")!;
    expect(swing.affected).toBe(0);
    expect(swing.measurable).toBe(false);
    expect(swing.passed).toBe(false);
    expect(fall.affected).toBe(0);
    expect(swing.rule).toContain("nicht");
    const summary = qcSummary(rules);
    expect(summary.score).not.toBe(100);
    expect(Number.isFinite(summary.score)).toBe(true);
  });

  it("leeres Modell: Score 0, kein erfundenes 100 %", () => {
    expect(qcSummary([]).score).toBe(0);
    expect(qcSummary(runBauteilQC([])).score).toBe(0);
  });
});
