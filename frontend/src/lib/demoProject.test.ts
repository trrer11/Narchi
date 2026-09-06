/** §152 — « Beispielprojekt » : le helper de démonstration est éprouvé. */
import { describe, expect, it } from "vitest";

import { DEMO_PROJECT_ID, makeDemoElements, makeDemoProject } from "@/lib/demoProject";
import { matchMaterials } from "@/lib/materialMatch";
import { takeoffVolumeM3BySubstitution, buildVEOpportunities } from "@/lib/veEngine";

describe("makeDemoProject", () => {
  it("produit un projet démo complet et cohérent", () => {
    const p = makeDemoProject(new Date("2026-08-17T10:00:00Z"));
    expect(p.id).toBe(DEMO_PROJECT_ID);
    // Étiqueté DÉMO dans le nom (jamais un vrai client).
    expect(p.name).toContain("Beispielprojekt");
    expect(p.code).toBe("DEMO-EFH-01");
    expect(p.status).toBe("design");
    expect(p.budget).toBe(480000);
    expect(p.grossFloorArea).toBe(180);
    expect(p.floors).toBe(2);
    expect(p.carbonBudgetKg).toBe(108000);
    expect(p.startDate).toBe("2026-08-17");
    // Horodatage de synchro présent (§118).
    expect(p.updatedAt).toBe("2026-08-17T10:00:00.000Z");
  });

  it("l'id est déterministe (bouton idempotent)", () => {
    const a = makeDemoProject();
    const b = makeDemoProject();
    expect(a.id).toBe(b.id);
  });
});

describe("§157 — makeDemoElements (le waouh au premier contact)", () => {
  const els = makeDemoElements(new Date("2026-08-17T10:00:00Z"));

  it("produit un takeoff démo non vide, rattaché au projet démo", () => {
    expect(els.length).toBeGreaterThan(10);
    for (const el of els) {
      expect(el.projectId).toBe(DEMO_PROJECT_ID);
      expect(el.weightKg).toBeGreaterThan(0);
      expect(el.status).toBe("modeled");
    }
  });

  it("tous les matériaux sont rapprochés PAR NOM (confiance pleine, pas de Näherung)", () => {
    const match = matchMaterials(els, 180);
    // La couverture doit être ~100 % : chaque élément porte un nom de
    // matériau reconnu (Stahlbeton, Hochlochziegel, Porenbeton, EPS…).
    expect(match.coveragePct).toBeGreaterThan(99);
    expect(match.byCategory.length).toBeGreaterThanOrEqual(6);
    // Les 3 catégories « substituables » doivent être présentes.
    const ids = match.byCategory.map((c) => c.categoryId);
    expect(ids).toContain("stahlbeton");
    expect(ids).toContain("ziegel");
    expect(ids).toContain("porenbeton");
    expect(ids).toContain("eps");
  });

  it("alimente le VE-Studio avec de VRAIS volumes (m³)", () => {
    const match = matchMaterials(els, 180);
    const vol = takeoffVolumeM3BySubstitution(match);
    // Stahlbeton : 22,5 + 19,8 + 0,8 = 43,1 m³ (masse 103 440 kg ÷ 2400)
    expect(vol["stahlbeton_c25_30"]).toBeCloseTo(43.1, 1);
    // Ziegel : 60 m³ (72 000 kg ÷ 1200)
    expect(vol["hochlochziegel"]).toBeCloseTo(60, 1);
    // Porenbeton : 24 m³ (14 400 kg ÷ 600)
    expect(vol["porenbeton"]).toBeCloseTo(24, 1);
    // EPS : 22 m³ (550 kg ÷ 25)
    expect(vol["eps"]).toBeCloseTo(22, 1);
    // Le plan VE génère des opportunités APPLICABLES (volume présent).
    const opps = buildVEOpportunities(vol, match.co2Kg);
    expect(opps.filter((o) => o.inProject).length).toBeGreaterThanOrEqual(4);
  });

  it("les ids d'éléments sont déterministes (aucun doublon)", () => {
    const ids = els.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
