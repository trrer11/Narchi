/** §154 — VE-Studio : le moteur de value engineering est éprouvé (charta). */
import { describe, expect, it } from "vitest";

import {
  buildVEPlan,
  buildVEOpportunities,
  carbonVerdict,
  applySubstitution,
  findMaterial,
  takeoffVolumeM3BySubstitution,
  computeVEWhatIf,
  substitutionKey,
  typologyOfProjectType,
  CATEGORY_TO_VE,
  SUBSTITUTION_MATERIALS,
} from "@/lib/veEngine";

describe("catalogue matériaux", () => {
  it("tous les matériaux ont des valeurs CO₂ et € strictement positives", () => {
    for (const m of SUBSTITUTION_MATERIALS) {
      expect(m.co2PerUnit).toBeGreaterThan(0);
      expect(m.pricePerUnit).toBeGreaterThan(0);
    }
  });
  it("findMaterial retrouve chaque clé du catalogue", () => {
    for (const m of SUBSTITUTION_MATERIALS) {
      expect(findMaterial(m.key)?.label).toBe(m.label);
    }
  });
});

describe("buildVEPlan", () => {
  it("ne produit que des recommandations qui ÉCONOMISENT du CO₂ (jamais d'aggravation)", () => {
    const recs = buildVEPlan();
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) {
      expect(r.co2SavedPerUnit).toBeGreaterThan(0);
    }
  });

  it("tri : les « win-win » (moins cher ET plus vert) viennent en premier", () => {
    const recs = buildVEPlan();
    const firstWin = recs.findIndex((r) => r.eurDeltaPerUnit > 0);
    // tous ceux AVANT firstWin sont win-win (eurDelta <= 0)
    for (let i = 0; i < firstWin; i++) {
      expect(recs[i].eurDeltaPerUnit).toBeLessThanOrEqual(0);
    }
  });

  it("calcul exact du coût-efficacité (€/tCO₂e) sur un cas connu", () => {
    // Stahlbeton C25/30 (280, 300 €) → CLT (100, 520 €) :
    // ΔCO₂ = +180 kg/m³, Δ€ = +220 €/m³ → 220/0.18 = 1222.22 €/t
    const recs = buildVEPlan();
    const clt = recs.find((r) => r.to.key === "clt" && r.from.key === "stahlbeton_c25_30");
    expect(clt).toBeTruthy();
    expect(clt!.co2SavedPerUnit).toBeCloseTo(180);
    expect(clt!.eurDeltaPerUnit).toBeCloseTo(220);
    expect(clt!.eurPerTonneCo2).toBeCloseTo(1222.22, 1);
  });

  it("ne mélange JAMAIS les unités (m³ uniquement ici)", () => {
    const recs = buildVEPlan();
    for (const r of recs) {
      expect(r.from.unit).toBe(r.to.unit);
    }
  });
});

describe("applySubstitution", () => {
  it("multiplie les deltas par la quantité réelle", () => {
    const recs = buildVEPlan();
    const clt = recs.find((r) => r.to.key === "clt")!;
    const applied = applySubstitution(clt, 10); // 10 m³
    expect(applied.co2SavedKg).toBeCloseTo(clt.co2SavedPerUnit * 10);
    expect(applied.eurDelta).toBeCloseTo(clt.eurDeltaPerUnit * 10);
  });
});

describe("§155 — pont maquette réelle → VE-Studio", () => {
  // Un takeoff minimal : 50 t de stahlbeton (densité 2400) et 36 t de ziegel
  // (densité 1200). Les autres catégories ne sont pas présentes.
  const summary = {
    byCategory: [
      { categoryId: "stahlbeton", massKg: 50_000 },
      { categoryId: "ziegel", massKg: 36_000 },
      { categoryId: "isolierglas", massKg: 5_000 }, // non substituable
    ],
  } as never;

  it("convertit la masse takeoff en volume m³ via la densité du catalogue", () => {
    const vol = takeoffVolumeM3BySubstitution(summary);
    // 50 000 kg / 2400 kg/m³ = 20,83 m³ de stahlbeton
    expect(vol["stahlbeton_c25_30"]).toBeCloseTo(50000 / 2400, 3);
    // 36 000 kg / 1200 kg/m³ = 30 m³ de ziegel → hochlochziegel
    expect(vol["hochlochziegel"]).toBeCloseTo(36000 / 1200, 3);
    // les catégories non substituables sont ignorées
    expect(vol["isolierglas"]).toBeUndefined();
    expect(vol["eps"]).toBeUndefined();
  });

  it("le pont CATEGORY_TO_VE est déterministe et couvre les matériaux substituables", () => {
    expect(CATEGORY_TO_VE["stahlbeton"]).toBe("stahlbeton_c25_30");
    expect(CATEGORY_TO_VE["schnittholz"]).toBe("kvh");
    // chaque clé du pont existe dans le catalogue VE
    for (const key of Object.values(CATEGORY_TO_VE)) {
      expect(findMaterial(key)).toBeTruthy();
    }
  });

  it("marque inProject = false quand le volume est absent", () => {
    const opps = buildVEOpportunities({}, 100_000);
    for (const o of opps) {
      expect(o.inProject).toBe(false);
      expect(o.availableM3).toBe(0);
      expect(o.co2SavedKgTotal).toBe(0);
      expect(o.eurDeltaTotal).toBe(0);
    }
  });

  it("calcule les deltas TOTAUX sur le volume réel du projet", () => {
    const vol = takeoffVolumeM3BySubstitution(summary);
    const opps = buildVEOpportunities(vol, 100_000);
    // Stahlbeton C25/30 → Beton C20/25 : −102 kg/m³, −40 €/m³ (win-win)
    const beton = opps.find(
      (o) => o.rec.from.key === "stahlbeton_c25_30" && o.rec.to.key === "beton_c20_25",
    );
    expect(beton).toBeTruthy();
    expect(beton!.inProject).toBe(true);
    const expectedM3 = 50000 / 2400;
    expect(beton!.availableM3).toBeCloseTo(expectedM3, 3);
    expect(beton!.co2SavedKgTotal).toBeCloseTo(beton!.rec.co2SavedPerUnit * expectedM3, 3);
    expect(beton!.eurDeltaTotal).toBeCloseTo(beton!.rec.eurDeltaPerUnit * expectedM3, 3);
    expect(beton!.eurDeltaTotal).toBeLessThan(0); // win-win = on ÉCONOMISE
  });

  it("exprime le gain en % du bilan A1–A3 quand il est fourni", () => {
    const vol = takeoffVolumeM3BySubstitution(summary);
    const opps = buildVEOpportunities(vol, 100_000);
    const beton = opps.find(
      (o) => o.rec.from.key === "stahlbeton_c25_30" && o.rec.to.key === "beton_c20_25",
    )!;
    expect(beton.co2SavedPct).toBeCloseTo((beton.co2SavedKgTotal / 100_000) * 100, 3);
    // sans bilan : null
    const oppsNoTotal = buildVEOpportunities(vol);
    const betonNoTotal = oppsNoTotal.find(
      (o) => o.rec.from.key === "stahlbeton_c25_30" && o.rec.to.key === "beton_c20_25",
    )!;
    expect(betonNoTotal.co2SavedPct).toBeNull();
  });

  it("tri : les substitutions APPLICABLES (volume présent) viennent en premier", () => {
    const vol = takeoffVolumeM3BySubstitution(summary);
    const opps = buildVEOpportunities(vol);
    // toutes celles « inProject » précèdent les autres
    const firstNotIn = opps.findIndex((o) => !o.inProject);
    if (firstNotIn !== -1) {
      for (let i = firstNotIn; i < opps.length; i++) {
        expect(opps[i].inProject).toBe(false);
      }
    }
  });
});

describe("§156 — what-if cumulatif", () => {
  const summary = {
    byCategory: [
      { categoryId: "stahlbeton", massKg: 50_000 }, // → 20,83 m³
      { categoryId: "ziegel", massKg: 36_000 }, // → 30 m³
    ],
  } as never;
  const vol = takeoffVolumeM3BySubstitution(summary);
  const opps = buildVEOpportunities(vol, 100_000);

  it("substitutionKey est stable et unique par paire", () => {
    const recs = buildVEPlan();
    const keys = recs.map(substitutionKey);
    expect(new Set(keys).size).toBe(keys.length); // pas de doublon
    const clt = recs.find((r) => r.to.key === "clt")!;
    expect(substitutionKey(clt)).toBe(`${clt.from.key}->clt`);
  });

  it("sélection vide → aucun delta, nouveau total = total d'origine", () => {
    const w = computeVEWhatIf(opps, [], 100_000, 180);
    expect(w.selected.length).toBe(0);
    expect(w.totalCo2SavedKg).toBe(0);
    expect(w.totalEurDelta).toBe(0);
    expect(w.newTotalCo2Kg).toBe(100_000);
    expect(w.co2SavedPct).toBe(0);
  });

  it("additionne les substitutions cochées et recalcule le total", () => {
    const beton = opps.find(
      (o) => o.rec.from.key === "stahlbeton_c25_30" && o.rec.to.key === "beton_c20_25",
    )!;
    const ziegel = opps.find(
      (o) => o.rec.from.key === "hochlochziegel" && o.rec.to.key === "kalksandstein",
    )!;
    const w = computeVEWhatIf(
      opps,
      [substitutionKey(beton.rec), substitutionKey(ziegel.rec)],
      100_000,
      180,
    );
    expect(w.selected.length).toBe(2);
    const expectedCo2 = beton.co2SavedKgTotal + ziegel.co2SavedKgTotal;
    const expectedEur = beton.eurDeltaTotal + ziegel.eurDeltaTotal;
    expect(w.totalCo2SavedKg).toBeCloseTo(expectedCo2, 3);
    expect(w.totalEurDelta).toBeCloseTo(expectedEur, 3);
    expect(w.newTotalCo2Kg).toBeCloseTo(100_000 - expectedCo2, 3);
    expect(w.co2SavedPct).toBeCloseTo((expectedCo2 / 100_000) * 100, 3);
    expect(w.newPerM2Kg).toBeCloseTo((100_000 - expectedCo2) / 180, 3);
  });

  it("les clés inconnues sont ignorées (jamais d'erreur)", () => {
    const w = computeVEWhatIf(opps, ["nimporte->quoi"], 100_000);
    expect(w.selected.length).toBe(0);
    expect(w.totalCo2SavedKg).toBe(0);
  });

  it("sans total ni NGF : champs nuls, mais la somme des deltas reste juste", () => {
    const beton = opps.find((o) => o.rec.to.key === "beton_c20_25")!;
    const w = computeVEWhatIf(opps, [substitutionKey(beton.rec)]);
    expect(w.totalCo2SavedKg).toBeCloseTo(beton.co2SavedKgTotal, 3);
    expect(w.newTotalCo2Kg).toBeNull();
    expect(w.co2SavedPct).toBeNull();
    expect(w.newPerM2Kg).toBeNull();
  });
});

describe("carbonVerdict", () => {
  it("classe correctement vs BNB (Gold/Silber/Bronze/über)", () => {
    expect(carbonVerdict(300, "residential").level).toBe("best");
    expect(carbonVerdict(500, "residential").level).toBe("target");
    expect(carbonVerdict(700, "residential").level).toBe("limit");
    expect(carbonVerdict(900, "residential").level).toBe("over");
  });
  it("retombe sur residential si typologie inconnue", () => {
    const v = carbonVerdict(400, "hospital" as never);
    expect(v.target).toBe(600);
  });
});

describe("typologyOfProjectType (§166)", () => {
  it("déduit la typologie BNB du libellé libre du projet", () => {
    expect(typologyOfProjectType("Wohnen (EFH)")).toBe("residential");
    expect(typologyOfProjectType("Bürogebäude")).toBe("office");
    expect(typologyOfProjectType("Grundschule")).toBe("school");
    expect(typologyOfProjectType("Verwaltung")).toBe("office");
    expect(typologyOfProjectType("Kindergarten")).toBe("school");
  });
  it("libellé absent/inconnu → residential (jamais d'erreur)", () => {
    expect(typologyOfProjectType()).toBe("residential");
    expect(typologyOfProjectType(null)).toBe("residential");
    expect(typologyOfProjectType("Atelier")).toBe("residential");
  });
});
