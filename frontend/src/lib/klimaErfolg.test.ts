/** §172 — Klima-Erfolg : équivalences + cumul + jalons (pur, testé). */
import { describe, expect, it } from "vitest";

import {
  computeEquivalences,
  getKlimaTotals,
  recordCo2Saved,
  reachedMilestones,
} from "@/lib/klimaErfolg";

function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe("computeEquivalences (§172)", () => {
  it("convertit les kg en équivalences Richtwert", () => {
    const e = computeEquivalences(600);
    expect(e.trees).toBeCloseTo(600 / 20, 6);
    expect(e.carKm).toBeCloseTo(600 / 0.15, 6);
    expect(e.flights).toBeCloseTo(600 / 150, 6);
  });
  it("zéro ou négatif → zéro partout (jamais de négatif)", () => {
    expect(computeEquivalences(0).flights).toBe(0);
    expect(computeEquivalences(-5).trees).toBe(0);
  });
});

describe("recordCo2Saved / getKlimaTotals (§172)", () => {
  it("cumule et compte les records", () => {
    const s = memStorage();
    expect(getKlimaTotals(s)).toEqual({ totalKg: 0, records: 0 });
    recordCo2Saved(1000, s);
    recordCo2Saved(500, s);
    expect(getKlimaTotals(s)).toEqual({ totalKg: 1500, records: 2 });
  });
  it("valeur invalide → aucun effet (jamais de NaN)", () => {
    const s = memStorage();
    recordCo2Saved(NaN, s);
    recordCo2Saved(-3, s);
    expect(getKlimaTotals(s)).toEqual({ totalKg: 0, records: 0 });
  });
  it("stockage absent → lecture nulle, jamais d'erreur", () => {
    expect(getKlimaTotals(null)).toEqual({ totalKg: 0, records: 0 });
    expect(recordCo2Saved(500, null)).toEqual({ totalKg: 500, records: 1 });
    expect(getKlimaTotals(null)).toEqual({ totalKg: 0, records: 0 });
  });
});

describe("reachedMilestones (§172)", () => {
  it("jalons franchis par le total cumulé", () => {
    expect(reachedMilestones(0)).toEqual([]);
    expect(reachedMilestones(1_000).map((m) => m.id)).toEqual(["klima_1t"]);
    expect(reachedMilestones(10_000).map((m) => m.id)).toEqual(["klima_1t", "klima_5t", "klima_10t"]);
    expect(reachedMilestones(50_000).length).toBe(4);
  });
});
