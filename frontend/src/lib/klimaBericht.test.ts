/** §173 — le Klima-Bericht (PDF) est éprouvé (constructeur PUR). */
import { describe, expect, it } from "vitest";

import { buildKlimaBerichtPdf } from "@/lib/klimaBericht";
import { computeEquivalences, reachedMilestones } from "@/lib/klimaErfolg";

const decode = (doc: ReturnType<typeof buildKlimaBerichtPdf>): string =>
  new TextDecoder("latin1").decode(doc.output("arraybuffer") as ArrayBuffer);

const data = {
  totalKg: 12_000,
  records: 5,
  milestones: reachedMilestones(12_000),
  projects: [
    { name: "EFH Hannover", a1a3Kg: 90_000, verdictLabel: "Silber", overBudget: false, usedPct: 83.3 },
    { name: "MFH Berlin", a1a3Kg: 250_000, verdictLabel: "über Grenzwert", overBudget: true, usedPct: 120 },
  ],
};

describe("klimaBericht (§173)", () => {
  it("couverture + synthèse + équivalences + portfolio + honnêteté", () => {
    const doc = buildKlimaBerichtPdf(data, { compress: false });
    const raw = decode(doc);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
    expect(raw).toContain("(Klima-Bericht");
    expect(raw).toContain("Klima-Erfolg");
    expect(raw).toContain("Portfolio");
    expect(raw).toContain("(Orientierungswert");
    // équivalences (Richtwert) présentes
    const eq = computeEquivalences(12_000);
    expect(raw).toContain("Bäume");
    expect(raw).toContain("Flüge");
    expect(raw).toContain(Math.round(eq.trees).toLocaleString("de-DE"));
  });

  it("milestones atteints listés ; aucun → phrase d'encouragement", () => {
    const withM = buildKlimaBerichtPdf(data, { compress: false });
    expect(decode(withM)).toContain("Meilensteine");

    const noM = buildKlimaBerichtPdf(
      { totalKg: 0, records: 0, milestones: [], projects: [] },
      { compress: false },
    );
    const rawNoM = decode(noM);
    expect(rawNoM).toContain("kein Meilenstein");
    expect(rawNoM).toContain("kein Projekt");
  });

  it("avec branding, le bureau apparaît", () => {
    const PNG_1PX =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const doc = buildKlimaBerichtPdf(
      data,
      { compress: false },
      { officeName: "Atelier Müller", logo: { dataUrl: PNG_1PX, width: 1, height: 1 } },
    );
    expect(decode(doc)).toContain("(Atelier Müller");
  });
});
