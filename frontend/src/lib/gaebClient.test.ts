import { describe, expect, it, vi } from "vitest";
import { estimateCost, type CostInput } from "./costEngine";
import { costResultToGaebRequest } from "./gaebClient";
import type { Typology } from "@/data/typologies";
import type { RegionConfig, QualityConfig, CountryConfig } from "@/data/countries";

// §74 — V2.5 : la conversion CostResult → requête GAEB est PURE ; on verrouille
// ici que le serveur reçoit exactement les montants du moteur, dans l'ordre des
// Kostengruppen, avec les libellés officiels de la Fassung choisie.

const mockTypology: Typology = {
  id: "office_std",
  name: "Bürogebäude",
  benchmark: 2500,
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
  bauweiseId: "massiv",
  energiestandardId: "kfw55"
};

vi.mock("@/lib/marketData", () => ({
  getEffectiveCostIndex: () => ({ 2024: 150, 2025: 160 })
}));

vi.mock("@/data/countries", () => ({
  bauweiseById: (id: string) => ({ factor: id === "massiv" ? 1.0 : 1.1 }),
  energiestandardById: (id: string) => ({ factor: id === "kfw55" ? 1.05 : 1.0 })
}));

describe("gaebClient — conversion CostResult → requête GAEB serveur (§74, V2.5)", () => {
  it("TEST-074-1 : ordre des KG, libellés officiels 2018, montants moteur INTACTS", () => {
    const r = estimateCost(baseInput);
    const req = costResultToGaebRequest("  Büro A & Söhne  ", r);
    expect(req.project_name).toBe("Büro A & Söhne");
    expect(req.din276).toBe("2018");
    expect(req.kostengruppen.map((g) => g.code)).toEqual(["200", "300", "400", "500", "700"]);
    expect(req.kostengruppen[0].label).toBe("Vorbereitende Maßnahmen");
    expect(req.kostengruppen[3].label).toBe("Außenanlagen und Freiflächen"); // index 3 = KG 500
    // Aucun montant inventé : somme requête == somme moteur (au centime).
    const sumReq = req.kostengruppen.flatMap((g) => g.lines).reduce((s, l) => s + l.amount, 0);
    const sumEng = [r.lines200, r.lines300, r.lines400, r.lines500, r.lines700]
      .flat()
      .reduce((s, l) => s + Number(l.amount.toFixed(2)), 0);
    expect(sumReq).toBeCloseTo(sumEng, 2);
    // La première position est l'Erschließung, revenue en KG 220 (§71).
    expect(req.kostengruppen[0].lines[0].code).toBe("220");
  });

  it("TEST-074-2 : Fassung 2008 (HOAI-Referenz) — libellés 2008, nom vide → fallback", () => {
    const r = estimateCost({ ...baseInput, din276: "2008" });
    const req = costResultToGaebRequest("   ", r);
    expect(req.project_name).toBe("NARCHI Kostenschätzung");
    expect(req.din276).toBe("2008");
    expect(req.kostengruppen[0].label).toBe("Herrichten und Erschließen");
    expect(req.kostengruppen[3].label).toBe("Außenanlagen"); // index 3 = KG 500
  });
});
