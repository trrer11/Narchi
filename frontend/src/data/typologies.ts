// Narchi — building-typology cost benchmarks (Germany / DIN 276).
// Values are Narchi market-reference construction costs in €/m² NGF for the
// cost-bearing groups KG 300 + KG 400, "Standard" quality, Germany average,
// reference year 2024 (couloir BKI/StatBA vérifié — voir l'audit prix
// docs/AUDIT_ESTIMATIONS_PRIX_2026.md). Projection/retrojection via la table
// Destatis OFFICIELLE base 2021 = 100 (src/data/destatisIndex.ts, §49) —
// 2026 = 140,3 (Q2, Stand 10.07.2026) soit +8,1 % vs moyenne 2024.
// Each typology carries its OWN KG 300/400 sub-distribution for realism.

export interface Typology {
  id: string;
  name: string; // German Bauaufgabe
  nameEN: string;
  category: "Wohnen" | "Büro" | "Bildung" | "Gesundheit" | "Gewerbe" | "Logistik" | "Forschung" | "Öffentlich";
  benchmark: number; // €/m² NGF — KG300+400 combined, Standard, Germany avg, 2024
  kg300Share: number; // share of (300+400) in KG300
  kg400Share: number; // share of (300+400) in KG400
  kg500Pct: number; // KG500 as fraction of (300+400)
  kg700Pct: number; // KG700 as fraction of (300+400)
  ngfToBgf: number; // NGF/BGF ratio (DIN 277) — efficiency factor
  icon: string;
  description: string;
  // typology-specific KG 300 sub-distribution (310–360)
  kg300Dist: Record<string, number>;
  // typology-specific TGA profile
  tgaProfile?: "residential" | "office" | "school" | "health" | "industrial" | "lab";
  // reference size for Größendegression [m² NGF] — the size the benchmark is calibrated to
  refNgf: number;
  // Größendegression exponent (0.08–0.15 typical)
  degression: number;
}

export const TYPOLOGIES: Typology[] = [
  {
    id: "mfh",
    name: "Geschosswohnungsbau (MFH)",
    nameEN: "Multi-family residential",
    category: "Wohnen",
    benchmark: 2750,
    kg300Share: 0.68, kg400Share: 0.32,
    kg500Pct: 0.07, kg700Pct: 0.19,
    ngfToBgf: 0.82,
    icon: "building",
    description: "Mehrgeschossiger Wohnungsbau, unterkellert, Standardausführung, EG bis 6 OG.",
    tgaProfile: "residential",
    refNgf: 2500,
    degression: 0.11,
    kg300Dist: { "310": 0.09, "320": 0.20, "330": 0.16, "340": 0.13, "350": 0.25, "360": 0.17 },
  },
  {
    id: "efh",
    name: "Einfamilienhaus (EFH)",
    nameEN: "Single-family house",
    category: "Wohnen",
    benchmark: 2900,
    kg300Share: 0.70, kg400Share: 0.30,
    kg500Pct: 0.10, kg700Pct: 0.20,
    ngfToBgf: 0.78,
    icon: "building",
    description: "Freistehendes Einfamilienhaus in Massivbauweise, geneigtes Dach.",
    tgaProfile: "residential",
    refNgf: 200,
    degression: 0.14,
    kg300Dist: { "310": 0.10, "320": 0.21, "330": 0.15, "340": 0.14, "350": 0.24, "360": 0.16 },
  },
  {
    id: "office",
    name: "Büro- / Verwaltungsgebäude",
    nameEN: "Office / administration",
    category: "Büro",
    benchmark: 3100,
    kg300Share: 0.64, kg400Share: 0.36,
    kg500Pct: 0.06, kg700Pct: 0.18,
    ngfToBgf: 0.80,
    icon: "building",
    description: "Bürogebäude mit offenen und zelligen Arbeitsbereichen, repräsentativ.",
    tgaProfile: "office",
    refNgf: 5000,
    degression: 0.10,
    kg300Dist: { "310": 0.08, "320": 0.22, "330": 0.18, "340": 0.15, "350": 0.21, "360": 0.16 },
  },
  {
    id: "school",
    name: "Schule / Unterrichtsbau",
    nameEN: "School / teaching",
    category: "Bildung",
    benchmark: 2850,
    kg300Share: 0.67, kg400Share: 0.33,
    kg500Pct: 0.08, kg700Pct: 0.18,
    ngfToBgf: 0.81,
    icon: "building",
    description: "Allgemeinbildende Schule, Regelklassen, Fachräume und Sporthalle.",
    tgaProfile: "school",
    refNgf: 6000,
    degression: 0.09,
    kg300Dist: { "310": 0.09, "320": 0.19, "330": 0.17, "340": 0.14, "350": 0.24, "360": 0.17 },
  },
  {
    id: "hospital",
    name: "Krankenhaus",
    nameEN: "Hospital",
    category: "Gesundheit",
    benchmark: 4200,
    kg300Share: 0.60, kg400Share: 0.40,
    kg500Pct: 0.05, kg700Pct: 0.17,
    ngfToBgf: 0.74,
    icon: "building",
    description: "Krankenhaus der Regelversorgung, Pflegestationen, Funktionstrakt, OP.",
    tgaProfile: "health",
    refNgf: 15000,
    degression: 0.08,
    kg300Dist: { "310": 0.07, "320": 0.18, "330": 0.19, "340": 0.14, "350": 0.26, "360": 0.16 },
  },
  {
    id: "industrial",
    name: "Industrie- / Produktionsbau",
    nameEN: "Industrial / production",
    category: "Gewerbe",
    benchmark: 2250,
    kg300Share: 0.76, kg400Share: 0.24,
    kg500Pct: 0.09, kg700Pct: 0.16,
    ngfToBgf: 0.86,
    icon: "building",
    description: "Produktionshalle mit Anbauten, Hallenbauweise, Kranlasten.",
    tgaProfile: "industrial",
    refNgf: 8000,
    degression: 0.10,
    kg300Dist: { "310": 0.12, "320": 0.24, "330": 0.28, "340": 0.22, "350": 0.08, "360": 0.06 },
  },
  {
    id: "logistics",
    name: "Logistik / Lagerhalle",
    nameEN: "Logistics / warehouse",
    category: "Logistik",
    benchmark: 1650,
    kg300Share: 0.81, kg400Share: 0.19,
    kg500Pct: 0.12, kg700Pct: 0.15,
    ngfToBgf: 0.90,
    icon: "building",
    description: "Lager- und Logistikzentrum, Hochregal, Verladezonen, Büroanteil.",
    tgaProfile: "industrial",
    refNgf: 10000,
    degression: 0.11,
    kg300Dist: { "310": 0.14, "320": 0.22, "330": 0.30, "340": 0.24, "350": 0.05, "360": 0.05 },
  },
  {
    id: "lab",
    name: "Forschung / Laborbau",
    nameEN: "Research / laboratory",
    category: "Forschung",
    benchmark: 4000,
    kg300Share: 0.62, kg400Share: 0.38,
    kg500Pct: 0.05, kg700Pct: 0.17,
    ngfToBgf: 0.75,
    icon: "building",
    description: "Forschungsbau mit Laborflächen, Technischem Zentrum, Reinräumen.",
    tgaProfile: "lab",
    refNgf: 8000,
    degression: 0.09,
    kg300Dist: { "310": 0.08, "320": 0.17, "330": 0.18, "340": 0.15, "350": 0.28, "360": 0.14 },
  },
  {
    id: "kindergarten",
    name: "Kindertagesstätte (Kita)",
    nameEN: "Nursery / Kita",
    category: "Bildung",
    benchmark: 3250,
    kg300Share: 0.65, kg400Share: 0.35,
    kg500Pct: 0.12, kg700Pct: 0.19,
    ngfToBgf: 0.83,
    icon: "building",
    description: "Kindertagesstätte mit Gruppenräumen, Bewegungsraum und Außenfläche.",
    tgaProfile: "school",
    refNgf: 1200,
    degression: 0.12,
    kg300Dist: { "310": 0.09, "320": 0.20, "330": 0.16, "340": 0.14, "350": 0.23, "360": 0.18 },
  },
  {
    id: "parking",
    name: "Parkhaus",
    nameEN: "Car park",
    category: "Öffentlich",
    benchmark: 850,
    kg300Share: 0.88, kg400Share: 0.12,
    kg500Pct: 0.04, kg700Pct: 0.15,
    ngfToBgf: 0.93,
    icon: "building",
    description: "Stahlbeton-Parkhaus, offene Bauweise, vertikale Erschließung.",
    tgaProfile: "industrial",
    refNgf: 12000,
    degression: 0.10,
    kg300Dist: { "310": 0.15, "320": 0.05, "330": 0.50, "340": 0.18, "350": 0.07, "360": 0.05 },
  },
];

export function typologyById(id: string): Typology {
  return TYPOLOGIES.find((t) => t.id === id) ?? TYPOLOGIES[0];
}

export const TYPOLOGY_CATEGORIES = Array.from(new Set(TYPOLOGIES.map((t) => t.category)));
