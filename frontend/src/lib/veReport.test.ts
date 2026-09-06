/** §158 — le rapport PDF VE est éprouvé (charta §70 : constructeur PUR). */
import { describe, expect, it } from "vitest";

import { buildVEPdfReport } from "@/lib/veReport";
import {
  buildVEOpportunities,
  computeVEWhatIf,
  substitutionKey,
  takeoffVolumeM3BySubstitution,
} from "@/lib/veEngine";

// Takeoff démo minimal : stahlbeton + ziegel (voir veEngine.test.ts §155).
const summary = {
  byCategory: [
    { categoryId: "stahlbeton", massKg: 50_000 },
    { categoryId: "ziegel", massKg: 36_000 },
  ],
} as never;
const vol = takeoffVolumeM3BySubstitution(summary);
const opps = buildVEOpportunities(vol, 100_000);

const decode = (doc: ReturnType<typeof buildVEPdfReport>): string =>
  new TextDecoder("latin1").decode(doc.output("arraybuffer") as ArrayBuffer);

describe("veReport — rapport CO2- und Kosten-Optimierung (§158)", () => {
  it("TEST-158-1 : couverture + tableau + pied honnête toujours présents", () => {
    const doc = buildVEPdfReport(
      { projectName: "EFH Hannover", opportunities: opps, whatIf: computeVEWhatIf(opps, []) },
      { compress: false },
    );
    const raw = decode(doc);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2); // couverture + contenu
    expect(raw).toContain("(CO2- und Kosten-Optimierung");
    expect(raw).toContain("(Materialsubstitutionen");
    expect(raw).toContain("(Orientierungswert");
    expect(raw).toContain("(EFH Hannover");
  });

  it("TEST-158-2 : la sélection what-if apparaît (CO2-Einsparung gesamt)", () => {
    const beton = opps.find((o) => o.rec.to.key === "beton_c20_25")!;
    const whatIf = computeVEWhatIf(opps, [substitutionKey(beton.rec)], 100_000, 180);
    const doc = buildVEPdfReport(
      { projectName: "EFH Hannover", ngf: 180, totalCo2Kg: 100_000, opportunities: opps, whatIf },
      { compress: false },
    );
    const raw = decode(doc);
    expect(whatIf.selected.length).toBe(1);
    // La puce « • » précède le texte dans le paragraphe : on cherche la
    // sous-chaîne sans l'ancre « ( » de début de chaîne PDF.
    expect(raw).toContain("CO2-Einsparung gesamt");
    expect(raw).toContain("Kostendifferenz gesamt");
  });

  it("TEST-158-3 : avec branding, le bureau apparaît (en-tête + couverture)", () => {
    const PNG_1PX =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const doc = buildVEPdfReport(
      { projectName: "EFH Hannover", opportunities: opps, whatIf: computeVEWhatIf(opps, []) },
      { compress: false },
      { officeName: "Atelier Müller", logo: { dataUrl: PNG_1PX, width: 1, height: 1 } },
    );
    const raw = decode(doc);
    expect(raw).toContain("(Atelier Müller");
  });

  it("TEST-158-4 : sans sélection, pas de CO2-Einsparung gesamt (rien inventé)", () => {
    const doc = buildVEPdfReport(
      { projectName: "EFH Hannover", opportunities: opps, whatIf: computeVEWhatIf(opps, []) },
      { compress: false },
    );
    const raw = decode(doc);
    expect(raw).not.toContain("(CO2-Einsparung gesamt");
  });

  it("TEST-158-6 : la Kostenwirkung (§165) apparaît quand le devis est fourni", () => {
    const beton = opps.find((o) => o.rec.to.key === "beton_c20_25")!;
    const whatIf = computeVEWhatIf(opps, [substitutionKey(beton.rec)], 100_000, 180);
    const doc = buildVEPdfReport(
      {
        projectName: "EFH Hannover",
        totalCo2Kg: 100_000,
        estimateNet: 1_000_000,
        budget: 1_200_000,
        opportunities: opps,
        whatIf,
      },
      { compress: false },
    );
    const raw = decode(doc);
    expect(raw).toContain("Kostensch");
  });

  it("TEST-158-5 : l'argumentaire client (§159) est intégré au PDF", () => {
    const beton = opps.find((o) => o.rec.to.key === "beton_c20_25")!;
    const whatIf = computeVEWhatIf(opps, [substitutionKey(beton.rec)], 100_000, 180);
    const doc = buildVEPdfReport(
      { projectName: "EFH Hannover", totalCo2Kg: 100_000, opportunities: opps, whatIf },
      { compress: false },
    );
    const raw = decode(doc);
    expect(raw).toContain("(Argumentation für den Bauherrn");
    expect(raw).toContain("Orientierungshinweis");
  });
});
