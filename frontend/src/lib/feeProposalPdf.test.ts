import { describe, expect, it } from "vitest";
import { generateFeeProposal } from "./practiceMgmt";

describe("Honorarvorschlag §253", () => {
  it("Stundensatz 0 ergibt 0 Stunden, nicht Infinity", () => {
    const r = generateFeeProposal({
      projectName: "T",
      projectType: "neubau",
      buildingType: "",
      ngf: 100,
      costPerM2: 2000,
      honorarzone: 3,
      phases: [3],
      hourlyRate: 0,
      deadline: "",
    });
    expect(Number.isFinite(r.hourlyBudget)).toBe(true);
    expect(r.hourlyBudget).toBe(0);
    expect(r.anrechenbareKosten).toBe(200_000);
    expect(r.honorarTotal).toBeGreaterThan(0);
  });
});
