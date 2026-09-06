/**
 * §116 — Rechnungen / E-Rechnung : aperçu EXACT côté navigateur + contrat API.
 *
 * Éprouvé :
 *  - la saisie ALLEMANDE (virgule, points milliers, « € ») et ses refus
 *    honnêtes (null au lieu d'un nombre bidouillé) ;
 *  - l'aperçu de totaux en BigInt — MÊME arithmétique que le serveur
 *    (arrondi par ligne HALF_UP puis TVA par groupe) ; le cas piège
 *    « 3 × 33,3350 = 100,005 → 100,01 » + « 87,50 × 7 % = 6,125 → 6,13 »
 *    est épinglé au centime, exactement comme au backend ;
 *  - le mapping API : statuts HTTP, violations NARCHI-XR-… remontées
 *    TELLES QUELLES (jamais un « invalide » muet).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  cancelInvoice,
  centsOf,
  createInvoice,
  formatEur,
  issueInvoice,
  listInvoices,
  parseEuro,
  parsePrix,
  parseQuantite,
  previewTotals,
  STATUS_LABELS,
  updateInvoice,
  validateInvoice,
  type Invoice,
} from "@/lib/invoices";

const h = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@/auth/SecuritySanitizer", () => ({ secureFetch: h.fetchMock }));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("saisie allemande (parseEuro / parsePrix / parseQuantite)", () => {
  it("accepte virgules, points milliers et « € »", () => {
    expect(parseEuro("1.234,56")).toBe("1234.56");
    expect(parseEuro("4000,00 €")).toBe("4000.00");
    expect(parseEuro("4.000,00")).toBe("4000.00"); // milliers OTAN : il y a une virgule
    expect(parseEuro("1234.5")).toBe("1234.50"); // sans virgule : point = décimal (tableur)
    expect(parseEuro("4.000")).toBeNull(); // AMBIGU sans virgule — refusé honnêtement
    expect(parsePrix("33,3350")).toBe("33.3350"); // 4 décimales = légal §114
    expect(parsePrix("33.3350")).toBe("33.3350"); // point décimal accepté aussi
    expect(parseQuantite("2,5")).toBe("2.5");
  });

  it("refuse HONNÊTEMENT (null) au lieu de bidouiller", () => {
    expect(parseEuro("abc")).toBeNull();
    expect(parseEuro("-5")).toBeNull(); // pas de facture négative ici
    expect(parseEuro("12,345")).toBeNull(); // > 2 décimales d'argent
    expect(parseQuantite("0")).toBeNull(); // 0 = rien à facturer
    expect(parseQuantite("")).toBeNull();
    expect(parsePrix("1.234.567,1234567")).toBeNull(); // > 6 décimales
  });
});

describe("aperçu de totaux — arithmétique épinglée au centime", () => {
  it("rejoue le cas piège §114 (3×33,3350 + 87,50@7 %)", () => {
    const t = previewTotals([
      { quantite: "3", prix_unitaire_ht: "33.3350", taux_tva: "19" },
      { quantite: "1", prix_unitaire_ht: "87.50", taux_tva: "7" },
    ]);
    expect(t.lignes).toEqual([10001n, 8750n]); // 100,005 → 100,01 HALF_UP
    expect(t.netCents).toBe(18751n);
    expect(t.tvaCents).toBe(2513n); // 19,00 + 6,13 — jamais 25,12
    expect(t.brutCents).toBe(21264n);
    expect(t.groupes).toEqual([
      { taux: "7", baseCents: 8750n, tvaCents: 613n }, // trié par taux
      { taux: "19", baseCents: 10001n, tvaCents: 1900n },
    ]);
  });

  it("TVA calculée PAR GROUPE de taux (pas par ligne)", () => {
    // Deux lignes à 0,01 € à 19 % : groupe 0,02 → 0,00 de TVA ; ligne
    // par ligne ça ferait aussi 0,00 — le cas qui les distingue :
    // 15 × 0,07 @7 % = 1,05 → 0,0735 → 0,07 en groupe.
    const t = previewTotals([
      { quantite: "5", prix_unitaire_ht: "0.07", taux_tva: "7" },
      { quantite: "5", prix_unitaire_ht: "0.07", taux_tva: "7" },
      { quantite: "5", prix_unitaire_ht: "0.07", taux_tva: "7" },
    ]);
    expect(t.netCents).toBe(105n);
    expect(t.tvaCents).toBe(7n); // 1,05 × 7 % = 0,0735 → 0,07
    expect(t.brutCents).toBe(112n);
  });

  it("formatEur : allemand, fait main (identique sur tout appareil)", () => {
    expect(formatEur(21264n)).toBe("212,64 €");
    expect(formatEur(123456789n)).toBe("1.234.567,89 €");
    expect(formatEur(0n)).toBe("0,00 €");
    expect(formatEur(-55n)).toBe("-0,55 €");
    expect(formatEur(centsOf("4000.00"))).toBe("4.000,00 €");
  });
});

describe("client API §116", () => {
  beforeEach(() => h.fetchMock.mockReset());

  it("createInvoice envoie des CHAÎNES décimales (jamais de number)", async () => {
    const facture = { id: "inv-1", status: "draft" } as Invoice;
    h.fetchMock.mockResolvedValueOnce(jsonResponse(201, facture));
    const out = await createInvoice({
      buyer_name: "Stadt Hannover",
      lines: [
        { designation: "LP 5", quantite: "1", unite: "forfait", prix_unitaire_ht: "4000.00", taux_tva: "19" },
      ],
    });
    expect(out.id).toBe("inv-1");
    const [url, init] = h.fetchMock.mock.calls[0];
    expect(url).toBe("/api/v5/invoices");
    expect(JSON.parse(init.body).lines[0].prix_unitaire_ht).toBe("4000.00");
    expect(init.method).toBe("POST");
  });

  it("issueInvoice: 422 remonte les violations NARCHI-XR-… TELLES QUELLES", async () => {
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse(422, {
        detail: { detail: "Ausstellung verweigert", violations: ["NARCHI-XR-20: Leitweg-ID absente"] },
      }),
    );
    let err!: ApiError;
    try {
      await issueInvoice("inv-9");
    } catch (e) {
      err = e as ApiError;
    }
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.violations[0]).toContain("NARCHI-XR-20");
  });

  it("409 storno/freeze : message texte conservé", async () => {
    h.fetchMock.mockResolvedValueOnce(jsonResponse(409, { detail: "Rechnung ist « issued »" }));
    let err!: ApiError;
    try {
      await updateInvoice("inv-7", { buyer_name: "X", lines: [] });
    } catch (e) {
      err = e as ApiError;
    }
    expect(err.status).toBe(409);
    expect(err.message).toContain("issued");
  });

  it("listInvoices construit la requête filtrée ; validate/cancel ciblent leurs routes", async () => {
    h.fetchMock.mockResolvedValueOnce(jsonResponse(200, { invoices: [], total: 0 }));
    await listInvoices({ status: "draft", q: "Stadt" });
    expect(h.fetchMock.mock.calls[0][0]).toBe("/api/v5/invoices?status=draft&q=Stadt");

    h.fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: false, violations: ["NARCHI-XR-13 x"] }));
    const rep = await validateInvoice("inv-3");
    expect(rep.ok).toBe(false);
    expect(h.fetchMock.mock.calls[1][0]).toBe("/api/v5/invoices/inv-3/validation");

    h.fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "inv-3", status: "cancelled" }));
    const c = await cancelInvoice("inv-3", "Falsche Periode");
    expect(c.status).toBe("cancelled");
    expect(JSON.parse(h.fetchMock.mock.calls[2][1].body)).toEqual({ reason: "Falsche Periode" });
  });

  it("les libellés d'état couvrent exactement les trois statuts du serveur", () => {
    expect(STATUS_LABELS).toEqual({
      draft: "Entwurf",
      issued: "Ausgestellt",
      cancelled: "Storniert",
    });
  });
});
