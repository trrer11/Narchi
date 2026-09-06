import { describe, expect, it } from "vitest";
import { anrechenbareAusKg300400 } from "./hoaiAnrechenbar";

describe("§225 anrechenbare Kosten aus DIN 276", () => {
  it("summiert KG 300 + 400 und rundet", () => {
    expect(anrechenbareAusKg300400(1_000_000.4, 250_000.4)).toBe(1_250_001);
  });

  it("0 wenn nichts da — kein 8,9-Mio-Theater", () => {
    expect(anrechenbareAusKg300400(0, 0)).toBe(0);
    expect(anrechenbareAusKg300400(Number.NaN, 10)).toBe(10);
  });
});
