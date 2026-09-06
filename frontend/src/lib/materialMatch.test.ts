import { describe, expect, it } from "vitest";
import {
  MATERIAL_CATALOG,
  categoryOf,
  matchCategory,
  matchMaterials,
  massKgOf,
  materialMatchCsv,
} from "@/lib/materialMatch";
import type { BuildingElement } from "@/data/types";

function element(id: string, name: string, type: string, weightKg: number, level = "EG", qty = 1, unit = "m³"): BuildingElement {
  return {
    id,
    guid: `g-${id}`,
    code: "330",
    classificationLabel: "Test",
    name,
    type,
    materialId: "m",
    level,
    projectId: "p",
    status: "modeled",
    qty,
    unit,
    weightKg,
    cost: 1,
    carbonKg: 1,
    properties: [],
    lastUpdated: "2026-08-06T00:00:00.000Z",
    conflicts: 0,
  };
}

describe("matchCategory — règles publiques nom → ÖKOBAUDAT", () => {
  it("noms réels du marché allemand (confiance 0,90, basis materialname)", () => {
    const cases: [string, string][] = [
      ["Stahlbeton C30/37", "stahlbeton"],
      ["Außenwand / Wand (Beton m. Schalung+Bewehrung)", "stahlbeton"],
      ["Kalksandstein 12 DF", "kalksandstein"],
      ["Ytong PPW 4-0,55", "porenbeton"],
      ["Porenbeton (Gasbeton) Wand", "porenbeton"], // §157 : le mot « beton » ne doit PAS l'aspirer
      ["Poroton T9", "ziegel"],
      ["EPS WLG 035 Perimeterdämmung", "eps"],
      ["XPS 300 Kellerwand", "xps"],
      ["Brettsperrholz CLT 100", "clt"],
      ["BSH GL24h", "bsh"],
      ["Isolierverglasung 3-fach", "isolierglas"],
      ["Zementestrich CT-C20", "estrich"],
      ["TGA Anschlusselement", "tga_misch"],
    ];
    for (const [name, catId] of cases) {
      const m = matchCategory(name, "IFCWALL");
      expect(m?.category.id, `${name} → ${catId}`).toBe(catId);
      expect(m?.confidence).toBe(0.9);
      expect(m?.basis).toBe("materialname");
    }
  });

  it("priorité : « Brettsperrholz » n'est PAS avalé par « Holz » générique", () => {
    expect(matchCategory("Brettsperrholz (CLT)", "IFCWALL")?.category.id).toBe("clt");
    expect(matchCategory("Bewehrungsstahl B500B", "IFCBEAM")?.category.id).toBe("bewehrungsstahl");
  });

  it("secours par classe IFC (confiance 0,55, basis ifc-klasse)", () => {
    const cases: [string, string][] = [
      ["IFCSLAB", "stahlbeton"],
      ["IFCBEAM", "baustahl"],
      ["IFCWINDOW", "isolierglas"],
      ["IFCDOOR", "schnittholz"],
      ["IFCROOF", "mineralwolle"],
      ["IFCFLOWSEGMENT", "tga_misch"],
    ];
    for (const [type, catId] of cases) {
      const m = matchCategory("x-4711", type);
      expect(m?.category.id, `${type} → ${catId}`).toBe(catId);
      expect(m?.confidence).toBe(0.55);
      expect(m?.basis).toBe("ifc-klasse");
    }
  });

  it("rien de plausible → hônnêtement non rapproché (null), jamais de devinette", () => {
    expect(matchCategory(undefined, undefined)).toBeNull();
    expect(matchCategory("Bauteil 998877", "IFCBUILDINGELEMENTPROXY")?.category.id).toBe("sonstiges");
    expect(matchCategory("x", "IFCUNKNOWNCLASS")).toBeNull();
  });
});

describe("massKgOf + bilan matchMaterials", () => {
  it("weightKg du takeoff prioritaire ; sinon qty × densité pour m³ ; sinon 0", () => {
    expect(massKgOf({ qty: 10, unit: "m³", weightKg: 1234, code: "330" }, 2400)).toBe(1234);
    expect(massKgOf({ qty: 10, unit: "m³", weightKg: 0, code: "330" }, 2400)).toBe(24000);
    expect(massKgOf({ qty: 5, unit: "Stk", weightKg: 0, code: "410" }, 2400)).toBe(0);
  });

  it("bilan honnête : sommes, couverture, bande min–max, per-m²", () => {
    const els = [
      element("e1", "Stahlbeton C30/37", "IFCSLAB", 24000, "EG"),   // 24000 × 0,101 = 2424
      element("e2", "EPS WLG 035", "IFCCOVERING", 100, "EG"),       // 100 × 3,3 = 330
      element("e3", "xx-??", "IFCUNKNOWNCLASS", 5000, "1. OG"),     // non rapproché → couverture
    ];
    const s = matchMaterials(els, 250);
    expect(s.considered).toBe(3);
    expect(s.totalMassKg).toBe(29100);
    expect(s.matchedMassKg).toBe(24100);
    // 2424 + 330 = 2754 kg CO₂e
    expect(s.co2Kg).toBeCloseTo(2754, 0);
    expect(s.coveragePct).toBeCloseTo((24100 / 29100) * 100, 1);
    expect(s.perM2Ngf).toBeCloseTo(2754 / 250, 1);
    expect(s.lowKg).toBeLessThan(s.co2Kg);
    expect(s.highKg).toBeGreaterThan(s.co2Kg);
    expect(s.unmatched).toHaveLength(1);
    expect(s.unmatched[0].elementId).toBe("e3");
  });

  it("masse nulle (espace/ligne vide) : exclue des DEUX côtés de la couverture", () => {
    const els = [
      element("e1", "Stahlbeton", "IFCSLAB", 24000),
      element("sp", "Espace (Volume Virtuel)", "IFCSPACE", 0),
    ];
    const s = matchMaterials(els);
    expect(s.considered).toBe(1);
    expect(s.coveragePct).toBeCloseTo(100, 1);
    expect(s.perM2Ngf).toBeNull(); // pas de NGF → pas de ratio (pas de faux 0)
  });

  it("agrégats : catégories triées CO₂ décroissant, étages triés cave → Dach", () => {
    const els = [
      element("e1", "Baustahl S235", "IFCBEAM", 100, "1. OG"),   // 113
      element("e2", "Stahlbeton C30/37", "IFCSLAB", 10000, "EG"), // 1010
      element("e3", "EPS WLG 035", "IFCCOVERING", 100, "1. UG"),  // 330
      element("e4", "Mineralwolle", "IFCROOF", 100, "Dach"),      // 108
    ];
    const s = matchMaterials(els);
    expect(s.byCategory.map((c) => c.categoryId)).toEqual(["stahlbeton", "eps", "baustahl", "mineralwolle"]);
    expect(s.byCategory[0].share).toBeCloseTo(1010 / s.co2Kg, 3);
    expect(s.byCategory[0].basis).toBe("materialname");
    expect(s.byCategory[0].confidenceAvg).toBeCloseTo(0.9, 2);
    expect(s.byLevel.map((l) => l.label)).toEqual(["1. UG", "EG", "1. OG", "Dach"]);
  });

  it("catégorie mixte (nom + classe) → confiance moyenne réelle", () => {
    const els = [
      element("e1", "Stahlbeton C30/37", "IFCWALL", 500),   // nom 0,9
      element("e2", "Wand x-5", "IFCWALL", 500),            // classe 0,55 — MÊME catégorie stahlbeton
    ];
    const s = matchMaterials(els);
    expect(s.byCategory).toHaveLength(1);
    expect(s.byCategory[0].confidenceAvg).toBeCloseTo((0.9 + 0.55) / 2, 5);
  });

  it("catalogue : ≥ 15 catégories, chaque facteur DANS sa bande min–max", () => {
    expect(MATERIAL_CATALOG.length).toBeGreaterThanOrEqual(15);
    for (const c of MATERIAL_CATALOG) {
      expect(c.factorKgCo2PerKg).toBeGreaterThanOrEqual(c.range[0]);
      expect(c.factorKgCo2PerKg).toBeLessThanOrEqual(c.range[1]);
      expect(c.densityKgM3).toBeGreaterThan(0);
    }
    expect(categoryOf("stahlbeton")?.factorKgCo2PerKg).toBeCloseTo(0.101, 3);
  });

  it("aucun caractère de texte corrompu (contrat anti-CJK du §36)", () => {
    const s = matchMaterials([element("e1", "Stahlbeton", "IFCWALL", 100)]);
    const all = JSON.stringify(MATERIAL_CATALOG) + JSON.stringify(s) + materialMatchCsv(s);
    // eslint-disable-next-line no-control-regex
    expect(/[\u4e00-\u9fff\uff00-\uffef]/.test(all)).toBe(false);
  });

  it("CSV allemand : en-têtes avec unités, séparateur point-virgule, somme", () => {
    const s = matchMaterials([element("e1", "Stahlbeton C30/37", "IFCSLAB", 24000)]);
    const csv = materialMatchCsv(s);
    expect(csv).toContain("GWP A1-A3 [kg CO2e]");
    expect(csv).toContain("Stahlbeton (≈C30/37, 3 % Armierung);1;24.000");
    expect(csv).toContain("Abdeckung 100 %");
    expect(csv.split("\r\n").length).toBeGreaterThanOrEqual(4);
  });
});
