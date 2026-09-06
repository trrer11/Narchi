/** §165 — le pont VE ↔ coût est éprouvé (delta additif honnête). */
import { describe, expect, it } from "vitest";

import { buildVECostImpact } from "@/lib/veCostImpact";
import {
  buildVEOpportunities,
  computeVEWhatIf,
  substitutionKey,
  takeoffVolumeM3BySubstitution,
} from "@/lib/veEngine";

const summary = {
  byCategory: [
    { categoryId: "stahlbeton", massKg: 50_000 },
    { categoryId: "ziegel", massKg: 36_000 },
  ],
} as never;
const opps = buildVEOpportunities(takeoffVolumeM3BySubstitution(summary), 100_000);

describe("buildVECostImpact (§165)", () => {
  it("win-win : le devis BAISSE du Δ€ (économie)", () => {
    const beton = opps.find((o) => o.rec.to.key === "beton_c20_25")!; // Δ€ < 0
    const whatIf = computeVEWhatIf(opps, [substitutionKey(beton.rec)], 100_000, 180);
    expect(whatIf.totalEurDelta).toBeLessThan(0);
    const imp = buildVECostImpact({ whatIf, estimateNet: 1_000_000, budget: 1_200_000 });
    expect(imp.estimateNetAfter).toBeCloseTo(1_000_000 + whatIf.totalEurDelta, 3);
    expect(imp.estimateNetAfter).toBeLessThan(imp.estimateNetBefore!);
    expect(imp.deltaPctOfEstimate).toBeLessThan(0);
    expect(imp.deltaPctOfBudget).toBeLessThan(0);
  });

  it("premium : le devis MONTE du Δ€ (surcoût)", () => {
    const clt = opps.find((o) => o.rec.to.key === "clt")!; // Δ€ > 0
    const whatIf = computeVEWhatIf(opps, [substitutionKey(clt.rec)], 100_000, 180);
    expect(whatIf.totalEurDelta).toBeGreaterThan(0);
    const imp = buildVECostImpact({ whatIf, estimateNet: 1_000_000, budget: 1_200_000 });
    expect(imp.estimateNetAfter).toBeCloseTo(1_000_000 + whatIf.totalEurDelta, 3);
    expect(imp.estimateNetAfter).toBeGreaterThan(imp.estimateNetBefore!);
    expect(imp.deltaPctOfEstimate).toBeGreaterThan(0);
  });

  it("sélection vide → delta nul, devis inchangé", () => {
    const imp = buildVECostImpact({ whatIf: computeVEWhatIf(opps, []), estimateNet: 1_000_000, budget: 1_200_000 });
    expect(imp.deltaEur).toBe(0);
    expect(imp.estimateNetAfter).toBe(1_000_000);
    expect(imp.deltaPctOfEstimate).toBe(0);
  });

  it("sans devis ni budget → champs nuls, jamais de NaN", () => {
    const beton = opps.find((o) => o.rec.to.key === "beton_c20_25")!;
    const whatIf = computeVEWhatIf(opps, [substitutionKey(beton.rec)], 100_000, 180);
    const imp = buildVECostImpact({ whatIf, estimateNet: 0, budget: 0 });
    expect(imp.hasEstimate).toBe(false);
    expect(imp.hasBudget).toBe(false);
    expect(imp.estimateNetAfter).toBeNull();
    expect(imp.deltaPctOfEstimate).toBeNull();
    expect(imp.deltaPctOfBudget).toBeNull();
  });
});
