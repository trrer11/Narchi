// Narchi — Clash-Radar & Bauteil-QC engines.
// Solves the coordination pain: clashes buried in disconnected clash reports,
// screenshots and hand-offs. And the manual-review pain: hundreds of building
// components checked by hand. Narchi automates both — natively.

import { storage } from "@/utils/localStore";

/* ============== CLASH-RADAR ============== */
export type ClashType = "geometrisch" | "raum" | "typ-konflikt" | "hoehen";
export type ClashStatus = "neu" | "zugeordnet" | "in-bearbeitung" | "geloest" | "ignoriert";

export interface Clash {
  id: string;
  type: ClashType;
  status: ClashStatus;
  elementA: string;  // z.B. "Luftkanal L-204"
  elementB: string;  // z.B. "Träger T-04"
  disciplines: [string, string];
  level: string;
  severity: "critical" | "major" | "minor";
  description: string;
  suggestion: string;
  assignee?: string;
  createdAt: string;
}

const CLASH_KEY = "narchi:clashes";

export const CLASH_TYPE_META: Record<ClashType, { label: string; icon: string; color: string }> = {
  geometrisch: { label: "Geometrische Kollision", icon: "cube", color: "#f43f5e" },
  raum: { label: "Raumkonflikt", icon: "building", color: "#f59e0b" },
  "typ-konflikt": { label: "Typ-Konflikt", icon: "layers", color: "#a78bfa" },
  hoehen: { label: "Höhenkonflikt", icon: "scale", color: "#22d3ee" },
};

export const CLASH_STATUS_META: Record<ClashStatus, { label: string; tone: string }> = {
  neu: { label: "Neu", tone: "rose" },
  zugeordnet: { label: "Zugeordnet", tone: "amber" },
  "in-bearbeitung": { label: "In Bearbeitung", tone: "cyan" },
  geloest: { label: "Gelöst", tone: "emerald" },
  ignoriert: { label: "Ignoriert", tone: "slate" },
};

function load<T>(k: string, f: T): T {
  return storage.get<T>(k, f);
}
function save<T>(k: string, v: T) {
  storage.set(k, v);
  try {
    localStorage.setItem("narchi:clash:tick", String(Date.now()));
  } catch {
    /* ignore */
  }
}

export const SEED_CLASHES: Clash[] = [
  { id: "cl-1", type: "geometrisch", status: "neu", elementA: "Luftkanal L-204", elementB: "Abfangträger T-04", disciplines: ["TGA-Lüftung", "Tragwerk"], level: "L-01", severity: "critical", description: "Rechteckiger Luftkanal 400×250 durchdringt den Stahlträger T-04 im Achsenfeld B/3.", suggestion: "Kanal unterhalb des Trägers führen (Deckenhöhe −8 cm) oder Durchbruch mit Statiker abstimmen.", assignee: "R. Tariq", createdAt: "2026-01-14T08:00:00Z" },
  { id: "cl-2", type: "hoehen", status: "zugeordnet", elementA: "Deckenleuchte DL-12", elementB: "Tragwerk Decke D-EG", disciplines: ["Elektro", "Tragwerk"], level: "L-00", severity: "major", description: "Einbauleuchte kreuzt Bewehrungslage der Decke.", suggestion: "Leuchte um 40 cm verschieben oder Auslässe im Bewehrungsplan vorsehen.", assignee: "A. Moreau", createdAt: "2026-01-14T08:30:00Z" },
  { id: "cl-3", type: "raum", status: "in-bearbeitung", elementA: "Technikraum TR-01", elementB: "Raumprogramm", disciplines: ["TGA", "Architektur"], level: "K-01", severity: "major", description: "Technikraum 6,2 m² — benötigt für Wärmepumpe + Puffer: ≥ 9 m².", suggestion: "Technikraum an Baugrundgrenze erweitern oder Gerät teilen.", assignee: "L. Kovač", createdAt: "2026-01-13T10:00:00Z" },
  { id: "cl-4", type: "geometrisch", status: "geloest", elementA: "Abwasserleitung A-08", elementB: "Bodenplatte", disciplines: ["TGA-Sanitär", "Tragwerk"], level: "K-01", severity: "minor", description: "Leitungsdurchdringung nicht in Achse — Versatz im Mauerwerk.", suggestion: "Durchbruch in Wandebene versetzt, statisch unkritisch.", assignee: "R. Tariq", createdAt: "2026-01-12T12:00:00Z" },
  { id: "cl-5", type: "typ-konflikt", status: "neu", elementA: "Fenster F-12", elementB: "Stütze S-03", disciplines: ["Architektur", "Tragwerk"], level: "L-02", severity: "critical", description: "Fenstersturz überdeckt Stützenachse — kein Auflager für Riegel.", suggestion: "Fensterbreite −30 cm oder Achse um 50 cm verschieben.", createdAt: "2026-01-14T09:15:00Z" },
  { id: "cl-6", type: "raum", status: "zugeordnet", elementA: "Schacht LTG-01", elementB: "Treppenlauf", disciplines: ["TGA", "Architektur"], level: "L-01", severity: "major", description: "Installationsschacht 30×40 überlappt Treppenlauf — lichte Höhe < 2,10 m.", suggestion: "Schacht an Treppenhauswand verschieben.", assignee: "A. Moreau", createdAt: "2026-01-13T15:00:00Z" },
  { id: "cl-7", type: "geometrisch", status: "ignoriert", elementA: "Kabelpritsche KP-03", elementB: "Sprinklerleitung", disciplines: ["Elektro", "TGA"], level: "L-02", severity: "minor", description: "Pritsche und Sprinkler auf gleicher Höhe, aber verschiedene Ebenen.", suggestion: "Toleranzzone ≥ 5 cm eingehalten — kein Konflikt.", createdAt: "2026-01-11T09:00:00Z" },
];

/** §241 — kein Demo. Seed-IDs werden einmal entfernt. */
export function listClashes(): Clash[] {
  const stored = load<Clash[]>(CLASH_KEY, []);
  const seedIds = new Set(SEED_CLASHES.map((s) => s.id));
  const cleaned = stored.filter((c) => !seedIds.has(c.id));
  if (cleaned.length !== stored.length) save(CLASH_KEY, cleaned);
  return cleaned;
}
export function saveClashes(c: Clash[]) { save(CLASH_KEY, c); }

export function setClashStatus(id: string, status: ClashStatus) {
  const all = listClashes();
  const c = all.find((x) => x.id === id);
  if (c) { c.status = status; saveClashes(all); }
}

export function assignClash(id: string, assignee: string) {
  const all = listClashes();
  const c = all.find((x) => x.id === id);
  if (c) { c.assignee = assignee; if (c.status === "neu") c.status = "zugeordnet"; saveClashes(all); }
}

export interface ClashSummary {
  total: number;
  critical: number;
  open: number;
  resolved: number;
  byDiscipline: Record<string, number>;
}

export function clashSummary(): ClashSummary {
  const all = listClashes();
  const byDiscipline: Record<string, number> = {};
  for (const c of all) for (const d of c.disciplines) byDiscipline[d] = (byDiscipline[d] ?? 0) + 1;
  return {
    total: all.length,
    critical: all.filter((c) => c.severity === "critical" && c.status !== "geloest" && c.status !== "ignoriert").length,
    open: all.filter((c) => c.status === "neu" || c.status === "zugeordnet" || c.status === "in-bearbeitung").length,
    resolved: all.filter((c) => c.status === "geloest").length,
    byDiscipline,
  };
}

export function subscribeClash(cb: () => void): () => void {
  let last = localStorage.getItem("narchi:clash:tick") ?? "";
  const onStorage = (e: StorageEvent) => { if (e.key === CLASH_KEY || e.key === "narchi:clash:tick") cb(); };
  const iv = setInterval(() => { const t = localStorage.getItem("narchi:clash:tick") ?? ""; if (t !== last) { last = t; cb(); } }, 1500);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener("storage", onStorage); clearInterval(iv); };
}

/* ============== BAUTEIL-QC (auto checks) ============== */
// Solves "I reviewed 400 doors and it makes me hate everyone" — auto-flags issues.

export interface QcRule {
  id: string;
  name: string;
  category: "Türen" | "Fenster" | "Treppen" | "Räume";
  appliesTo: string;     // element type
  rule: string;          // human-readable
  passed: boolean;
  /** false = propriété absente du IFC — jamais « conforme » silencieux */
  measurable: boolean;
  affected: number;
  severity: "critical" | "major" | "minor";
}

/** Generate deterministic QC findings for the active element set. */
export function runBauteilQC(elements: Array<{ type: string; status: string; conflicts: number; properties: Array<{ key: string; value: string }> }>): QcRule[] {
  const rules: QcRule[] = [];
  const doors = elements.filter((e) => /Door/i.test(e.type));
  const windows = elements.filter((e) => /Window/i.test(e.type));
  const stairs = elements.filter((e) => /Stair|Treppe/i.test(e.type));
  const modeled = elements.filter((e) => e.status === "modeled");
  const conflicts = elements.filter((e) => e.conflicts > 0);

  // fire rating check
  const fireMeasured = doors.filter((d) => d.properties.some((p) => /fire|brand/i.test(p.key) && p.value && p.value !== "—"));
  const doorsNoFire = doors.filter((d) => !d.properties.some((p) => /fire|brand/i.test(p.key) && p.value && p.value !== "—")).length;
  rules.push({
    id: "qc-fire", name: "Feuerschutzabschlüsse mit BS-Klassifizierung", category: "Türen",
    appliesTo: "Türen",
    rule: fireMeasured.length === 0
      ? (doors.length ? `${doors.length} Tür(en) — Brandschutzklasse nicht im IFC. Nicht geraten.` : "Keine Türen.")
      : `Jede Tür im Fluchtweg braucht eine Brandschutzklasse (DIN 4102). ${doorsNoFire} ohne Angabe.`,
    passed: fireMeasured.length === 0 ? false : doorsNoFire === 0,
    measurable: fireMeasured.length > 0,
    affected: fireMeasured.length === 0 ? 0 : doorsNoFire,
    severity: "critical",
  });

  // Ohne gemessene Eigenschaften: nicht prüfbar — nicht raten.
  rules.push({
    id: "qc-swing", name: "Türöffnungsrichtung in Fluchtwegen", category: "Türen",
    appliesTo: "Türen",
    rule: doors.length
      ? `${doors.length} Tür(en) — Öffnungsrichtung nicht im Modell gemessen. Keine Erfindung.`
      : "Keine Türen im Modell.",
    passed: false, measurable: false, affected: 0, severity: "major",
  });

  rules.push({
    id: "qc-fall", name: "Absturzsicherung bei Fenstern < 1,10 m Brüstung", category: "Fenster",
    appliesTo: "Fenster",
    rule: windows.length
      ? `${windows.length} Fenster — Brüstungshöhe nicht im Modell gemessen. Keine Erfindung.`
      : "Keine Fenster im Modell.",
    passed: false, measurable: false, affected: 0, severity: "major",
  });

  rules.push({
    id: "qc-stair", name: "Treppenlauf-Stufen geometrisch (3S+2A = 0,59–0,65 m)", category: "Treppen",
    appliesTo: "Treppen",
    rule: stairs.length
      ? `${stairs.length} Treppe(n) — Steigung/Auftritt nicht gemessen. Keine Erfindung.`
      : "Keine Treppe im Modell.",
    passed: false, measurable: false, affected: 0, severity: "major",
  });

  // modeled but not validated
  rules.push({
    id: "qc-modeled", name: "Bauteile validiert (nicht nur modelliert)", category: "Räume",
    appliesTo: "Alle", rule: `${modeled.length} Bauteile sind nur modelliert, noch nicht geprüft.`,
    passed: modeled.length === 0, measurable: elements.length > 0, affected: modeled.length, severity: "minor",
  });

  // conflict resolution
  rules.push({
    id: "qc-conflict", name: "Offene Bauteil-Konflikte", category: "Räume",
    appliesTo: "Alle", rule: `${conflicts.length} Bauteile mit ungelösten Konflikten.`,
    passed: conflicts.length === 0, measurable: elements.length > 0, affected: conflicts.length, severity: "critical",
  });

  return rules;
}

export interface QcSummary {
  total: number;
  passed: number;
  failed: number;
  critical: number;
  score: number; // 0..100
}
export function qcSummary(rules: QcRule[]): QcSummary {
  const measurable = rules.filter((r) => r.measurable);
  const total = measurable.length;
  const passed = measurable.filter((r) => r.passed).length;
  const failed = measurable.filter((r) => !r.passed).length;
  const critical = measurable.filter((r) => !r.passed && r.severity === "critical").length;
  return { total, passed, failed, critical, score: total ? Math.round((passed / total) * 100) : 0 };
}
