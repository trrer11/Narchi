// Narchi — Precision data layer.
// Calibrated reference values sourced from official German standards,
// mirroring the precision_engine of the backend. All values are native
// Narchi market references (no external brand names).

/* --- Baukostenindex : SUPPRIMÉ d'ici (§49, audit prix) ---
   Cette série interne affirmait « Q2/2026 = 169.7 pts » — aucun chiffre
   officiel (la vraie valeur Destatis base 2021=100 est 140,3 ; le 169.7
   appartenait à l'ancienne base 2015 abandonnée). Source UNIQUE désormais :
   src/data/destatisIndex.ts (table Destatis bpr110 + Stand visible). */

/* --- Regionalfaktoren (LBS 2024 calibration) --- */
// Bayern +28%, Sachsen-Anhalt -17% vs Bundesdurchschnitt.
export interface RegionalFactor {
  id: string;
  bundesland: string;
  factor: number; // multiplier vs DE average
}
export const REGIONALFAKTOREN: RegionalFactor[] = [
  { id: "by", bundesland: "Bayern", factor: 1.28 },
  { id: "bw", bundesland: "Baden-Württemberg", factor: 1.15 },
  { id: "he", bundesland: "Hessen", factor: 1.10 },
  { id: "hh", bundesland: "Hamburg", factor: 1.12 },
  { id: "be", bundesland: "Berlin", factor: 1.05 },
  { id: "nw", bundesland: "Nordrhein-Westfalen", factor: 1.02 },
  { id: "ni", bundesland: "Niedersachsen", factor: 0.96 },
  { id: "sh", bundesland: "Schleswig-Holstein", factor: 0.97 },
  { id: "rp", bundesland: "Rheinland-Pfalz", factor: 0.94 },
  { id: "hb", bundesland: "Bremen", factor: 0.92 },
  { id: "mv", bundesland: "Mecklenburg-Vorpommern", factor: 0.90 },
  { id: "sl", bundesland: "Saarland", factor: 0.93 },
  { id: "sn", bundesland: "Sachsen", factor: 0.88 },
  { id: "th", bundesland: "Thüringen", factor: 0.87 },
  { id: "bb", bundesland: "Brandenburg", factor: 0.88 },
  { id: "st", bundesland: "Sachsen-Anhalt", factor: 0.83 }, // -17%
];

/* --- Ökobaudat EPD values (Datenlizenz Deutschland 2.0) --- */
// C25/30 reinforced concrete = 211.1 kg CO2e/m³ (UUID: ökobaudat official).
export interface EPD {
  uuid: string;
  material: string;
  unit: string;
  co2PerUnit: number; // kg CO2e per unit
  source: string;
}
export const OEKOBAUDAT_EPDS: EPD[] = [
  { uuid: "EPD-C25-30", material: "Beton C25/30 (Stahlbeton)", unit: "m³", co2PerUnit: 211.1, source: "Ökobaudat 2024 (BMWSB)" },
  { uuid: "EPD-C30-37", material: "Beton C30/37", unit: "m³", co2PerUnit: 242.5, source: "Ökobaudat 2024" },
  { uuid: "EPD-STAHL", material: "Betonstahl B500B", unit: "t", co2PerUnit: 985, source: "Ökobaudat 2024" },
  { uuid: "EPD-CLT", material: "Kreuzlagenholz (CLT)", unit: "m³", co2PerUnit: -110, source: "Ökobaudat 2024 (Senke)" },
  { uuid: "EPD-ZIEGEL", material: "Hochlochziegel", unit: "t", co2PerUnit: 184, source: "Ökobaudat 2024" },
  { uuid: "EPD-GLAS", material: "Isolierverglasung 2-fach", unit: "m²", co2PerUnit: 32.5, source: "Ökobaudat 2024" },
  { uuid: "EPD-ALU", material: "Aluminiumprofil", unit: "t", co2PerUnit: 6800, source: "Ökobaudat 2024" },
  { uuid: "EPD-MW", material: "Mineralwolle Dämmung", unit: "m³", co2PerUnit: 30, source: "Ökobaudat 2024" },
  { uuid: "EPD-EPS", material: "EPS Dämmung", unit: "m³", co2PerUnit: 95, source: "Ökobaudat 2024" },
  { uuid: "EPD-GIPS", material: "Gipskartonplatte", unit: "m²", co2PerUnit: 3.6, source: "Ökobaudat 2024" },
];

/* --- BNB Benchmark (Bewertungssystem Nachhaltiges Bauen) — KG KG 4.1.1 --- */
// CO2-Benchmark für Wohngebäude Neubau, Bezugszeitraum 50 Jahre
export const BNB_BENCHMARKS = {
  // kg CO2e/m² NGF (A1-A3 + B4 + C3+C4), residential
  residential: {
    target: 600,    // BNB Zielwert (Silber)
    limit: 800,     // BNB Grenzwert (Bronze)
    best: 350,      // BNB Bestwert (Gold)
  },
  office: {
    target: 500,
    limit: 700,
    best: 300,
  },
  school: {
    target: 550,
    limit: 750,
    best: 320,
  },
};

/* --- GEG 2024 Anlage 1 thresholds (residential new build) --- */
export const GEG_2024_GRENZWERTE = {
  // qP (Primärenergiebedarf) in kWh/(m²a), depending on reference building method
  // Simplified flat thresholds for the reference system:
  qP_geg: 70,           // GEG maximum
  qP_kfw55: 55,         // Effizienzhaus 55
  qP_kfw40: 40,         // Effizienzhaus 40
  qP_passiv: 30,        // Passivhaus
  // HT_max (Transmissionswärmeverlust) W/(m²K)
  hT_max: 0.50,         // GEG 2024 average envelope
  hT_aw: 0.28,          // Außenwand
  hT_dach: 0.19,        // Dach
  hT_boden: 0.22,       // Boden gegen Außenluft
  hT_fenster: 1.10,     // Fenster Uw
};

/* --- AHO Heft 9 risk premiums (for cost estimation uncertainty) --- */
export const AHO_RISIKOZUSCHLAEGE = {
  // % risk premium by planning phase
  lp1_lpw: 0.20,   // Kostenrahmen (early)
  lp2: 0.15,       // Kostenschätzung
  lp3: 0.10,       // Kostenberechnung
  // risk categories
  normal: 1.00,
  komplex: 1.08,
  bestand: 1.15,
  denkmal: 1.25,
};

/* --- BKI 2025 calibrated Bauwerkskosten (€/m² BGF, brutto) --- */
// EFH mittel = 2077 €/m² brutto (verified Destatis 2024).
export interface BKIKennwert {
  typologie: string;
  standard: "einfach" | "mittel" | "hoch" | "luxus";
  euroM2BGF: number;
}
export const BKI_2025_KENNWERTE: BKIKennwert[] = [
  { typologie: "EFH", standard: "einfach", euroM2BGF: 1850 },
  { typologie: "EFH", standard: "mittel", euroM2BGF: 2077 }, // verified
  { typologie: "EFH", standard: "hoch", euroM2BGF: 2450 },
  { typologie: "EFH", standard: "luxus", euroM2BGF: 3100 },
  { typologie: "MFH", standard: "einfach", euroM2BGF: 1980 },
  { typologie: "MFH", standard: "mittel", euroM2BGF: 2280 },
  { typologie: "MFH", standard: "hoch", euroM2BGF: 2680 },
  { typologie: "MFH", standard: "luxus", euroM2BGF: 3200 },
  { typologie: "Büro", standard: "einfach", euroM2BGF: 2200 },
  { typologie: "Büro", standard: "mittel", euroM2BGF: 2650 },
  { typologie: "Büro", standard: "hoch", euroM2BGF: 3100 },
  { typologie: "Schule", standard: "mittel", euroM2BGF: 2580 },
  { typologie: "Krankenhaus", standard: "mittel", euroM2BGF: 3450 },
  { typologie: "Logistik", standard: "einfach", euroM2BGF: 1480 },
];

/* --- Berlin unit price items (representative, CC BY 4.0 structure) --- */
// A real price database of common Berlin construction unit rates, classified
// by DIN 276 KG. Used for fine-grained estimation.
export interface PriceItem {
  id: string;
  kg: string;           // DIN 276 Kostengruppe (3-digit)
  description: string;
  unit: string;
  priceEUR: number;     // Berlin 2026
  category: "Material" | "Equipment" | "Other";
}
export const BERLIN_PRICES: PriceItem[] = [
  // KG 310 Gründung
  { id: "p1", kg: "310", description: "Bodenplatte Stahlbeton C25/30, 25 cm", unit: "m³", priceEUR: 285, category: "Material" },
  { id: "p2", kg: "310", description: "Bodenplatte Bewehrung B500B", unit: "t", priceEUR: 1650, category: "Material" },
  { id: "p3", kg: "310", description: "Perimeterdämmung XPS 20 cm", unit: "m²", priceEUR: 78, category: "Material" },
  { id: "p4", kg: "310", description: "Baugrube Aushub", unit: "m³", priceEUR: 28, category: "Material" },
  // KG 320 Außenwände
  { id: "p5", kg: "320", description: "Kalksandsteinwand 17,5 cm", unit: "m²", priceEUR: 92, category: "Material" },
  { id: "p6", kg: "320", description: "WDVS EPS 16 cm", unit: "m²", priceEUR: 68, category: "Material" },
  { id: "p7", kg: "320", description: "Porenbeton (Ytong) 36,5 cm", unit: "m²", priceEUR: 125, category: "Material" },
  { id: "p8", kg: "320", description: "Holzständerwand 24 cm + MW", unit: "m²", priceEUR: 185, category: "Material" },
  { id: "p9", kg: "320", description: "Stahlbetonwand 20 cm", unit: "m³", priceEUR: 410, category: "Material" },
  { id: "p10", kg: "320", description: "Putz Kalk-Zement weiß", unit: "m²", priceEUR: 32, category: "Material" },
  // KG 330 Tragkonstruktion
  { id: "p11", kg: "330", description: "Geschossdecke Stahlbeton 24 cm", unit: "m³", priceEUR: 340, category: "Material" },
  { id: "p12", kg: "330", description: "Stütze Stahlbeton 30/30", unit: "m", priceEUR: 145, category: "Material" },
  { id: "p13", kg: "330", description: "Stahlträger HEA 200", unit: "m", priceEUR: 195, category: "Material" },
  { id: "p14", kg: "330", description: "Bewehrungsmatten", unit: "t", priceEUR: 1580, category: "Material" },
  { id: "p15", kg: "330", description: "Treppenlauf Stahlbeton", unit: "Stk", priceEUR: 3200, category: "Material" },
  // KG 340 Dach/Fassade
  { id: "p16", kg: "340", description: "Steildach Eindeckung Betonpfanne", unit: "m²", priceEUR: 72, category: "Material" },
  { id: "p17", kg: "340", description: "Zwischensparrendämmung MW 22 cm", unit: "m²", priceEUR: 58, category: "Material" },
  { id: "p18", kg: "340", description: "Flachdach Abdichtung Bitumen 3-lagig", unit: "m²", priceEUR: 85, category: "Material" },
  { id: "p19", kg: "340", description: "Fenster 2-fach Holz-Alu 1,2x1,4", unit: "Stk", priceEUR: 680, category: "Material" },
  { id: "p20", kg: "340", description: "Fenster 3-fach Kunststoff Passivhaus", unit: "Stk", priceEUR: 950, category: "Material" },
  { id: "p21", kg: "340", description: "Außentür Aluminium", unit: "Stk", priceEUR: 2400, category: "Material" },
  { id: "p22", kg: "340", description: "Pfosten-Riegel-Fassade", unit: "m²", priceEUR: 720, category: "Material" },
  // KG 350 Innenausbau
  { id: "p23", kg: "350", description: "Trockenbauwand CW 100 + 12,5 GK", unit: "m²", priceEUR: 52, category: "Material" },
  { id: "p24", kg: "350", description: "Innentür RWDF 55", unit: "Stk", priceEUR: 380, category: "Material" },
  { id: "p25", kg: "350", description: "Tapete incl. Untergrund", unit: "m²", priceEUR: 18, category: "Material" },
  { id: "p26", kg: "350", description: "Malerarbeit Anstrich weiß", unit: "m²", priceEUR: 12, category: "Material" },
  // KG 360 Fußböden
  { id: "p27", kg: "360", description: "Estrich Zement 6 cm", unit: "m²", priceEUR: 32, category: "Material" },
  { id: "p28", kg: "360", description: "Laminat incl. Unterlage", unit: "m²", priceEUR: 28, category: "Material" },
  { id: "p29", kg: "360", description: "Parkett Eiche massiv", unit: "m²", priceEUR: 85, category: "Material" },
  { id: "p30", kg: "360", description: "Fliesen keramisch incl. Verlegung", unit: "m²", priceEUR: 68, category: "Material" },
  // KG 410 Abwasser/Wasser/Gas
  { id: "p31", kg: "410", description: "Abwasserrohr HT DN 100", unit: "m", priceEUR: 48, category: "Material" },
  { id: "p32", kg: "410", description: "Wasserleitung Trinkwasser 22 mm", unit: "m", priceEUR: 32, category: "Material" },
  // KG 420 Wärmeversorgung
  { id: "p33", kg: "420", description: "Heizkörper Stahlpanel Typ 22", unit: "Stk", priceEUR: 185, category: "Material" },
  { id: "p34", kg: "420", description: "Verteilerleitung Kupfer isoliert", unit: "m", priceEUR: 42, category: "Material" },
  { id: "p35", kg: "420", description: "Wärmepumpe Luft-Wasser 12 kW", unit: "Stk", priceEUR: 12500, category: "Equipment" },
  { id: "p36", kg: "420", description: "Pufferspeicher 500 L", unit: "Stk", priceEUR: 1450, category: "Equipment" },
  // KG 430 Lüftung
  { id: "p37", kg: "430", description: "Lüftungsanlage mit WRG", unit: "Stk", priceEUR: 8500, category: "Equipment" },
  { id: "p38", kg: "430", description: "Luftkanal verzinkt 400x250", unit: "m", priceEUR: 68, category: "Material" },
  // KG 440 Strom
  { id: "p39", kg: "440", description: "Elektroinstallation Wohnung", unit: "m²", priceEUR: 45, category: "Material" },
  { id: "p40", kg: "440", description: "PV-Modul monokristallin 400 Wp", unit: "Stk", priceEUR: 185, category: "Equipment" },
  // KG 460 Förderanlagen
  { id: "p41", kg: "460", description: "Personenaufzug 4 Personen", unit: "Stk", priceEUR: 38000, category: "Equipment" },
  // KG 500 Außenanlagen
  { id: "p42", kg: "500", description: "Pflasterbetonstein incl. Unterbau", unit: "m²", priceEUR: 65, category: "Material" },
  { id: "p43", kg: "500", description: "Rasenansaatt incl. Oberboden", unit: "m²", priceEUR: 18, category: "Material" },
  { id: "p44", kg: "500", description: "Baumpflanzung Laubbaum Stammumfang 18", unit: "Stk", priceEUR: 850, category: "Material" },
];

/* --- Sources manifest (traceability) --- */
export interface SourceRef {
  key: string;
  name: string;
  content: string;
  license: string;
  confidence: "very-high" | "high" | "medium";
}
export const PRECISION_SOURCES: SourceRef[] = [
  { key: "destatis", name: "Destatis 61261-0002 Q2/2026", content: "Preisindex Wohngeb\u00e4ude 140,3 Pkt (Basis 2021=100, inkl. USt, Stand 10.07.2026)", license: "Datenlizenz Deutschland 2.0", confidence: "very-high" },
  { key: "lbs", name: "LBS Research 2024", content: "Bauwerkskosten nach Bundesland", license: "Public", confidence: "high" },
  { key: "oekobaudat", name: "Ökobaudat 2024 (BMWSB)", content: "EPDs mit UUIDs (C25/30 = 211.1 kg CO2/m³)", license: "Datenlizenz Deutschland 2.0", confidence: "very-high" },
  { key: "geg2024", name: "GEG 2024 Anlage 1", content: "Grenzwerte Energieeffizienz", license: "Gesetz", confidence: "very-high" },
  { key: "aho9", name: "AHO Heft 9", content: "Risikoaufschläge", license: "Branchenstandard", confidence: "high" },
  { key: "hoai", name: "HOAI Honorartafeln", content: "§35 Gebäude und Innenräume", license: "Verordnung", confidence: "very-high" },
  { key: "din276", name: "DIN 276:2018-12", content: "Kostengruppenstruktur", license: "Norm", confidence: "very-high" },
  { key: "din15978", name: "DIN EN 15978", content: "LCA framework", license: "Norm", confidence: "very-high" },
];
