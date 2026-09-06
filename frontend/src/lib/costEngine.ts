// Narchi — DIN 276 cost-estimation engine (Kostenermittlung).
// Deterministic, transparent calculation grounded in typology benchmarks,
// regional cost factors, quality standards, the construction-cost index,
// economies of scale (Größendegression), basement surcharge, construction type
// and energy standard. Produces a realistic cost range (Kostenspanne).

import type { Typology } from "@/data/typologies";
import type { CountryConfig, QualityConfig, RegionConfig } from "@/data/countries";
import { bauweiseById, energiestandardById } from "@/data/countries";
import { getEffectiveCostIndex } from "@/lib/marketData";

export interface CostInput {
  typology: Typology;
  ngf: number; // Nettogrundfläche [m²] (DIN 277)
  region: RegionConfig;
  quality: QualityConfig;
  country: CountryConfig;
  year: number;
  includeVat: boolean;
  includeLand: boolean;
  landValue: number;
  // Realism modifiers:
  untergeschosse: number; // basement levels (0, 1, 2)
  obergeschosse: number; // above-ground floors (1+)
  bauweiseId: string; // construction type
  energiestandardId: string; // energy standard
  din276?: Din276Fassung; // §71 — Fassung DIN 276-1 (défaut "2018")
}

export interface KGLine {
  code: string;
  label: string;
  amount: number;
  share: number;
  perM2: number;
}

/* §71 — V2.8 : Fassung de la DIN 276-1. La HOAI 2021 reference
   officiellement la Fassung 2008-12 pour les anrechenbare Kosten ;
   la Fassung 2018-12 est la norme en vigueur (8 KG, KG 800 neu). */
export type Din276Fassung = "2018" | "2008";

/** Libelles officiels des groupes selon la Fassung. */
export const DIN276_GROUP_LABELS: Record<
  Din276Fassung,
  { kg200: string; kg500: string; note: string }
> = {
  "2018": {
    kg200: "Vorbereitende Maßnahmen",
    kg500: "Außenanlagen und Freiflächen",
    note: "Fassung 2018-12 — 8 Kostengruppen (KG 800 Finanzierung nicht bepreist).",
  },
  "2008": {
    kg200: "Herrichten und Erschließen",
    kg500: "Außenanlagen",
    note: "Fassung 2008-12 — die HOAI 2021 referenziert diese Fassung; anrechenbare Kosten i. d. R. KG 300 + 400.",
  },
};

export interface CostResult {
  input: CostInput;
  din276: Din276Fassung; // §71 — Fassung effectivement utilisée
  bgf: number;
  benchmarkBase: number;
  benchmarkAdj: number; // €/m² NGF fully adjusted
  // factor breakdown (transparency)
  regionFactor: number;
  qualityFactor: number;
  yearFactorValue: number;
  sizeFactor: number; // Größendegression
  basementFactor: number; // surcharge multiplier
  floorsFactor: number;
  bauweiseFactor: number;
  energiestandardFactor: number;

  kg200: number; // §71 — Erschließung (part issue de la KG 500)
  kg300: number;
  kg400: number;
  kg500: number;
  kg700: number;
  basementCost: number; // KG 310 underground surcharge

  lines200: KGLine[]; // §71 — KG 200 (Erschließung), label selon Fassung
  lines300: KGLine[];
  lines400: KGLine[];
  lines500: KGLine[];
  lines700: KGLine[];

  netTotal: number;
  vatAmount: number;
  grossTotal: number;
  landNet: number;

  perM2Ngf: number;
  perM2Bgf: number;
  perM2NgfNet: number; // net excl. land + vat

  // Kostenspanne (confidence interval) — DIN 276 practice
  low: number;
  high: number;
  lowPerM2: number;
  highPerM2: number;
  uncertaintyPct: number;
}

/* TGA profile shifts the KG 400 sub-distribution per typology. */
function tgaDistribution(profile: Typology["tgaProfile"]): Record<string, number> {
  switch (profile) {
    case "residential":
      return { "410": 0.11, "420": 0.13, "430": 0.06, "440": 0.26, "450": 0.05, "460": 0.18, "470": 0.16, "480": 0.05 };
    case "office":
      return { "410": 0.08, "420": 0.10, "430": 0.16, "440": 0.22, "450": 0.06, "460": 0.12, "470": 0.18, "480": 0.08 };
    case "school":
      return { "410": 0.10, "420": 0.14, "430": 0.12, "440": 0.20, "450": 0.08, "460": 0.12, "470": 0.14, "480": 0.10 };
    case "health":
      return { "410": 0.08, "420": 0.12, "430": 0.24, "440": 0.16, "450": 0.10, "460": 0.10, "470": 0.14, "480": 0.06 };
    case "industrial":
      return { "410": 0.06, "420": 0.14, "430": 0.10, "440": 0.30, "450": 0.05, "460": 0.04, "470": 0.26, "480": 0.05 };
    case "lab":
      return { "410": 0.07, "420": 0.10, "430": 0.22, "440": 0.18, "450": 0.10, "460": 0.06, "470": 0.20, "480": 0.07 };
    default:
      return { "410": 0.08, "420": 0.10, "430": 0.16, "440": 0.22, "450": 0.06, "460": 0.12, "470": 0.18, "480": 0.08 };
  }
}

const KG500_DISTRIBUTION: Record<string, number> = { "510": 0.30, "520": 0.45, "530": 0.25 };
const KG700_DISTRIBUTION: Record<string, number> = { "710": 0.0, "720": 0.05, "730": 0.74, "740": 0.13, "750": 0.08 };

const L300: Record<string, string> = {
  "310": "Baugrund, Gründung", "320": "Außenwände", "330": "Tragkonstruktion, Geschossdecken",
  "340": "Dach, Bauwerksabschlussflächen", "350": "Innenausbau, Innenräume", "360": "Raumflächen, Fußböden",
};
const L400: Record<string, string> = {
  "410": "Abwasser, Wasser, Gas", "420": "Wärmeversorgung", "430": "Lufttechnische Anlagen",
  "440": "Stromversorgung", "450": "Informations- und Kommunikationstechnik", "460": "Förderanlagen",
  "470": "Nutzungsspezifische Anlagen", "480": "Gebäudeautomation, MSR",
};
const L500: Record<string, string> = { "510": "Erschließung des Grundstücks", "520": "Freianlagen, Außenräume", "530": "Pflanzungen, Begrünung" };
const L700: Record<string, string> = {
  "710": "Baugrundstück", "720": "Erschließung", "730": "Baunebenkosten – Honorare, Bauleitung",
  "740": "Finanzierung, Kapitalkosten", "750": "Allgemeine Nebenkosten",
};

function distribute(amount: number, dist: Record<string, number>, labels: Record<string, string>, total: number, ngf: number): KGLine[] {
  return Object.entries(dist)
    .filter(([, share]) => share > 0)
    .map(([code, share]) => {
      const a = amount * share;
      return { code, label: labels[code] ?? code, amount: a, share: total ? a / total : 0, perM2: ngf ? a / ngf : 0 };
    })
    .sort((x, y) => y.amount - x.amount);
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function estimateCost(input: CostInput): CostResult {
  const { typology, ngf, region, quality, country, year, includeVat, includeLand, landValue, untergeschosse, obergeschosse } = input;
  // §71 — Fassung DIN 276-1 : défaut 2018-12, bascule 2008-12 = HOAI-Referenz.
  const fassung: Din276Fassung = input.din276 ?? "2018";

  if (!(ngf > 0)) {
    return {
      input,
      din276: fassung,
      bgf: 0,
      benchmarkBase: typology.benchmark,
      benchmarkAdj: 0,
      regionFactor: region.factor,
      qualityFactor: quality.factor,
      yearFactorValue: 1,
      sizeFactor: 1,
      basementFactor: 0,
      floorsFactor: 1,
      bauweiseFactor: bauweiseById(input.bauweiseId).factor,
      energiestandardFactor: energiestandardById(input.energiestandardId).factor,
      kg200: 0, kg300: 0, kg400: 0, kg500: 0, kg700: 0, basementCost: 0,
      lines200: [], lines300: [], lines400: [], lines500: [], lines700: [],
      netTotal: 0, vatAmount: 0, grossTotal: 0, landNet: 0,
      perM2Ngf: 0, perM2Bgf: 0, perM2NgfNet: 0,
      low: 0, high: 0, lowPerM2: 0, highPerM2: 0, uncertaintyPct: 0,
      schaetzungGueltig: false,
    };
  }

  // 1. Base factors
  const regionFactor = region.factor;
  const qualityFactor = quality.factor;
  // yearFactor, but using the configurable (overridable) cost index
  const effIndex = getEffectiveCostIndex();
  // §49 — filet de secours aligné sur la série officielle :
  // 129,75 = Jahresdurchschnitt 2024 Destatis 61261-0002 (Basis 2021=100).
  const curIdx = effIndex[year] ?? effIndex[2024] ?? 129.75;
  const refIdx = effIndex[2024] ?? 129.75;
  const yearFactorValue = curIdx / refIdx;
  const bauweiseFactor = bauweiseById(input.bauweiseId).factor;
  const energiestandardFactor = energiestandardById(input.energiestandardId).factor;

  // 2. Größendegression (economies of scale) — THE key realism factor.
  // Buildings smaller than the reference cost more per m²; larger ones less.
  const refNgf = typology.refNgf;
  const degr = typology.degression;
  const sizeFactor = clamp(Math.pow(refNgf / ngf, degr), 0.70, 1.60);

  // 3. Basement surcharge — each UG adds foundation + waterproofing cost.
  // KG 310 cost rises sharply: ~1.500 €/m² BGF per basement level.
  const basementAreaPerLevel = ngf / Math.max(obergeschosse, 1); // footprint
  const basementCostPerM2 = 1500;
  const basementCost = untergeschosse * basementAreaPerLevel * basementCostPerM2;

  // 4. Floors surcharge — more floors → vertical structure, lifts, fire protection.
  const floorsFactor = clamp(1 + Math.max(0, obergeschosse - 4) * 0.025, 1.0, 1.20);

  // 5. Adjusted €/m² benchmark
  const benchmarkBase = typology.benchmark;
  const perM2Adjustment = regionFactor * qualityFactor * yearFactorValue * sizeFactor * floorsFactor;
  const benchmarkAdj = benchmarkBase * perM2Adjustment;

  const bgf = ngf / Math.max(typology.ngfToBgf, 0.1);

  // 6. KG 300/400 split — apply bauweise + energiestandard to KG 300 (shell + envelope)
  const kg300_400_base = benchmarkAdj * ngf;
  const kg300 = kg300_400_base * typology.kg300Share * bauweiseFactor * energiestandardFactor + basementCost;
  const kg400 = kg300_400_base * typology.kg400Share * energiestandardFactor;
  const kg500 = kg300_400_base * typology.kg500Pct;
  const kg700Base = kg300_400_base * typology.kg700Pct;

  const landNet = includeLand ? landValue : 0;
  const netTotal = kg300 + kg400 + kg500 + kg700Base;

  // 7. KG distributions
  const lines300 = distribute(kg300, typology.kg300Dist, L300, netTotal, ngf);
  const lines400 = distribute(kg400, tgaDistribution(typology.tgaProfile), L400, netTotal, ngf);
  const lines500 = distribute(kg500, KG500_DISTRIBUTION, L500, netTotal, ngf);
  const lines700 = distribute(kg700Base, KG700_DISTRIBUTION, L700, netTotal, ngf);

  // §71 — V2.8 : l'Erschließung n'appartient à la KG 500 dans AUCUNE
  // Fassung (2008 → KG 200 « Herrichten und Erschließen » ; 2018 → KG 200
  // « Vorbereitende Maßnahmen »). Regroupement de PRESENTATION : montants
  // et total strictement inchangés.
  const erLine = lines500.find((l) => l.code === "510");
  const lines500Rest = lines500.filter((l) => l.code !== "510");
  const lines200: KGLine[] = erLine
    ? [{ code: "220", label: "Erschließung des Grundstücks", amount: erLine.amount, share: 0, perM2: erLine.perM2 }]
    : [];
  const kg200 = lines200.reduce((s, l) => s + l.amount, 0);

  if (includeLand && landNet > 0) {
    const l710 = lines700.find((l) => l.code === "710");
    if (l710) {
      l710.amount += landNet;
      l710.perM2 = ngf ? l710.amount / ngf : 0;
    } else {
      lines700.push({ code: "710", label: L700["710"], amount: landNet, share: 0, perM2: ngf ? landNet / ngf : 0 });
    }
  }

  const netTotalWithLand = netTotal + landNet;
  const vatAmount = includeVat ? netTotalWithLand * country.vatRate : 0;
  const grossTotal = netTotalWithLand + vatAmount;

  const perM2NgfNet = ngf ? netTotal / ngf : 0;
  const perM2Ngf = ngf ? netTotalWithLand / ngf : 0;
  const perM2Bgf = bgf ? netTotalWithLand / bgf : 0;

  // 8. Kostenspanne (confidence interval). DIN 276 Kostenschätzung LP 2–3: ±15%.
  // Small/complex projects have wider bands.
  const uncertaintyPct = 0.12 + (sizeFactor > 1.1 ? 0.04 : 0) + (typology.degression > 0.12 ? 0.02 : 0);
  const low = netTotal * (1 - uncertaintyPct);
  const high = netTotal * (1 + uncertaintyPct);
  const lowPerM2 = ngf ? low / ngf : 0;
  const highPerM2 = ngf ? high / ngf : 0;

  // normalise shares
  const norm = (lines: KGLine[]) => lines.map((l) => ({ ...l, share: netTotalWithLand ? l.amount / netTotalWithLand : 0 }));

  return {
    input,
    bgf: Math.round(bgf),
    benchmarkBase,
    benchmarkAdj,
    regionFactor, qualityFactor, yearFactorValue, sizeFactor,
    basementFactor: basementCost,
    floorsFactor,
    bauweiseFactor, energiestandardFactor,
    kg200, kg300, kg400, kg500, kg700: kg700Base, basementCost, din276: fassung,
    lines200: norm(lines200), lines300: norm(lines300), lines400: norm(lines400), lines500: norm(lines500Rest), lines700: norm(lines700),
    netTotal, vatAmount, grossTotal, landNet,
    perM2Ngf, perM2Bgf, perM2NgfNet,
    low, high, lowPerM2, highPerM2, uncertaintyPct,
    schaetzungGueltig: true,
  };
}

/* --- German number / currency formatting --- */
export function fmtMoney(n: number, currency: "EUR" | "CHF" = "EUR"): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}
export function fmtMoney2(n: number, currency: "EUR" | "CHF" = "EUR"): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
export function fmtPerM2(n: number, currency: "EUR" | "CHF" = "EUR"): string {
  return `${fmtMoney(n, currency)} / m²`;
}
export function fmtNumber(n: number, digits = 0): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}
export function fmtPct(n: number, digits = 0): string {
  return `${fmtNumber(n * 100, digits)} %`;
}
