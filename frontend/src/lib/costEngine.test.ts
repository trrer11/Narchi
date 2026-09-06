import { describe, expect, it, vi } from "vitest";
import { estimateCost, DIN276_GROUP_LABELS, type CostInput } from "./costEngine";
import type { Typology } from "@/data/typologies";
import type { RegionConfig, QualityConfig, CountryConfig } from "@/data/countries";

const mockTypology: Typology = {
  id: "office_std",
  name: "Bürogebäude",
  benchmark: 2500, // €/m2
  refNgf: 1000,
  degression: 0.1,
  ngfToBgf: 0.8,
  kg300Share: 0.45,
  kg400Share: 0.30,
  kg500Pct: 0.05,
  kg700Pct: 0.20,
  tgaProfile: "office",
  kg300Dist: { "310": 0.1, "320": 0.3, "330": 0.3, "340": 0.1, "350": 0.1, "360": 0.1 },
  nameEN: "Office Building",
  category: "Büro",
  icon: "building",
  description: "Standard office building"
};

const mockRegion: RegionConfig = { id: "de_be", name: "Berlin", factor: 1.1, country: "DE" };
const mockQuality: QualityConfig = { id: "medium", name: "Mittel", factor: 1.0, description: "Standard quality" };
const mockCountry: CountryConfig = {
  code: "DE",
  name: "Deutschland",
  flag: "🇩🇪",
  currency: "EUR",
  locale: "de-DE",
  vatRate: 0.19,
  framework: "DIN 276",
  areaBasis: "NGF",
  active: true,
  status: "active",
  docsRef: "DIN 276",
};

const baseInput: CostInput = {
  typology: mockTypology,
  ngf: 1000,
  region: mockRegion,
  quality: mockQuality,
  country: mockCountry,
  year: 2024,
  includeVat: false,
  includeLand: false,
  landValue: 0,
  untergeschosse: 0,
  obergeschosse: 3,
  bauweiseId: "massiv", // Factor 1.0
  energiestandardId: "kfw55" // Factor 1.05
};

// Mocks the effective cost index
vi.mock("@/lib/marketData", () => ({
  getEffectiveCostIndex: () => ({
    2024: 150,
    2025: 160
  })
}));

// Mocks factors
vi.mock("@/data/countries", () => ({
  bauweiseById: (id: string) => ({ factor: id === "massiv" ? 1.0 : 1.1 }),
  energiestandardById: (id: string) => ({ factor: id === "kfw55" ? 1.05 : 1.0 })
}));

describe("DIN 276 Cost Engine (Kostenermittlung)", () => {
  
  it("TEST-001: Calculates base cost correctly without modifiers", () => {
    const res = estimateCost(baseInput);
    // Base benchmark: 2500
    // region(1.1) * quality(1.0) * year(1.0) * size(1.0) * floors(1.0, 3 floors) = 1.1
    // adjusted: 2500 * 1.1 = 2750 €/m2
    expect(res.benchmarkAdj).toBeCloseTo(2750, 0);
    
    // total base: 2750 * 1000 = 2,750,000
    // kg300: 2750000 * 0.45 * 1.0 * 1.05 = 1,299,375
    // kg400: 2750000 * 0.30 * 1.05 = 866,250
    // kg500: 2750000 * 0.05 = 137,500
    // kg700: 2750000 * 0.20 = 550,000
    // netTotal: 1,299,375 + 866,250 + 137,500 + 550,000 = 2,853,125
    expect(res.netTotal).toBeCloseTo(2853125, 0);
    expect(res.vatAmount).toBe(0);
  });

  it("TEST-002: Applies Größendegression (Economies of Scale) for larger buildings", () => {
    const largeInput = { ...baseInput, ngf: 5000 };
    const resLarge = estimateCost(largeInput);
    
    const smallInput = { ...baseInput, ngf: 500 };
    const resSmall = estimateCost(smallInput);

    // Cost per m2 should be lower for large buildings
    expect(resLarge.perM2NgfNet).toBeLessThan(resSmall.perM2NgfNet);
    // size factor for 5000 = (1000/5000)^0.1 = 0.85
    expect(resLarge.sizeFactor).toBeCloseTo(0.85, 2);
  });

  it("TEST-003: Applies basement surcharge accurately to KG 300", () => {
    const withBasement = { ...baseInput, untergeschosse: 2 };
    const res = estimateCost(withBasement);
    
    // footprint = ngf(1000) / max(og(3), 1) = 333.33
    // basementCost = 2 * 333.33 * 1500 = 1,000,000
    expect(res.basementCost).toBeCloseTo(1000000, 0);
    expect(res.kg300).toBeGreaterThan(1000000);
  });

  it("TEST-004: Includes VAT and Land Value correctly", () => {
    const res = estimateCost({ ...baseInput, includeVat: true, includeLand: true, landValue: 500000 });
    
    expect(res.landNet).toBe(500000);
    // Net total with land = 2853125 + 500000 = 3353125
    // VAT = 3353125 * 0.19 = 637093.75
    expect(res.vatAmount).toBeCloseTo(637093.75, 0);
    expect(res.grossTotal).toBeCloseTo(3990218.75, 0);
    
    // Ensure KG 710 was appended or updated
    const kg710 = res.lines700.find(l => l.code === "710");
    expect(kg710).toBeDefined();
    expect(kg710?.amount).toBe(500000);
  });

  it("TEST-005: Distributes Sub-KGs dynamically according to TGA Profile", () => {
    const res = estimateCost(baseInput);
    
    // Total KG 400 is ~866,250. Profile is "office", so:
    // 440 (Strom) = 22%
    const kg440 = res.lines400.find(l => l.code === "440");
    expect(kg440).toBeDefined();
    expect(kg440?.amount).toBeCloseTo(866250 * 0.22, 0);
  });
});


describe("DIN 276 Fassung 2018 ↔ 2008 (§71, V2.8)", () => {
  it("TEST-071-1 : Erschließung regroupée en KG 220, sortie de la KG 500 (défaut 2018)", () => {
    const res = estimateCost(baseInput);
    expect(res.din276).toBe("2018");
    expect(res.lines500.find((l) => l.code === "510")).toBeUndefined();
    expect(res.lines200).toHaveLength(1);
    expect(res.lines200[0].code).toBe("220");
    expect(res.kg200).toBeGreaterThan(0);
  });

  it("TEST-071-2 : Fassung 2008 — libellés normatifs, montants rigoureusement identiques", () => {
    const a = estimateCost(baseInput);
    const b = estimateCost({ ...baseInput, din276: "2008" });
    expect(b.din276).toBe("2008");
    const sum = (x: typeof a) =>
      [x.lines200, x.lines300, x.lines400, x.lines500, x.lines700]
        .flat()
        .reduce((acc, l) => acc + l.amount, 0);
    expect(sum(b)).toBeCloseTo(sum(a), 6);
    expect(b.netTotal).toBeCloseTo(a.netTotal, 6);
    expect(DIN276_GROUP_LABELS["2008"].kg200).toBe("Herrichten und Erschließen");
    expect(DIN276_GROUP_LABELS["2008"].kg500).toBe("Außenanlagen");
    expect(DIN276_GROUP_LABELS["2018"].kg200).toBe("Vorbereitende Maßnahmen");
    expect(DIN276_GROUP_LABELS["2018"].kg500).toBe("Außenanlagen und Freiflächen");
  });
});

describe("DIN 276 NGF 0 (§271)", () => {
  it("keine 30-m²-Degression, alle Beträge 0", () => {
    const res = estimateCost({ ...baseInput, ngf: 0 });
    expect(res.schaetzungGueltig).toBe(false);
    expect(res.input.ngf).toBe(0);
    expect(res.netTotal).toBe(0);
    expect(res.kg300).toBe(0);
    expect(res.sizeFactor).toBe(1);
    expect(res.benchmarkAdj).toBe(0);
    expect(res.uncertaintyPct).toBe(0);
  });
});
