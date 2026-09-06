// Narchi — regional & country configuration.
// Germany (DE) is the active market; the structure is built to expand to
// further jurisdictions (each with its own standards framework & benchmarks).

export type StandardsFramework = "DIN 276" | "SIA CrB" | "DTU/AFNOR" | "ÖNORM B 1801";

export interface CountryConfig {
  code: "DE" | "FR" | "CH" | "AT";
  name: string;
  flag: string;
  currency: "EUR" | "CHF";
  locale: string;
  vatRate: number; // standard VAT (USt / MwSt)
  framework: StandardsFramework;
  areaBasis: "NGF" | "NFS" | "SIA";
  active: boolean;
  status: "active" | "soon";
  docsRef: string;
}

export const COUNTRIES: CountryConfig[] = [
  { code: "DE", name: "Deutschland", flag: "🇩🇪", currency: "EUR", locale: "de-DE", vatRate: 0.19, framework: "DIN 276", areaBasis: "NGF", active: true, status: "active", docsRef: "DIN 276-1:2008-12 · DIN 277-1:2016-01" },
  { code: "AT", name: "Österreich", flag: "🇦🇹", currency: "EUR", locale: "de-AT", vatRate: 0.20, framework: "ÖNORM B 1801", areaBasis: "NFS", active: false, status: "soon", docsRef: "ÖNORM B 1801-2 · DIN 276 übertragbar" },
  { code: "CH", name: "Schweiz", flag: "🇨🇭", currency: "CHF", locale: "de-CH", vatRate: 0.081, framework: "SIA CrB", areaBasis: "NFS", active: false, status: "soon", docsRef: "SIA 416 · CrB Kostengliederung" },
  { code: "FR", name: "France", flag: "🇫🇷", currency: "EUR", locale: "fr-FR", vatRate: 0.20, framework: "DTU/AFNOR", areaBasis: "NGF", active: false, status: "soon", docsRef: "NF P 01-020 · DTU 41.1" },
];

export function activeCountry(): CountryConfig {
  return COUNTRIES.find((c) => c.active) ?? COUNTRIES[0];
}

export function countryByCode(code: string): CountryConfig {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];
}

/* --- German regional cost factors (Narchi market index) --- */
export interface RegionConfig {
  id: string;
  name: string;
  country: "DE";
  factor: number; // multiplier vs. German average
}

export const DE_REGIONS: RegionConfig[] = [
  { id: "de-muc", name: "München / Südbayern", country: "DE", factor: 1.18 },
  { id: "de-stg", name: "Stuttgart / Baden-Württemberg", country: "DE", factor: 1.13 },
  { id: "de-fra", name: "Frankfurt / Rhein-Main", country: "DE", factor: 1.12 },
  { id: "de-ham", name: "Hamburg / Norddeutschland", country: "DE", factor: 1.08 },
  { id: "de-ber", name: "Berlin", country: "DE", factor: 1.06 },
  { id: "de-rvr", name: "Köln / Düsseldorf / Ruhrgebiet", country: "DE", factor: 1.03 },
  { id: "de-han", name: "Hannover / Niedersachsen", country: "DE", factor: 1.0 },
  { id: "de-nue", name: "Nürnberg / Nordbayern", country: "DE", factor: 1.04 },
  { id: "de-lej", name: "Leipzig / Dresden / Sachsen", country: "DE", factor: 0.95 },
  { id: "de-kie", name: "Kiel / Schleswig-Holstein", country: "DE", factor: 0.99 },
];

/* --- Quality standards (Ausstattungsstandard) --- */
export interface QualityConfig {
  id: string;
  name: string;
  factor: number;
  description: string;
}

export const QUALITY_STANDARDS: QualityConfig[] = [
  { id: "einfach", name: "Einfach", factor: 0.88, description: "Funktional, Mindeststandard, zweckmäßig" },
  { id: "standard", name: "Standard", factor: 1.0, description: "Mittlere Ausführung, DIN-gerechter Regelstandard" },
  { id: "gehoben", name: "Gehoben", factor: 1.15, description: "Überdurchschnittliche Qualität und Materialien" },
  { id: "hochwertig", name: "Hochwertig", factor: 1.32, description: "Premium, repräsentativ, hochwertige Details" },
];

/* --- Construction cost index (Baukostenindex) for year adjustment --- */
// §49 — UNE SEULE source : Destatis base 2021 = 100 (src/data/destatisIndex.ts,
// table officielle bpr110, Stand visible). Fini la série interne « 142/147/151 »
// qui divergeait de l'officiel et la valeur mock « 169.7 ».
// COST_INDEX est DÉRIVÉ de la série trimestrielle officielle — ne jamais
// éditer à la main : mettre à jour uniquement destatisIndex.ts.
import { YEARLY_INDEX, yearFactorFor } from "@/data/destatisIndex";

export const COST_INDEX: Record<number, number> = { ...YEARLY_INDEX };

/* --- Bauweise (construction type) — affects KG 300 --- */
export interface BauweiseConfig {
  id: string;
  name: string;
  factor: number; // multiplier on KG 300
  desc: string;
}

export const BAUWEISEN: BauweiseConfig[] = [
  { id: "massiv", name: "Massivbau (Beton / Mauerwerk)", factor: 1.0, desc: "Konventionelle Massivbauweise, Standard" },
  { id: "holz", name: "Holzbau (Holzständer / CLT)", factor: 1.09, desc: "Hybrider Holz- bzw. CLT-Bau, schneller aber teurer" },
  { id: "stahl", name: "Stahl-Skelettbau", factor: 1.05, desc: "Stahltragwerk für Industrie / Büro" },
  { id: "fertig", name: "Fertigteilbau", factor: 0.93, desc: "Vorgefertigte Elemente, industrielle Fertigung" },
];

export function bauweiseById(id: string): BauweiseConfig {
  return BAUWEISEN.find((b) => b.id === id) ?? BAUWEISEN[0];
}

/* --- Energiestandard — affects KG 320/340/420/430 --- */
export interface EnergieStandardConfig {
  id: string;
  name: string;
  factor: number; // multiplier on KG 300+400
  desc: string;
}

export const ENERGIESTANDARDS: EnergieStandardConfig[] = [
  { id: "geg", name: "GEG-Standard", factor: 1.0, desc: "Erfüllt Gebäudeenergiegesetz Mindestanforderung" },
  { id: "kfw55", name: "Effizienzhaus 55 (KfW)", factor: 1.04, desc: "Förderfähiger Standard, verbesserte Hülle + Lüftung" },
  { id: "kfw40", name: "Effizienzhaus 40 (KfW)", factor: 1.09, desc: "Hoher Dämmstandard, kontrollierte Lüftung, WP" },
  { id: "passiv", name: "Passivhaus", factor: 1.16, desc: "Sehr hoher Dämmstandard, Wärmerückgewinnung" },
];

export function energiestandardById(id: string): EnergieStandardConfig {
  return ENERGIESTANDARDS.find((e) => e.id === id) ?? ENERGIESTANDARDS[0];
}

/** §49 — délègue à la source officielle unique (Destatis base 2021 = 100). */
export function yearFactor(year: number, base = 2024): number {
  return yearFactorFor(base, year);
}
