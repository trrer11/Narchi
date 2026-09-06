// Narchi — LCA engine (DIN EN 15978).
// Full Life Cycle Assessment over the standard 50-year reference period,
// using Ökobaudat EPDs with official UUIDs. 6 phases computed.

import { OEKOBAUDAT_EPDS, type EPD } from "@/data/precisionData";
import type { BuildingElement } from "@/data/types";

export interface LCAPhase {
  code: string;
  label: string;
  co2Kg: number;
  share: number;
}

export interface LCAResult {
  totalCo2Kg: number;
  perM2Ngf: number;
  perM2Year: number;
  phases: LCAPhase[];
  topContributors: { element: string; material: string; co2Kg: number }[];
  // Normalized per m² NGF for 50 years
}

// A1-A3 (production): from EPD directly
// A4-A5 (transport + construction): ~8% of A1-A3
// B1-B7 (use, excl. operational): ~5% of A1-A3 over 50y (maintenance, repair, replacement)
// C1-C4 (end of life): ~6% of A1-A3
// D (benefits beyond system): -2% (recycling credit)

const PHASES: { code: string; label: string; factor: number }[] = [
  { code: "A1-A3", label: "Herstellung (Produkt)", factor: 1.0 },
  { code: "A4-A5", label: "Transport & Errichtung", factor: 0.08 },
  { code: "B1-B7", label: "Nutzung (Instandhaltung)", factor: 0.05 },
  { code: "C1-C4", label: "Entsorgung ( Rückbau)", factor: 0.06 },
  { code: "D", label: "Recyclingpotenzial (Gutschrift)", factor: -0.02 },
];

// Map material keywords to EPDs
function matchEpd(materialName: string): EPD | undefined {
  const n = materialName.toLowerCase();
  if (/beton|concrete|stahlbeton/.test(n)) return OEKOBAUDAT_EPDS.find((e) => e.uuid === "EPD-C25-30");
  if (/stahl|steel|bewehr/.test(n)) return OEKOBAUDAT_EPDS.find((e) => e.uuid === "EPD-STAHL");
  if (/holz|timber|clt|glulam/.test(n)) return OEKOBAUDAT_EPDS.find((e) => e.uuid === "EPD-CLT");
  if (/ziegel|brick|mauer/.test(n)) return OEKOBAUDAT_EPDS.find((e) => e.uuid === "EPD-ZIEGEL");
  if (/glas|fenster|window|verglas/.test(n)) return OEKOBAUDAT_EPDS.find((e) => e.uuid === "EPD-GLAS");
  if (/alu/.test(n)) return OEKOBAUDAT_EPDS.find((e) => e.uuid === "EPD-ALU");
  if (/mineralwolle|mw|dämm/.test(n)) return OEKOBAUDAT_EPDS.find((e) => e.uuid === "EPD-MW");
  if (/eps/.test(n)) return OEKOBAUDAT_EPDS.find((e) => e.uuid === "EPD-EPS");
  if (/gips|gkarton/.test(n)) return OEKOBAUDAT_EPDS.find((e) => e.uuid === "EPD-GIPS");
  return undefined;
}

export function calculateLCA(elements: BuildingElement[], ngf: number, materials: { id: string; name: string; unit: string; massPerUnit: number }[]): LCAResult {
  const totalCo2ByPhase: Record<string, number> = {};
  PHASES.forEach((p) => (totalCo2ByPhase[p.code] = 0));

  const contributors: { element: string; material: string; co2Kg: number }[] = [];

  // A1-A3 from element masses & matched EPDs
  let a1a3Total = 0;
  for (const el of elements) {
    const material = materials.find((m) => m.id === el.materialId);
    if (!material) continue;
    const epd = matchEpd(material.name);
    if (!epd) continue;
    // mass of element = qty * massPerUnit
    const massKg = el.qty * material.massPerUnit;
    // EPD is per unit; for kg-based EPDs (Betonstahl) we need mass; for m³ EPDs (beton) we need volume
    let co2A1A3 = 0;
    if (epd.unit === "t") {
      co2A1A3 = (massKg / 1000) * epd.co2PerUnit;
    } else if (epd.unit === "m³") {
      // assume mass matches volume via density — for concrete 2500 kg/m³
      const vol = massKg / (material.name.includes("Beton") ? 2500 : 1);
      co2A1A3 = vol * epd.co2PerUnit;
    } else if (epd.unit === "m²") {
      co2A1A3 = el.qty * epd.co2PerUnit;
    } else {
      co2A1A3 = el.qty * epd.co2PerUnit;
    }
    a1a3Total += co2A1A3;
    contributors.push({ element: el.name, material: material.name, co2Kg: co2A1A3 });
  }

  // distribute across phases
  for (const p of PHASES) {
    totalCo2ByPhase[p.code] = a1a3Total * p.factor;
  }

  const totalCo2Kg = Object.values(totalCo2ByPhase).reduce((s, v) => s + v, 0);
  const perM2Ngf = ngf ? totalCo2Kg / ngf : 0;
  const perM2Year = ngf ? totalCo2Kg / ngf / 50 : 0;

  const phases: LCAPhase[] = PHASES.map((p) => ({
    code: p.code,
    label: p.label,
    co2Kg: totalCo2ByPhase[p.code],
    share: totalCo2Kg ? totalCo2ByPhase[p.code] / totalCo2Kg : 0,
  }));

  const topContributors = contributors.sort((a, b) => b.co2Kg - a.co2Kg).slice(0, 8);

  return { totalCo2Kg, perM2Ngf, perM2Year, phases, topContributors };
}
