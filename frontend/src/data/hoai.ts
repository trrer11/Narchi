// Narchi — HOAI Honorartafel (Leistungsbild Gebäude und Innenräume, §34).
// These are the Honorartafeln as defined in the HOAI 2013 — which remain, in 2026,
// the single industry-standard REFERENCE for fee benchmarks in Germany.
// Legal context (Stand 2026): the binding statutory minimum and maximum fees
// (verbindliche Mindest-/Höchstsätze) were abolished following the CJEU ruling
// and the subsequent Bauvertragsreform. Free fee negotiation is now ESTABLISHED
// market practice. Narchi therefore calculates the reference honorar AND offers a
// free-negotiation mode (Verhandlungsbasis) around the table value.
export const HOAI_LEGAL_NOTE =
  "Stand 2026: Die verbindlichen HOAI-Mindest- und Höchstsätze sind seit der EuGH-Rechtsprechung und der Bauvertragsreform entfallen — die freie Honorarvereinbarung ist heute etablierte Marktpraxis. Die Honorartafeln bleiben jedoch der branchenübliche Vergleichs- und Verhandlungsmaßstab. Die hier berechneten Werte sind eine fundierte Verhandlungsorientierung.";

export interface HonorarMode {
  id: string;
  name: string;
  factor: number;
  desc: string;
}
export const HONORAR_MODEN: HonorarMode[] = [
  { id: "reference", name: "Referenz (Honorartafel)", factor: 1.0, desc: "Branchenüblicher Vergleichswert nach Honorartafel" },
  { id: "freelow", name: "Freie Vereinbarung (−15 %)", factor: 0.85, desc: "Unterer Verhandlungsspielraum — heute gängige Praxis" },
  { id: "premium", name: "Premium (+20 %)", factor: 1.2, desc: "Hochwertige Sonderleistung, frei verhandelbar" },
];

export interface HonorarRow {
  kosten: number; // anrechenbare Kosten (€), upper bound of bracket
  zonen: number[]; // [HZ I, HZ II, HZ III, HZ IV, HZ V] honorar in €
}

/* Honorartafel "Gebäude und Innenräume" (HOAI 2013, §34) */
export const HOAI_TAFEL: HonorarRow[] = [
  { kosten: 25_000, zonen: [1237, 1488, 1774, 2098, 2473] },
  { kosten: 50_000, zonen: [2090, 2510, 2989, 3530, 4159] },
  { kosten: 75_000, zonen: [2858, 3430, 4081, 4816, 5671] },
  { kosten: 100_000, zonen: [3566, 4278, 5093, 6010, 7081] },
  { kosten: 250_000, zonen: [6458, 7743, 9216, 10877, 12806] },
  { kosten: 500_000, zonen: [10693, 12812, 15243, 17989, 21163] },
  { kosten: 1_000_000, zonen: [17353, 20769, 24676, 29106, 34225] },
  { kosten: 2_000_000, zonen: [28228, 33713, 39996, 47166, 55449] },
  { kosten: 3_000_000, zonen: [36797, 43925, 52060, 61381, 72153] },
  { kosten: 5_000_000, zonen: [52143, 62220, 73705, 86898, 102134] },
  { kosten: 10_000_000, zonen: [84605, 100902, 119555, 140944, 165641] },
  { kosten: 20_000_000, zonen: [137461, 163884, 194181, 228873, 268972] },
  { kosten: 50_000_000, zonen: [263000, 313000, 371000, 437000, 514000] },
];

/* Leistungsphasen (Anlage 10, Gebäude und Innenräume) — Honorarsatz % of total */
export interface Leistungsphase {
  nr: number;
  name: string;
  satz: number; // %
  desc: string;
}

export const LEISTUNGSPHASEN: Leistungsphase[] = [
  { nr: 1, name: "Grundlagenermittlung", satz: 0.03, desc: "Ermittlung der Anforderungen, Vorgaben" },
  { nr: 2, name: "Vorplanung", satz: 0.07, desc: "Planungsvarianten, Kostenrahmen" },
  { nr: 3, name: "Entwurfsplanung", satz: 0.11, desc: "Genehmigungsfähiger Entwurf" },
  { nr: 4, name: "Genehmigungsplanung", satz: 0.06, desc: "Einreichung, Behörden" },
  { nr: 5, name: "Ausführungsplanung", satz: 0.25, desc: "Detail- und Werkplanung" },
  { nr: 6, name: "Vorbereitung der Vergabe", satz: 0.10, desc: "Ausschreibungen, Mengenermittlung" },
  { nr: 7, name: "Mitwirkung bei der Vergabe", satz: 0.08, desc: "Angebotsprüfung, Wertung" },
  { nr: 8, name: "Objektüberwachung", satz: 0.30, desc: "Bauüberwachung, Dokumentation" },
];

export const HONORARZONEN = [
  { zone: 1, name: "Sehr geringe Anforderungen", factor: 0.5 },
  { zone: 2, name: "Geringe Anforderungen", factor: 0.7 },
  { zone: 3, name: "Mittlere Anforderungen", factor: 1.0 },
  { zone: 4, name: "Hohe Anforderungen", factor: 1.3 },
  { zone: 5, name: "Sehr hohe Anforderungen", factor: 1.6 },
];

export interface HonorarZusatz {
  id: string;
  name: string;
  factor: number;
  desc: string;
}

/* Übliche Honorarzuschläge */
export const HONORARZUSAETZE: HonorarZusatz[] = [
  { id: "none", name: "Kein Zuschlag", factor: 1.0, desc: "Regelleistung" },
  { id: "bestand", name: "Bestand / Denkmal", factor: 1.15, desc: "Schwierige Bauaufgabe im Bestand" },
  { id: "nachhaltig", name: "Nachhaltigkeit (DGNB/BNB)", factor: 1.10, desc: "Zertifizierungsmitwirkung" },
  { id: "bim", name: "BIM-Mitwirkung", factor: 1.08, desc: "Digitale Planung, Modellpflege" },
];
