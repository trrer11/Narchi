import { describe, expect, it } from "vitest";
import { calcHoai } from "./hoaiEngine";
import { buildHoaiPdfPlain } from "./hoaiHonorarPdf";

describe("HOAI-PDF §270", () => {
  const at = new Date("2026-08-26T12:00:00+02:00");

  it("0 anrechenbar bleibt 0 im Motor-Input", () => {
    const r = calcHoai({ anrechenbareKosten: 0, honorarzone: 3, zusatzId: "none", modeId: "reference" });
    expect(r.input.anrechenbareKosten).toBe(0);
    const text = buildHoaiPdfPlain(r, { projectName: "Testbau", generatedAt: at });
    expect(text).toContain("Tafel nicht gültig");
    expect(text).toMatch(/Netto: 0,00\s€/);
    expect(text).toContain("Testbau");
    expect(text).not.toMatch(/1,00\s€/);
  });

  it("gültige Tafel nennt Netto und LP 1–8", () => {
    const r = calcHoai({ anrechenbareKosten: 1_000_000, honorarzone: 3, zusatzId: "none", modeId: "reference" });
    const text = buildHoaiPdfPlain(r, { projectName: "EFH", generatedAt: at });
    expect(text).toContain("Tafel gültig");
    expect(text).toContain("LP 1 Grundlagenermittlung");
    expect(text).toContain("ohne LP 9");
    expect(text).toContain("EFH");
  });
});
