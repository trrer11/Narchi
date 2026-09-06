// Narchi — DIN 276-1:2008-12 "Kosten im Bauwesen" cost-classification hierarchy.
// The authoritative German structure used for every cost estimate on the platform.

export type KGLevel = 1 | 2 | 3;

export interface Kostengruppe {
  code: string; // e.g. "310"
  level: KGLevel;
  label: string; // German designation
  labelEN: string; // working translation
}

/* Level-1 Hauptkostengruppen (100–700) */
export const DIN276_L1: Kostengruppe[] = [
  { code: "100", level: 1, label: "Grundstück", labelEN: "Land & plot" },
  { code: "200", level: 1, label: "Herrichtung und Erschließung", labelEN: "Preparation & development" },
  { code: "300", level: 1, label: "Bauwerk – Baukonstruktionen", labelEN: "Building – construction" },
  { code: "400", level: 1, label: "Bauwerk – Technische Anlagen", labelEN: "Building – technical services" },
  { code: "500", level: 1, label: "Außenanlagen", labelEN: "External works" },
  { code: "600", level: 1, label: "Ausstattung und Kunst", labelEN: "Furnishings & art" },
  { code: "700", level: 1, label: "Nebenkosten des Bauens", labelEN: "Ancillary building costs" },
];

/* Level-2 & -3 detail for the cost-bearing groups (300/400) and 500/700 */
export const DIN276_L23: Kostengruppe[] = [
  // KG 300 — Baukonstruktionen
  { code: "310", level: 2, label: "Baugrund, Gründung", labelEN: "Substructure & foundation" },
  { code: "320", level: 2, label: "Außenwände", labelEN: "External walls" },
  { code: "330", level: 2, label: "Tragkonstruktion, Geschossdecken", labelEN: "Load-bearing structure & floor slabs" },
  { code: "340", level: 2, label: "Dach, Bauwerksabschlussflächen nach außen", labelEN: "Roof & external closures" },
  { code: "350", level: 2, label: "Innenausbau, Innenräume", labelEN: "Interior fit-out" },
  { code: "360", level: 2, label: "Raumflächen, Fußböden", labelEN: "Internal surfaces & floor finishes" },

  // KG 400 — Technische Anlagen (building services / TGA)
  { code: "410", level: 2, label: "Abwasser, Wasser, Gas", labelEN: "Drainage, water & gas" },
  { code: "420", level: 2, label: "Wärmeversorgung", labelEN: "Heat supply" },
  { code: "430", level: 2, label: "Lufttechnische Anlagen", labelEN: "Ventilation & air-conditioning" },
  { code: "440", level: 2, label: "Stromversorgung", labelEN: "Electrical power" },
  { code: "450", level: 2, label: "Informations- und Kommunikationstechnik", labelEN: "Information & communication" },
  { code: "460", level: 2, label: "Förderanlagen", labelEN: "Lifts & conveyors" },
  { code: "470", level: 2, label: "Nutzungsspezifische Anlagen", labelEN: "Use-specific systems" },
  { code: "480", level: 2, label: "Gebäudeautomation, MSR", labelEN: "Building automation & control" },

  // KG 500 — Außenanlagen
  { code: "510", level: 2, label: "Erschließung des Grundstücks", labelEN: "Plot servicing" },
  { code: "520", level: 2, label: "Freianlagen, Außenräume", labelEN: "Outdoor spaces & landscaping" },
  { code: "530", level: 2, label: "Pflanzungen, Begrünung", labelEN: "Planting & greening" },

  // KG 700 — Nebenkosten
  { code: "710", level: 2, label: "Baugrundstück, Grundstückswert", labelEN: "Land value" },
  { code: "720", level: 2, label: "Erschließung, Außenanlagen-Nebenkosten", labelEN: "Servicing ancillary costs" },
  { code: "730", level: 2, label: "Baunebenkosten – Honorare, Bauleitung", labelEN: "Design fees & construction management" },
  { code: "740", level: 2, label: "Finanzierung, Kapitalkosten", labelEN: "Financing & capital costs" },
  { code: "750", level: 2, label: "Allgemeine Nebenkosten, Untersuchungen", labelEN: "General ancillary & investigations" },
];

export const DIN276_FULL: Kostengruppe[] = [...DIN276_L1, ...DIN276_L23];

export function kgLabel(code: string): Kostengruppe | undefined {
  return DIN276_FULL.find((k) => k.code === code);
}

/* Typical sub-distribution (share within a level-1 group) — Narchi market defaults. */
export const KG300_DISTRIBUTION: Record<string, number> = {
  "310": 0.08, "320": 0.19, "330": 0.17, "340": 0.13, "350": 0.26, "360": 0.17,
};
export const KG400_DISTRIBUTION: Record<string, number> = {
  "410": 0.08, "420": 0.10, "430": 0.16, "440": 0.22, "450": 0.06, "460": 0.12, "470": 0.18, "480": 0.08,
};
export const KG500_DISTRIBUTION: Record<string, number> = {
  "510": 0.30, "520": 0.45, "530": 0.25,
};
export const KG700_DISTRIBUTION: Record<string, number> = {
  "710": 0.0, "720": 0.05, "730": 0.74, "740": 0.13, "750": 0.08,
};
