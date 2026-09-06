/**
 * Tests §93 — décisions PURES de l'export X83 : chemin exact et
 * encodé, paramètre projekt omis s'il est vide (jamais « &projekt= »
 * inutile), nom de repli sain quelle que soit la firme (accents,
 * symboles, vide) — le fichier de l'utilisateur porte un nom prévisible.
 */
import { describe, expect, it } from "vitest";
import { offerX83FallbackFilename, offerX83Path } from "./offerX83";

describe("offerX83Path", () => {
  it("sans projekt : pas de query du tout", () => {
    expect(offerX83Path("notiz-buero", "abc123")).toBe(
      "/api/v5/collab/notiz-buero/offers/abc123/gaeb.x83",
    );
    expect(offerX83Path("notiz-buero", "abc123", "   ")).toBe(
      "/api/v5/collab/notiz-buero/offers/abc123/gaeb.x83",
    );
  });

  it("room et offre sont encodés (espaces, slashs hostiles)", () => {
    expect(offerX83Path("notiz büro", "a/b")).toBe(
      "/api/v5/collab/notiz%20b%C3%BCro/offers/a%2Fb/gaeb.x83",
    );
  });

  it("projekt renseigné : encodé et borné à 256 caractères", () => {
    const p = offerX83Path("r", "o", "Wasserwerk Berlin");
    expect(p).toBe(
      "/api/v5/collab/r/offers/o/gaeb.x83?projekt=Wasserwerk+Berlin",
    );
    const long = "x".repeat(400);
    const query = offerX83Path("r", "o", long).split("projekt=")[1];
    expect(query.length).toBe(256);
  });
});

describe("offerX83FallbackFilename", () => {
  it("firme classique : slug sain, même règle que le serveur", () => {
    expect(offerX83FallbackFilename("Bauer GmbH")).toBe("angebot-Bauer-GmbH.x83");
    expect(offerX83FallbackFilename("Müller & Söhne")).toBe(
      "angebot-M-ller-S-hne.x83",
    );
  });

  it("firme sans aucun caractère sain : repli honnête, jamais hostile", () => {
    expect(offerX83FallbackFilename("///")).toBe("angebot-unternehmen.x83");
    expect(offerX83FallbackFilename("")).toBe("angebot-unternehmen.x83");
    expect(offerX83FallbackFilename("- Bau -")).toBe("angebot-Bau.x83");
  });
});
