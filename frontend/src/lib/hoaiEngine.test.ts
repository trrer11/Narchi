import { describe, expect, it } from "vitest";
import { calcHoai } from "./hoaiEngine";
import { HOAI_TAFEL } from "@/data/hoai";

describe("calcHoai §270", () => {
  it("0 € bleibt 0 — kein stilles 1 €, kein Tafelhonorar", () => {
    const r = calcHoai({ anrechenbareKosten: 0, honorarzone: 3, zusatzId: "none", modeId: "reference" });
    expect(r.input.anrechenbareKosten).toBe(0);
    expect(r.orientierungGueltig).toBe(false);
    expect(r.total).toBe(0);
    expect(r.mwst).toBe(0);
    expect(r.brutto).toBe(0);
    expect(r.zonenHonorar.every((n) => n === 0)).toBe(true);
    expect(r.phases.every((p) => p.betrag === 0)).toBe(true);
  });

  it("negativ wie 0", () => {
    const r = calcHoai({ anrechenbareKosten: -10, honorarzone: 3, zusatzId: "none", modeId: "reference" });
    expect(r.orientierungGueltig).toBe(false);
    expect(r.total).toBe(0);
  });

  it("Tafelpunkt 1 000 000 € Zone III = exakter Tafelwert", () => {
    const r = calcHoai({ anrechenbareKosten: 1_000_000, honorarzone: 3, zusatzId: "none", modeId: "reference" });
    const row = HOAI_TAFEL.find((x) => x.kosten === 1_000_000)!;
    expect(r.orientierungGueltig).toBe(true);
    expect(Math.round(r.honorar)).toBe(row.zonen[2]);
    expect(Math.round(r.total)).toBe(row.zonen[2]);
    const sumLp = r.phases.reduce((s, p) => s + p.satz, 0);
    expect(sumLp).toBeCloseTo(1, 8);
  });

  it("Zone I < Zone III < Zone V", () => {
    const a = calcHoai({ anrechenbareKosten: 2_000_000, honorarzone: 1, zusatzId: "none", modeId: "reference" });
    const c = calcHoai({ anrechenbareKosten: 2_000_000, honorarzone: 3, zusatzId: "none", modeId: "reference" });
    const e = calcHoai({ anrechenbareKosten: 2_000_000, honorarzone: 5, zusatzId: "none", modeId: "reference" });
    expect(a.total).toBeLessThan(c.total);
    expect(c.total).toBeLessThan(e.total);
  });
});
