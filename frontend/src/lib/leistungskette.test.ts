import { describe, expect, it } from "vitest";
import { baueLeistungskette, ngfLabor } from "@/lib/leistungskette";

describe("Leistungskette §240", () => {
  it("alles leer bleibt leer", () => {
    const k = baueLeistungskette({
      bauteile: 0, ngf: 0, dinNetto: 0, hoaiAnrechenbar: 0, hoaiNetto: 0, gegTfa: 0, rechnungenMitProjekt: 0,
    });
    expect(k.every((s) => s.status === "leer")).toBe(true);
  });

  it("IfcSpace-NGF = Messung", () => {
    const k = baueLeistungskette({
      bauteile: 12, ngf: 420, ngfQuelle: "messung", dinNetto: 1_000_000,
      hoaiAnrechenbar: 0, hoaiNetto: 0, gegTfa: 0, rechnungenMitProjekt: 0,
    });
    expect(k[0].status).toBe("messung");
    expect(k[1].status).toBe("messung");
    expect(k[2].status).toBe("leer");
  });

  it("Labor: 0 bleibt 0, +10 % auf echte NGF", () => {
    expect(ngfLabor(0, 10)).toBe(0);
    expect(ngfLabor(100, 10)).toBe(110);
    expect(ngfLabor(100, -10)).toBe(90);
  });
});
