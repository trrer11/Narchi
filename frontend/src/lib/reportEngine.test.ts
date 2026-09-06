import { describe, expect, it, vi } from "vitest";
import { estimateCost, type CostInput } from "./costEngine";
import { buildPdfReport, fitLogoBox } from "./reportEngine";
import type { Typology } from "@/data/typologies";
import type { RegionConfig, QualityConfig, CountryConfig } from "@/data/countries";

// §70 — Test de la promesse « kein Preis ohne Herkunft » :
// le PDF doit contenir le bloc Herkunft & Genauigkeit. (§74 — V2.5 :
// l'export GAEB est désormais RÉEL et vient du serveur, cf. gaebClient.)

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

describe("reportEngine — bloc Herkunft & Genauigkeit (§70, V1.2)", () => {
  it("TEST-070-1 : le PDF contient le titre «Herkunft & Genauigkeit» gravé dans le contenu", () => {
    const cost = estimateCost(baseInput);
    // compress:false → les flux texte du PDF restent lisibles pour inspection.
    const doc = buildPdfReport({ projectName: "Testbüro", cost }, { compress: false });
    const raw = new TextDecoder("latin1").decode(doc.output("arraybuffer") as ArrayBuffer);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(3); // cover + résumé + DIN 276
    expect(raw).toContain("(Herkunft & Genauigkeit)");
    expect(raw).toContain("Fassung 2018-12");
  });

  it("TEST-070-2 : pied de page honnête toujours présent (Orientierungswert)", () => {
    const cost = estimateCost(baseInput);
    const doc = buildPdfReport({ projectName: "Testbüro", cost }, { compress: false });
    const raw = new TextDecoder("latin1").decode(doc.output("arraybuffer") as ArrayBuffer);
    expect(raw).toContain("Orientierungswert");
  });

});

describe("reportEngine — Büro-Branding sur la couverture (§77, « waw »)", () => {
  // Vraie image 1×1 PNG (même fixture que les tests backend §77).
  const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  it("TEST-077-1 : avec branding, la couverture porte « Erstellt von <Büro> » + logo", () => {
    const cost = estimateCost(baseInput);
    const doc = buildPdfReport(
      { projectName: "EFH Hannover", cost },
      { compress: false },
      { officeName: "Atelier Müller", logo: { dataUrl: PNG_1PX, width: 1, height: 1 } },
    );
    const raw = new TextDecoder("latin1").decode(doc.output("arraybuffer") as ArrayBuffer);
    expect(raw).toContain("(Erstellt von Atelier Müller");
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(3);
  });

  it("TEST-077-2 : sans branding, la ligne reste « Erstellt am » — AUCUNE substitution fake", () => {
    const cost = estimateCost(baseInput);
    const doc = buildPdfReport({ projectName: "EFH", cost }, { compress: false });
    const raw = new TextDecoder("latin1").decode(doc.output("arraybuffer") as ArrayBuffer);
    expect(raw).toContain("(Erstellt am ");
    expect(raw).not.toContain("Erstellt von ");
  });

  it("TEST-077-3 : fitLogoBox préserve le ratio et n'agrandit JAMAIS", () => {
    expect(fitLogoBox(200, 100, 60, 22)).toEqual({ w: 44, h: 22 });   // plafond hauteur
    expect(fitLogoBox(100, 50, 60, 22)).toEqual({ w: 44, h: 22 });    // même ratio → même cadre
    expect(fitLogoBox(20, 10, 60, 22)).toEqual({ w: 20, h: 10 });     // petit logo : pas d'agrandissement flou
    expect(fitLogoBox(0, 10, 60, 22)).toEqual({ w: 0, h: 0 });        // garde-fou division
  });
});

describe("reportEngine — le NOM du bureau prend la vedette (§79)", () => {
  const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  it("TEST-079-1 : brandé → en-tête <Büro>, titre couverture <Büro>, attribution discrète", () => {
    const cost = estimateCost(baseInput);
    const doc = buildPdfReport(
      { projectName: "EFH Hannover", cost },
      { compress: false },
      { officeName: "Atelier Mueller", logo: { dataUrl: PNG_1PX, width: 1, height: 1 } },
    );
    const raw = new TextDecoder("latin1").decode(doc.output("arraybuffer") as ArrayBuffer);
    expect(raw).toContain("Atelier Mueller");          // en-tête + couverture + creatorLine
    expect(raw).toContain("erstellt mit NARCHI");      // attribution réelle, discrète
    expect(raw).toContain("(Erstellt von Atelier Mueller"); // la ligne créateur reste
  });

  it("TEST-079-2 : sans branding → en-tête NARCHI, AUCUNE fausse attribution ajoutée", () => {
    const cost = estimateCost(baseInput);
    const doc = buildPdfReport({ projectName: "EFH", cost }, { compress: false });
    const raw = new TextDecoder("latin1").decode(doc.output("arraybuffer") as ArrayBuffer);
    expect(raw).toContain("NARCHI");
    expect(raw).not.toContain("erstellt mit NARCHI");  // rien d'inventé quand rien n'est configuré
  });
});


describe("reportEngine — section CO2-Bilanz (§168)", () => {
  it("TEST-168-1 : avec carbon, le rapport porte la section 6 « CO2-Bilanz »", () => {
    const cost = estimateCost(baseInput);
    const doc = buildPdfReport(
      {
        projectName: "EFH Hannover",
        cost,
        carbon: {
          a1a3Kg: 90_000,
          perM2Kg: 500,
          verdictLabel: "Silber",
          budgetKg: 108_000,
          budgetUsedPct: 83.3,
          overBudget: false,
          veTop: [
            { label: "Stahlbeton C25/30 -> Beton C20/25", co2PerM3: 102, eurPerM3: -40, winWin: true },
          ],
        },
      },
      { compress: false },
    );
    const raw = new TextDecoder("latin1").decode(doc.output("arraybuffer") as ArrayBuffer);
    expect(raw).toContain("CO2-Bilanz");
    expect(raw).toContain("CO2-Einsparpotenzial");
  });

  it("TEST-168-2 : sans carbon, le rapport reste INCHANGÉ (aucune section 6)", () => {
    const cost = estimateCost(baseInput);
    const doc = buildPdfReport({ projectName: "EFH", cost }, { compress: false });
    const raw = new TextDecoder("latin1").decode(doc.output("arraybuffer") as ArrayBuffer);
    expect(raw).not.toContain("CO2-Bilanz");
  });
});
