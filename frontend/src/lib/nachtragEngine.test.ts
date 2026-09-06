/** §176 — Nachtragsmanagement : le delta d'honoraires + la Begründung. */
import { describe, expect, it } from "vitest";

import { buildNachtrag } from "@/lib/nachtragEngine";
import { calcHoai } from "@/lib/hoaiEngine";

const base = {
  baseKosten: 2_000_000,
  deltaKosten: 200_000,
  honorarzone: 3,
  zusatzId: "none",
  modeId: "reference",
  leistungsphasen: [3, 5],
  beschreibung: "Ausbau des Dachbodens zu Wohnraum",
  grund: "aenderungswunsch",
} as const;

describe("buildNachtrag (§176)", () => {
  it("delta honorar == calcHoai(base+delta) − calcHoai(base)", () => {
    const n = buildNachtrag(base);
    const hBase = calcHoai({
      anrechenbareKosten: 2_000_000, honorarzone: 3, zusatzId: "none", modeId: "reference",
    });
    const hNeu = calcHoai({
      anrechenbareKosten: 2_200_000, honorarzone: 3, zusatzId: "none", modeId: "reference",
    });
    expect(n.honorarBase).toBeCloseTo(hBase.total, 2);
    expect(n.honorarNeu).toBeCloseTo(hNeu.total, 2);
    expect(n.deltaHonorarNetto).toBeCloseTo(hNeu.total - hBase.total, 2);
  });

  it("brut = netto × 1,19 (HALF_UP, jamais de banker's)", () => {
    const n = buildNachtrag(base);
    expect(n.deltaHonorarBrutto).toBeCloseTo(n.deltaHonorarNetto * 1.19, 2);
  });

  it("delta positif quand les coûts augmentent (le scope creep est PAYÉ)", () => {
    const n = buildNachtrag(base);
    expect(n.deltaHonorarNetto).toBeGreaterThan(0);
    expect(n.deltaPct).toBeGreaterThan(0);
  });

  it("part des Leistungsphasen = somme des satz touchées", () => {
    // LP 3 = 11 % + LP 5 = 25 % → 36 %
    const n = buildNachtrag(base);
    expect(n.phasenAnteilPct).toBeCloseTo(36, 1);
    expect(n.phasenNamen).toEqual(["LP 3 Entwurfsplanung", "LP 5 Ausführungsplanung"]);
  });

  it("Begründung contient les éléments de preuve (coûts, phases, montant)", () => {
    const n = buildNachtrag(base);
    expect(n.begruendung).toContain("Änderungswunsch");
    expect(n.begruendung).toContain("Ausbau des Dachbodens");
    expect(n.begruendung).toContain("LP 3 Entwurfsplanung");
    expect(n.begruendung).toContain("LP 5 Ausführungsplanung");
    expect(n.begruendung).toContain("netto");
    expect(n.begruendung).toContain("rechtlich zu prüfen"); // honnête
  });

  it("chaque grund a son libellé propre", () => {
    for (const grund of ["aenderungswunsch", "planungsaenderung", "zusatzleistung", "stoerung"] as const) {
      const n = buildNachtrag({ ...base, grund });
      expect(n.begruendung).toContain(grund === "aenderungswunsch" ? "Änderungswunsch" : grund === "planungsaenderung" ? "Planungsänderung" : grund === "zusatzleistung" ? "Zusätzliche Leistung" : "Behinderung");
    }
  });
});
