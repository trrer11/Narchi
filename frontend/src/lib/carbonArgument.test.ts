/** §159 — l'argumentaire client bas-carbone est éprouvé (déterministe). */
import { describe, expect, it } from "vitest";

import { buildCarbonArgument } from "@/lib/carbonArgument";
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
const vol = takeoffVolumeM3BySubstitution(summary);
const opps = buildVEOpportunities(vol, 100_000);

describe("buildCarbonArgument (§159)", () => {
  it("sans sélection : argumentaire NEUTRE qui invite à choisir (jamais de vide)", () => {
    const a = buildCarbonArgument({
      projectName: "EFH Hannover",
      whatIf: computeVEWhatIf(opps, []),
    });
    expect(a.bullets.length).toBeGreaterThanOrEqual(2);
    expect(a.intro).toContain("EFH Hannover");
    expect(a.closing).toContain("Orientierungshinweis");
    // Aucun chiffre inventé sans sélection.
    expect(a.bullets.every((b) => !b.includes("sparen wir"))).toBe(true);
  });

  it("win-win : annonce CO₂ ET économies (moins cher)", () => {
    const beton = opps.find((o) => o.rec.to.key === "beton_c20_25")!; // −40 €/m³
    const whatIf = computeVEWhatIf(opps, [substitutionKey(beton.rec)], 100_000, 180);
    const a = buildCarbonArgument({ projectName: "EFH", whatIf, totalCo2Kg: 100_000, perM2Before: 500 });
    expect(a.headline).toContain("weniger Kosten");
    expect(a.bullets.some((b) => b.includes("Win-Win"))).toBe(true);
    expect(a.bullets[0]).toContain("sparen wir");
    expect(a.bullets[0]).toContain("% der Herstellungsemissionen");
  });

  it("premium : cite le €/t CO₂e et compare au prix du CO₂", () => {
    const clt = opps.find((o) => o.rec.to.key === "clt")!; // +220 €/m³
    const whatIf = computeVEWhatIf(opps, [substitutionKey(clt.rec)], 100_000, 180);
    const a = buildCarbonArgument({ projectName: "EFH", whatIf, totalCo2Kg: 100_000 });
    expect(a.headline).toContain("Investition");
    expect(a.bullets.some((b) => b.includes("€/t CO2e"))).toBe(true);
    expect(a.bullets.some((b) => b.includes("Mehrkosten"))).toBe(true);
  });

  it("mentionne le kg/m² avant → après quand la NGF est fournie", () => {
    const beton = opps.find((o) => o.rec.to.key === "beton_c20_25")!;
    const whatIf = computeVEWhatIf(opps, [substitutionKey(beton.rec)], 100_000, 180);
    const a = buildCarbonArgument({ projectName: "EFH", whatIf, perM2Before: 500 });
    expect(a.intro).toContain("kg/m² NGF");
  });
});
