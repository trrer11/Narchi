/** §91 — offres d'entreprises : décisions pures (mapping défensif). */
import { describe, expect, it } from "vitest";
import {
  eurFromCents,
  offerErrorMessage,
  offerItemOf,
  offerMetaOf,
} from "@/lib/offerClient";

describe("§91 — offerMetaOf défensif", () => {
  const VALID = {
    id: "abc123",
    company_name: "Bauer GmbH",
    filename: "angebot.x31",
    dp: "83",
    cur: "EUR",
    item_count: 42,
    ohne_preis_count: 3,
    gp_total_cents: 1234567,
    created_by_name: "Alice A",
    created_at: "2026-08-10T09:00:00Z",
  };

  it("mapping serpent→chameau complet", () => {
    expect(offerMetaOf(VALID)).toEqual({
      id: "abc123",
      companyName: "Bauer GmbH",
      filename: "angebot.x31",
      dp: "83",
      cur: "EUR",
      itemCount: 42,
      ohnePreisCount: 3,
      gpTotalCents: 1234567,
      createdByName: "Alice A",
      createdAt: "2026-08-10T09:00:00Z",
    });
  });

  it("hostiles : null/champs manquants/mauvais types → null, jamais d'exception", () => {
    expect(offerMetaOf(null)).toBeNull();
    expect(offerMetaOf("x")).toBeNull();
    expect(offerMetaOf({ ...VALID, id: 3 })).toBeNull();
    expect(offerMetaOf({ ...VALID, company_name: null })).toBeNull();
    expect(offerMetaOf({ ...VALID, item_count: "viele" })).toBeNull();
    expect(offerMetaOf({ ...VALID, gp_total_cents: -5 })).toBeNull();
  });
});

describe("§91 — items, centimes, erreurs", () => {
  it("offerItemOf : up/it absents = null (ohne EP), jamais 0", () => {
    expect(offerItemOf({ oz: "001.00010", qty: 12.5, up_cents: 18990, it_cents: 237375 }))
      .toMatchObject({ oz: "001.00010", qty: 12.5, upCents: 18990, itCents: 237375 });
    const partiel = offerItemOf({ oz: "001.00020", qty: 1, title: "X" });
    expect(partiel?.upCents).toBeNull();
    expect(partiel?.itCents).toBeNull();
    expect(offerItemOf({ qty: 1 })).toBeNull();       // sans OZ → ignoré
    expect(offerItemOf({ oz: "01", qty: "viele" })).toBeNull();
  });

  it("eurFromCents : centimes → affichage allemand", () => {
    expect(eurFromCents(1234567)).toContain("12.345,67");
    expect(eurFromCents(0)).toContain("0,00");
  });

  it("erreurs : detail serveur (parseur §91) prioritaire", () => {
    const de = "Keine Preise gefunden — das ist eine Ausschreibung, kein Angebot.";
    expect(offerErrorMessage(422, de)).toBe(de);
    expect(offerErrorMessage(404, null)).toContain("nicht gefunden");
    expect(offerErrorMessage(500, null)).toContain("500");
  });
});
