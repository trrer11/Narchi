// Tests des scénarios de coûts : instantané, persistance localStorage et
// calcul d'écart Soll/Ist par Kostengruppe.

import { beforeEach, describe, expect, it } from "vitest";
import type { QuickEstimateResponse } from "@/lib/quickEstimate";
import {
  SCENARIO_LIMIT,
  SCENARIO_STORAGE_KEY,
  diffEstimates,
  loadScenarios,
  removeScenario,
  saveScenario,
  snapshotFromEstimate,
  type EstimateSnapshot,
} from "@/lib/estimateScenarios";

function estimate(overrides: Partial<QuickEstimateResponse> = {}): QuickEstimateResponse {
  return {
    region: "de_ni",
    lines: [
      {
        kostengruppe: "kg320_rohbau_waende",
        titel: "Tragende Wände (Rohbau)",
        menge: 100,
        einheit: "m³",
        einheitspreis_netto: 177.1,
        gesamt_netto: 17_710,
        anzahl_elemente: 12,
        beispiele: ["AW Stahlbeton 24cm"],
      },
      {
        kostengruppe: "kg340_decken",
        titel: "Decken und Stützen",
        menge: 50,
        einheit: "m²",
        einheitspreis_netto: 99,
        gesamt_netto: 4_950,
        anzahl_elemente: 4,
        beispiele: ["Decke Stahlbeton"],
      },
    ],
    totals: { netto: 22_660, ust_satz: 19, ust: 4_305.4, brutto: 26_965.4, kosten_pro_m2: 283.25 },
    range: { low: 19_487.6, high: 25_832.4, assumption: "±14 %" },
    score: { value: 90, grade: "A", mapping_coverage: 1, quantity_coverage: 1, avg_confidence: 0.9 },
    element_count: 16,
    warnings: [],
    ...overrides,
  } as QuickEstimateResponse;
}

describe("snapshotFromEstimate", () => {
  it("projette les positions et totaux netto/brutto", () => {
    const snap = snapshotFromEstimate(estimate(), "Variante A", new Date("2026-08-05T12:00:00Z"));
    expect(snap.label).toBe("Variante A");
    expect(snap.netto).toBe(22_660);
    expect(snap.brutto).toBe(26_965.4);
    expect(snap.lines).toHaveLength(2);
    expect(snap.lines[0]).toMatchObject({ kostengruppe: "kg320_rohbau_waende", gesamt_netto: 17_710 });
    expect(snap.id).toMatch(/^sz-/);
  });

  it("libellé vide → libellé automatique", () => {
    const snap = snapshotFromEstimate(estimate(), "   ");
    expect(snap.label).toMatch(/^Szenario /);
  });
});

describe("persistance localStorage", () => {
  beforeEach(() => localStorage.removeItem(SCENARIO_STORAGE_KEY));

  it("aller-retour sauvegarde → chargement", () => {
    const snap = snapshotFromEstimate(estimate(), "A");
    saveScenario(snap);
    expect(loadScenarios()).toHaveLength(1);
    expect(loadScenarios()[0].label).toBe("A");
  });

  it(`plafond de ${SCENARIO_LIMIT} scénarios, plus récent d'abord`, () => {
    for (let i = 0; i < SCENARIO_LIMIT + 2; i++) {
      saveScenario(snapshotFromEstimate(estimate(), `S${i}`, new Date(2026, 7, i + 1)));
    }
    const list = loadScenarios();
    expect(list).toHaveLength(SCENARIO_LIMIT);
    expect(list[0].label).toBe(`S${SCENARIO_LIMIT + 1}`);
  });

  it("removeScenario retire l'entrée", () => {
    const snap = snapshotFromEstimate(estimate(), "A");
    saveScenario(snap);
    expect(removeScenario(snap.id)).toHaveLength(0);
    expect(loadScenarios()).toHaveLength(0);
  });

  it("JSON corrompu → liste vide sans exception", () => {
    localStorage.setItem(SCENARIO_STORAGE_KEY, "{kaputt");
    expect(loadScenarios()).toEqual([]);
  });
});

describe("diffEstimates", () => {
  const basis: EstimateSnapshot = snapshotFromEstimate(estimate(), "Basis");

  it("écart position modifiée (delta + pourcentage)", () => {
    const vergleich = snapshotFromEstimate(
      estimate({
        lines: [
          { ...estimate().lines[0], gesamt_netto: 20_000 },
          { ...estimate().lines[1], gesamt_netto: 4_950 },
        ],
        totals: { ...estimate().totals, netto: 24_950 },
      } as Partial<QuickEstimateResponse>),
      "Vergleich",
    );
    const diff = diffEstimates(basis, vergleich);
    const kg320 = diff.rows.find((r) => r.kostengruppe === "kg320_rohbau_waende");
    expect(kg320).toMatchObject({ status: "changed", delta: 2_290 });
    expect(kg320!.deltaProzent).toBeCloseTo(12.93, 2);
    const kg340 = diff.rows.find((r) => r.kostengruppe === "kg340_decken");
    expect(kg340!.status).toBe("same");
    expect(diff.totalDelta).toBe(2_290);
    expect(diff.totalDeltaProzent).toBeCloseTo(10.11, 2);
  });

  it("position ajoutée et position supprimée", () => {
    const vergleich = snapshotFromEstimate(
      estimate({
        lines: [
          estimate().lines[0],
          {
            kostengruppe: "kg500_aussenanlagen",
            titel: "Außenanlagen",
            menge: 1,
            einheit: "psch",
            einheitspreis_netto: 900,
            gesamt_netto: 900,
            anzahl_elemente: 1,
            beispiele: [],
          },
        ],
        totals: { ...estimate().totals, netto: 18_610 },
      } as Partial<QuickEstimateResponse>),
      "Vergleich",
    );
    const diff = diffEstimates(basis, vergleich);
    const added = diff.rows.find((r) => r.kostengruppe === "kg500_aussenanlagen");
    expect(added).toMatchObject({ status: "added", basis: null, vergleich: 900, delta: 900 });
    const removed = diff.rows.find((r) => r.kostengruppe === "kg340_decken");
    expect(removed).toMatchObject({ status: "removed", basis: 4_950, vergleich: null, delta: -4_950 });
  });

  it("base nulle → pourcentage null (pas de division par zéro)", () => {
    const zero: EstimateSnapshot = { ...basis, netto: 0, lines: [] };
    const vergleich = snapshotFromEstimate(estimate(), "Vergleich");
    const diff = diffEstimates(zero, vergleich);
    expect(diff.totalDeltaProzent).toBeNull();
    expect(diff.totalDelta).toBe(22_660);
  });
});
