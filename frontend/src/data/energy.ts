// Narchi — German building-physics & regulation data.
// Real DWD-based climates, DIN 4108 / EnEV envelope U-values,
// heating systems with primary-energy factors, and GEG 2024 thresholds.

export interface Climate {
  id: string;
  name: string;
  temp: number[]; // monthly average outdoor temp [°C], Jan..Dec
  rad: number[]; // monthly solar radiation on south vertical [kWh/m²]
  gradtagszahl: number; // Kd (heating degree days, ref 20/12)
}

export const CLIMATES: Climate[] = [
  { id: "cl-muc", name: "München (Bayern)", gradtagszahl: 3900, temp: [-1.5, -0.3, 3.4, 7.6, 12.4, 15.5, 17.3, 16.6, 12.8, 7.8, 2.9, -0.6], rad: [42, 58, 78, 82, 90, 86, 88, 94, 94, 82, 50, 34] },
  { id: "cl-ham", name: "Hamburg (Nord)", gradtagszahl: 3456, temp: [1.0, 1.2, 4.2, 8.1, 12.3, 15.2, 17.1, 16.9, 13.5, 9.2, 5.0, 2.0], rad: [28, 48, 76, 96, 124, 132, 120, 104, 78, 54, 32, 22] },
  { id: "cl-ber", name: "Berlin", gradtagszahl: 3390, temp: [-0.1, 0.4, 3.8, 8.1, 12.9, 16.1, 18.0, 17.5, 13.6, 8.8, 4.2, 0.8], rad: [30, 50, 78, 98, 126, 134, 122, 106, 80, 56, 34, 24] },
  { id: "cl-kol", name: "Köln (NRW)", gradtagszahl: 3186, temp: [1.6, 2.1, 5.2, 8.9, 13.0, 16.0, 17.9, 17.5, 14.1, 9.8, 5.4, 2.5], rad: [32, 52, 80, 96, 120, 128, 118, 102, 80, 56, 34, 24] },
  { id: "cl-fra", name: "Frankfurt (Rhein-Main)", gradtagszahl: 3372, temp: [0.4, 1.1, 4.6, 8.7, 13.2, 16.4, 18.3, 17.7, 13.8, 9.2, 4.9, 1.6], rad: [34, 54, 82, 98, 124, 132, 122, 104, 80, 56, 34, 24] },
  { id: "cl-stg", name: "Stuttgart (BaWü)", gradtagszahl: 3622, temp: [-0.4, 0.4, 4.0, 8.2, 12.7, 15.8, 17.5, 16.9, 13.2, 8.5, 3.9, 0.3], rad: [44, 60, 82, 86, 92, 96, 98, 96, 88, 74, 48, 38] },
  { id: "cl-lej", name: "Leipzig (Sachsen)", gradtagszahl: 3575, temp: [-0.5, 0.0, 3.6, 7.9, 12.6, 15.7, 17.6, 17.1, 13.2, 8.5, 3.9, 0.3], rad: [32, 52, 80, 100, 128, 136, 124, 108, 82, 58, 34, 24] },
  { id: "cl-han", name: "Hannover (Nds.)", gradtagszahl: 3410, temp: [0.6, 1.0, 4.2, 8.2, 12.6, 15.6, 17.5, 17.1, 13.5, 9.0, 4.6, 1.2], rad: [30, 50, 78, 98, 126, 132, 120, 104, 80, 56, 34, 24] },
];

export function climateById(id: string): Climate {
  return CLIMATES.find((c) => c.id === id) ?? CLIMATES[0];
}

/* --- Envelope assemblies (Bauteile) with real U-Werte [W/(m²K)] --- */
export interface Bauteil {
  id: string;
  group: "Außenwand" | "Dach" | "Fenster" | "Boden";
  name: string;
  u: number; // W/(m²K)
  desc: string;
  standard: "GEG" | "KfW55" | "KfW40";
}

export const BAUTEILE: Bauteil[] = [
  // Außenwand
  { id: "aw-ks-eps", group: "Außenwand", name: "KS-Mauerwerk + 16 cm EPS", u: 0.24, desc: "Kalksandstein massiv, WDVS, Standardausführung", standard: "GEG" },
  { id: "aw-ks-eps20", group: "Außenwand", name: "KS-Mauerwerk + 20 cm EPS", u: 0.19, desc: "Massiv, WDVS, verbessert nach GEG", standard: "GEG" },
  { id: "aw-holz", group: "Außenwand", name: "Holzständer 24 cm + Mineralwolle", u: 0.17, desc: "Holzbau, hochgedämmt", standard: "KfW55" },
  { id: "aw-poroterm", group: "Außenwand", name: "Porenbeton (Ytong) 36,5 cm", u: 0.27, desc: "Monolithisch, mineralisch", standard: "GEG" },
  { id: "aw-holz-super", group: "Außenwand", name: "Holzständer 32 cm + Holzfaser", u: 0.13, desc: "Passivhaus-Standard, Holzbau", standard: "KfW40" },
  // Dach
  { id: "d-steil", group: "Dach", name: "Steildach 22 cm Mineralwolle", u: 0.17, desc: "Zwischensparrendämmung", standard: "GEG" },
  { id: "d-flach", group: "Dach", name: "Flachdach 24 cm PIR", u: 0.14, desc: "Aufdachdämmung PIR", standard: "KfW55" },
  { id: "d-auf", group: "Dach", name: "Aufsparren 28 cm Mineralwolle", u: 0.12, desc: "Holzdach, Passivhaus", standard: "KfW40" },
  // Fenster
  { id: "f-2isg", group: "Fenster", name: "2-fach Wärmeschutzglas (Holz)", u: 1.10, desc: "Uw, Standardfenster", standard: "GEG" },
  { id: "f-3isg", group: "Fenster", name: "3-fach Wärmeschutzglas (KfW40)", u: 0.70, desc: "Uw, hochwärmedämmend", standard: "KfW40" },
  { id: "f-alu", group: "Fenster", name: "Alu 2-fach m. therm. Trennung", u: 1.30, desc: "Uw, Aluminium", standard: "GEG" },
  // Boden / Kellerdecke
  { id: "b-platte", group: "Boden", name: "Bodenplatte 20 cm XPS", u: 0.20, desc: "Perimeterdämmung, Bodenplatte", standard: "GEG" },
  { id: "b-keller", group: "Boden", name: "Kellerdecke 18 cm EPS", u: 0.18, desc: "Unterseitig gedämmt", standard: "KfW55" },
];

export function bauteileByGroup(group: Bauteil["group"]): Bauteil[] {
  return BAUTEILE.filter((b) => b.group === group);
}

/* --- Heating systems (Wärmeerzeuger) --- */
export interface Heizsystem {
  id: string;
  name: string;
  eta: number; // Jahresnutzungsgrad / Arbeitszahl (SPF for heat pumps)
  fPE: number; // Primärenergiefaktor
  fPE_strom: boolean;
  co2: number; // gCO2/kWh (Endenergie)
  desc: string;
}

export const HEIZSYSTEME: Heizsystem[] = [
  { id: "h-gas", name: "Gaskessel (Brennwert)", eta: 1.02, fPE: 1.10, fPE_strom: false, co2: 200, desc: "Gas-Brennwert, fossiler Brennstoff" },
  { id: "h-lw", name: "Wärmepumpe Luft-Wasser", eta: 3.5, fPE: 1.80, fPE_strom: true, co2: 110, desc: "elektrisch, JAZ ≈ 3,5" },
  { id: "h-sw", name: "Wärmepumpe Sole-Wasser", eta: 4.5, fPE: 1.80, fPE_strom: true, co2: 85, desc: "Erdwärme, JAZ ≈ 4,5" },
  { id: "h-fern", name: "Fernwärme (KWK)", eta: 1.00, fPE: 0.70, fPE_strom: false, co2: 130, desc: "Fernwärme, Netzauslegung" },
  { id: "h-pellet", name: "Holzpellets", eta: 0.85, fPE: 0.20, fPE_strom: false, co2: 25, desc: "erneuerbar, Biomasse" },
];

export function heizsystemById(id: string): Heizsystem {
  return HEIZSYSTEME.find((h) => h.id === id) ?? HEIZSYSTEME[0];
}

/* --- Building mass (thermische Speicherfähigkeit) --- */
export const MASS_CLASS = [
  { id: "leicht", name: "Leichtbau (Holz)", cEff: 50 },
  { id: "mittel", name: "Mittelschwer", cEff: 90 },
  { id: "schwer", name: "Schwer (Massiv)", cEff: 130 },
] as const;

export function massById(id: string) {
  return MASS_CLASS.find((m) => m.id === id) ?? MASS_CLASS[1];
}

/* --- Window orientations (solar gain factor vs south vertical) --- */
export const ORIENTATIONS = [
  { id: "sued", name: "Süd", factor: 1.0 },
  { id: "so-sw", name: "Südost / Südwest", factor: 0.82 },
  { id: "ost-west", name: "Ost / West", factor: 0.66 },
  { id: "nord", name: "Nord", factor: 0.45 },
];

export function orientationById(id: string) {
  return ORIENTATIONS.find((o) => o.id === id) ?? ORIENTATIONS[0];
}

/* --- GEG 2024 thresholds (Neubau Wohngebäude) --- */
export interface GegThreshold {
  id: string;
  name: string;
  peb: number; // kWh/(m²a) Primärenergie
  tone: "emerald" | "amber" | "rose";
}
export const GEG_THRESHOLDS: GegThreshold[] = [
  { id: "kfw40", name: "KfW 40 (Beststandard)", peb: 40, tone: "emerald" },
  { id: "kfw55", name: "Effizienzhaus 55 / GEG-konform", peb: 55, tone: "amber" },
  { id: "geg70", name: "GEG Grenzwert", peb: 70, tone: "rose" },
];

export const MONTHS_DE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
export const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
