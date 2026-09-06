import { describe, expect, it } from "vitest";
import { generateFeeProposal, utilizationStats } from "./practiceMgmt";

describe("§230 PracticeMgmt ohne Theater", () => {
  it("0 Stunden → keine kritische 0 %-Auslastung", () => {
    const s = utilizationStats("niemand", 30);
    expect(s.totalHours).toBe(0);
    expect(s.healthStatus).toBe("healthy");
    expect(s.message).toMatch(/keine Stunden/i);
  });

  it("0 NGF → 0 Honorar, kein /0", () => {
    const p = generateFeeProposal({
      projectName: "",
      projectType: "neubau",
      buildingType: "",
      ngf: 0,
      costPerM2: 0,
      honorarzone: 3,
      phases: [3],
      hourlyRate: 0,
      deadline: "",
    });
    expect(p.anrechenbareKosten).toBe(0);
    expect(p.honorarTotal).toBe(0);
    expect(Number.isFinite(p.hourlyBudget)).toBe(true);
  });
});
