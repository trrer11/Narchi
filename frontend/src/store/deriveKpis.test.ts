/** §174 — le KPI CO₂ est COHÉRENT (même A1–A3 que cockpit/liste). */
import { describe, expect, it } from "vitest";

import { deriveKpis } from "@/store/LegacyDerivedSlice";
import { matchMaterials } from "@/lib/materialMatch";
import { makeDemoElements } from "@/lib/demoProject";
import type { BuildingElement } from "@/data/types";

describe("deriveKpis — CO₂ cohérent (§174)", () => {
  const els = makeDemoElements(new Date("2026-08-17T10:00:00Z"));
  const match = matchMaterials(els);

  it("totalCarbonKg == matchMaterials A1–A3 (une seule source)", () => {
    const kpis = deriveKpis([], els, [], []);
    expect(kpis.totalCarbonKg).toBeCloseTo(match.co2Kg, 3);
  });

  it("élément non rapproché → pas compté (jamais de chiffre fantôme)", () => {
    const ghost: BuildingElement = {
      id: "ghost", guid: "g", code: "330", classificationLabel: "X",
      name: "Zzqq1", type: "IFCZONE", materialId: "m",
      level: "EG", projectId: "p", status: "modeled", qty: 1, unit: "m³",
      weightKg: 1000, cost: 1, carbonKg: 999999, // carbonKg brute élevé → ignoré
      properties: [], lastUpdated: "2026-08-17T00:00:00.000Z", conflicts: 0,
    };
    const kpis = deriveKpis([], [ghost], [], []);
    expect(kpis.totalCarbonKg).toBe(0); // non rapproché → 0, pas le carbonKg brut
  });
});
