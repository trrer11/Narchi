/**
 * Tests §95 — offre → Preisbibliothek : chemin encodé, mapping défensif
 * (null sur hostiles, jamais d'exception), message allemand exact avec
 * pluriels et détail honnête des 3 compteurs (übernommen / ersetzt /
 * übersprungen) — l'utilisateur lit ce qui s'est VRAIMENT passé.
 */
import { describe, expect, it } from "vitest";
import {
  libraryTakeoverOf,
  libraryTakeoverText,
  offerToLibraryPath,
} from "./offerLibrary";

describe("offerToLibraryPath", () => {
  it("encode room et identifiant d'offre", () => {
    expect(offerToLibraryPath("notiz-buero", "ab12")).toBe(
      "/api/v5/collab/notiz-buero/offers/ab12/to-library",
    );
    expect(offerToLibraryPath("raum x", "a/b")).toBe(
      "/api/v5/collab/raum%20x/offers/a%2Fb/to-library",
    );
  });
});

describe("libraryTakeoverOf", () => {
  it("§97 — compteur veraltet optionnel : absent → 0, hostile → null", () => {
    expect(
      libraryTakeoverOf({ inserted: 0, updated: 0, skipped: 0, preisstand_jahr: 2026,
                          skipped_veraltet: 2 }),
    ).toEqual({ inserted: 0, updated: 0, skipped: 0, preisstandJahr: 2026,
                skippedVeraltet: 2 });
    expect(
      libraryTakeoverOf({ inserted: 1, updated: 0, skipped: 0, preisstand_jahr: 2026,
                          skipped_veraltet: -1 }),
    ).toBeNull();
  });
  it("mapping nominal avec preisstand_jahr snake_case serveur", () => {
    expect(
      libraryTakeoverOf({ inserted: 3, updated: 2, skipped: 1, preisstand_jahr: 2026 }),
    ).toEqual({ inserted: 3, updated: 2, skipped: 1, preisstandJahr: 2026,
                 skippedVeraltet: 0 });
  });
  it("formes hostiles → null, jamais d'exception", () => {
    expect(libraryTakeoverOf(null)).toBeNull();
    expect(libraryTakeoverOf("boom")).toBeNull();
    expect(libraryTakeoverOf({ inserted: 1, updated: 0, skipped: 0 })).toBeNull();
    expect(
      libraryTakeoverOf({ inserted: -1, updated: 0, skipped: 0, preisstand_jahr: 2026 }),
    ).toBeNull();
    expect(
      libraryTakeoverOf({ inserted: 1, updated: 0, skipped: 0, preisstand_jahr: 800 }),
    ).toBeNull();
  });
});

describe("libraryTakeoverText", () => {
  it("premier apport : pluriels et Preisstand, aucun détail superflu", () => {
    expect(
      libraryTakeoverText({ inserted: 5, updated: 0, skipped: 0, preisstandJahr: 2026, skippedVeraltet: 0 }),
    ).toBe(
      "5 Positionen mit echten EP in die Preisbibliothek übernommen (Preisstand 2026). " +
      "Fortschreibung mit Destatis-Index wie bei allen Büropreisen.",
    );
  });
  it("mise à jour d'une ligne existante : singulier correct + ersetzt dit", () => {
    expect(
      libraryTakeoverText({ inserted: 0, updated: 1, skipped: 0, preisstandJahr: 2025, skippedVeraltet: 0 }),
    ).toContain("1 Position mit echten EP in die Preisbibliothek übernommen");
    expect(
      libraryTakeoverText({ inserted: 0, updated: 1, skipped: 0, preisstandJahr: 2025, skippedVeraltet: 0 }),
    ).toContain("1 vorhandener ersetzt");
    expect(
      libraryTakeoverText({ inserted: 0, updated: 1, skipped: 0, preisstandJahr: 2025, skippedVeraltet: 0 }),
    ).toContain("(Preisstand 2025)");
  });
  it("ohne EP compté — dit, jamais caché", () => {
    const text = libraryTakeoverText({ inserted: 2, updated: 1, skipped: 3, preisstandJahr: 2026, skippedVeraltet: 0 });
    expect(text).toContain("3 Positionen ohne EP übersprungen");
    expect(text).toContain("3 Positionen mit echten EP");
  });
  it("§97 — millésime trop ancien refusé : dit, avec la règle", () => {
    const text = libraryTakeoverText({ inserted: 0, updated: 0, skipped: 0, preisstandJahr: 2018, skippedVeraltet: 1 });
    expect(text).toContain("1 Position mit älterem Preisstand verworfen");
    expect(text).toContain("neuere bleiben");
    expect(libraryTakeoverText({ inserted: 3, updated: 0, skipped: 0, preisstandJahr: 2026, skippedVeraltet: 0 }))
      .not.toContain("verworfen");
  });
});
