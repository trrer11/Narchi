import { describe, expect, it } from "vitest";
import { calcEnergy } from "./energyEngine";
import { DEFAULT_ENERGY_CONFIG } from "@/store/LegacyDerivedSlice";

describe("§227 GEG ohne erfundene Fläche", () => {
  it("TFA 0 → keine m²-Kennwerte, kein KfW-Theater", () => {
    const r = calcEnergy({ ...DEFAULT_ENERGY_CONFIG, tfa: 0 });
    expect(r.areas.aWand).toBe(0);
    expect(r.areas.volumen).toBe(0);
    expect(r.HWB).toBe(0);
    expect(r.PEB).toBe(0);
    expect(r.gegStatus).toBe("fail");
    expect(r.gegLabel).toMatch(/Keine NGF/);
    expect(Number.isFinite(r.HWB)).toBe(true);
    expect(Number.isFinite(r.PEB)).toBe(true);
    expect(r.co2M2).toBe(0);
  });
});
