/** §161 — le cockpit carbone est éprouvé (calcul pur, honnête). */
import { describe, expect, it } from "vitest";

import { buildCarbonCockpit, buildCarbonReportData, projectCarbonSummaries, carbonBudgetAlerts } from "@/lib/carbonCockpit";
import { matchMaterials } from "@/lib/materialMatch";
import {
  buildVEOpportunities,
  takeoffVolumeM3BySubstitution,
} from "@/lib/veEngine";
import { makeDemoElements } from "@/lib/demoProject";

describe("buildCarbonCockpit (§161)", () => {
  const els = makeDemoElements(new Date("2026-08-17T10:00:00Z"));
  const match = matchMaterials(els, 180);
  const opps = buildVEOpportunities(takeoffVolumeM3BySubstitution(match), match.co2Kg);

  it("calcule le bilan A1–A3 et le kg/m² du projet", () => {
    const c = buildCarbonCockpit({ match, opportunities: opps });
    expect(c.a1a3Kg).toBeCloseTo(match.co2Kg, 3);
    expect(c.perM2Kg).toBeCloseTo(match.perM2Ngf!, 3);
  });

  it("compare au budget carbone (part consommée + dépassement)", () => {
    const under = buildCarbonCockpit({ match, carbonBudgetKg: match.co2Kg * 2, opportunities: opps });
    expect(under.budgetKg).toBe(match.co2Kg * 2);
    expect(under.budgetUsedPct).toBeCloseTo(50, 3);
    expect(under.overBudget).toBe(false);

    const over = buildCarbonCockpit({ match, carbonBudgetKg: match.co2Kg / 2, opportunities: opps });
    expect(over.overBudget).toBe(true);
    expect(over.budgetUsedPct).toBeCloseTo(200, 3);
  });

  it("budget absent (0 ou null) → champs nuls, jamais de NaN", () => {
    const c = buildCarbonCockpit({ match, carbonBudgetKg: 0, opportunities: opps });
    expect(c.budgetKg).toBeNull();
    expect(c.budgetUsedPct).toBeNull();
    expect(c.overBudget).toBe(false);
  });

  it("compte les substitutions applicables et donne le PLUS GROS gain (pas de somme)", () => {
    const c = buildCarbonCockpit({ match, opportunities: opps });
    expect(c.veOpportunityCount).toBeGreaterThanOrEqual(4);
    expect(c.vePotentialKg).not.toBeNull();
    // Le potentiel = MAX d'une substitution (jamais une somme qui double-compte).
    const maxSingle = Math.max(...opps.filter((o) => o.inProject).map((o) => o.co2SavedKgTotal));
    expect(c.vePotentialKg).toBeCloseTo(maxSingle, 3);
  });

  it("sans opportunités applicables → potentiel null, pas de crash", () => {
    const c = buildCarbonCockpit({ match, opportunities: [] });
    expect(c.veOpportunityCount).toBe(0);
    expect(c.vePotentialKg).toBeNull();
  });

  it("verdict BNB déduit de la typologie (Gold/Silber/Bronze/über)", () => {
    // La démo EFH (résidentiel) : A1–A3 kg/m² vs seuils 600/800/350.
    const c = buildCarbonCockpit({ match, opportunities: opps, projectType: "Wohnen (EFH)" });
    expect(c.verdict).not.toBeNull();
    expect(c.verdict!.level).toBe(match.perM2Ngf! <= 350 ? "best" : match.perM2Ngf! <= 600 ? "target" : match.perM2Ngf! <= 800 ? "limit" : "over");
    // Bureau → seuils plus stricts (500/700/300).
    const cOffice = buildCarbonCockpit({ match, opportunities: opps, projectType: "Bürogebäude" });
    expect(cOffice.verdict!.target).toBe(500);
  });
});

describe("projectCarbonSummaries (§162 — portefeuille)", () => {
  const els = makeDemoElements(new Date("2026-08-17T10:00:00Z"));

  it("calcule l'A1–A3 et le statut budget par projet", () => {
    const match = matchMaterials(els, 180);
    const a1a3 = match.co2Kg;
    const s = projectCarbonSummaries(
      [{ id: "prj-demo-efh", grossFloorArea: 180, carbonBudgetKg: a1a3 * 2 }],
      els,
    );
    expect(s["prj-demo-efh"]).toBeTruthy();
    expect(s["prj-demo-efh"].a1a3Kg).toBeCloseTo(a1a3, 3);
    expect(s["prj-demo-efh"].overBudget).toBe(false);
    expect(s["prj-demo-efh"].usedPct).toBeCloseTo(50, 3);
  });

  it("détecte un dépassement de budget carbone", () => {
    const match = matchMaterials(els, 180);
    const s = projectCarbonSummaries(
      [{ id: "prj-demo-efh", carbonBudgetKg: match.co2Kg / 2 }],
      els,
    );
    expect(s["prj-demo-efh"].overBudget).toBe(true);
  });

  it("projet sans éléments → absent de la carte (jamais de faux 0)", () => {
    const s = projectCarbonSummaries(
      [
        { id: "prj-demo-efh" },
        { id: "prj-vide", grossFloorArea: 100, carbonBudgetKg: 60000 },
      ],
      els, // els sont rattachés à prj-demo-efh uniquement
    );
    expect(s["prj-demo-efh"]).toBeTruthy();
    expect(s["prj-vide"]).toBeUndefined();
  });

  it("budget absent (0) → usedPct null, overBudget false", () => {
    const s = projectCarbonSummaries([{ id: "prj-demo-efh", carbonBudgetKg: 0 }], els);
    expect(s["prj-demo-efh"].usedPct).toBeNull();
    expect(s["prj-demo-efh"].overBudget).toBe(false);
  });
});

describe("buildCarbonReportData (§168 — rapport unifié)", () => {
  const els = makeDemoElements(new Date("2026-08-17T10:00:00Z"));
  const match = matchMaterials(els, 180);
  const opps = buildVEOpportunities(takeoffVolumeM3BySubstitution(match), match.co2Kg);

  it("rend le bilan + verdict + budget + top VE", () => {
    const d = buildCarbonReportData({
      match,
      carbonBudgetKg: match.co2Kg * 2,
      projectType: "Wohnen (EFH)",
      opportunities: opps,
    });
    expect(d.a1a3Kg).toBeCloseTo(match.co2Kg, 3);
    expect(d.perM2Kg).toBeCloseTo(match.perM2Ngf!, 3);
    expect(["Gold", "Silber", "Bronze", "über Grenzwert"]).toContain(d.verdictLabel);
    expect(d.budgetKg).toBe(match.co2Kg * 2);
    expect(d.overBudget).toBe(false);
    // Top VE = applicable, win-win en tête (tri hérité du moteur).
    expect(d.veTop.length).toBeGreaterThanOrEqual(1);
    expect(d.veTop[0].winWin).toBe(true);
  });
});

describe("carbonBudgetAlerts (§169 — notification passive)", () => {
  const els = makeDemoElements(new Date("2026-08-17T10:00:00Z"));
  const match = matchMaterials(els, 180);

  it("remonte les projets AU-DESSUS du budget, avec le dépassement exact", () => {
    const alerts = carbonBudgetAlerts(
      [
        { id: "prj-demo-efh", name: "EFH", grossFloorArea: 180, carbonBudgetKg: match.co2Kg / 2 },
        { id: "prj-ok", name: "OK", grossFloorArea: 180, carbonBudgetKg: match.co2Kg * 2 },
      ],
      els.filter((e) => e.projectId === "prj-demo-efh"),
    );
    expect(alerts.length).toBe(1);
    expect(alerts[0].projectName).toBe("EFH");
    expect(alerts[0].excessKg).toBeCloseTo(match.co2Kg - match.co2Kg / 2, 3);
  });

  it("aucune alerte quand tout est sous budget ou sans éléments", () => {
    expect(carbonBudgetAlerts([{ id: "x", name: "X", carbonBudgetKg: 100000 }], els)).toEqual([]);
  });
});
