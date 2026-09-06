import { describe, expect, it } from "vitest";
import { factsToPrompt, packOfficeChunks, retrieveFacts, tokenize } from "./iqRetrieve";

describe("iqRetrieve §252", () => {
  const chunks = packOfficeChunks({
    projectName: "EFH Hannover",
    ngf: 180,
    ngfQuelle: "messung",
    bauteile: 42,
    sourceLabel: "IFC",
    toolAnswer: "Honorar nach HOAI 12.000 € netto.",
    toolRows: [{ label: "Zone III", value: "12.000 €" }],
  });

  it("tokenisiert ohne Stoppwörter", () => {
    expect(tokenize("Was ist die NGF des Projekts")).toContain("ngf");
    expect(tokenize("Was ist die NGF des Projekts")).not.toContain("die");
  });

  it("holt NGF-Chunk bei Frage NGF", () => {
    const got = retrieveFacts("Wie groß ist die NGF?", chunks);
    expect(got[0].id).toBe("ngf");
  });

  it("holt Honorar-Chunk bei Frage Honorar", () => {
    const got = retrieveFacts("Welches Honorar?", chunks);
    expect(got.some((c) => c.text.includes("HOAI"))).toBe(true);
  });

  it("ohne Treffer: erste Fakten, nicht leer erfinden", () => {
    const got = retrieveFacts("xyzzy-kein-treffer", chunks, 2);
    expect(got.length).toBeGreaterThan(0);
    expect(got.length).toBeLessThanOrEqual(3);
  });

  it("Prompt enthält nur gelieferte Texte", () => {
    const p = factsToPrompt(chunks.slice(0, 1));
    expect(p).toContain("EFH Hannover");
    expect(p).not.toContain("erfund");
  });
});
