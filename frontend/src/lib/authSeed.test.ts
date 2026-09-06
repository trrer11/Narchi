/**
 * TEST ANTI-REGRESSION "Aucun compte trouve avec cet email".
 * Cause : ensureSeedOwner() retire du boot (gel PBKDF2) et jamais rappele
 * -> narchi:users vide a vie -> l authentification locale echouait pour
 * TOUT le monde des que le backend etait injoignable.
 * Contrat : seeding PARESSEUX au premier login local sur base vide.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { authenticate, listUsers } from "./auth";

describe("Authentification locale - seeding paresseux", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("REPRO EXACTE du bug : stockage vierge + login owner => DOIT reussir", async () => {
    // Avant correctif : "Aucun compte trouve avec cet email." systematique.
    const user = await authenticate("owner@narchi.io", "Narchi2026!");
    expect(user.email).toBe("owner@narchi.io");
    expect(user.role).toBe("owner");
  });

  it("le compte admin Kammer Berlin est aussi seme", async () => {
    const user = await authenticate("admin@narchi.de", "AdminBerlin2026!");
    expect(user.role).toBe("owner");
  });

  it("mauvais mot de passe sur base semee : erreur MOT DE PASSE, pas compte introuvable", async () => {
    await expect(authenticate("owner@narchi.io", "mauvais")).rejects.toThrow(/Mot de passe incorrect/);
  });

  it("email inconnu apres seeding : erreur compte introuvable (comportement legitime)", async () => {
    await expect(authenticate("inconnu@nulle-part.de", "x")).rejects.toThrow(/Aucun compte trouv/);
  });

  it("le seeding est idempotent : un 2e login ne duplique pas les comptes", async () => {
    await authenticate("owner@narchi.io", "Narchi2026!");
    const countAfterFirst = listUsers().length;
    await authenticate("owner@narchi.io", "Narchi2026!");
    expect(listUsers().length).toBe(countAfterFirst);
  });

  it("le seeding ne s execute PAS au simple chargement du module (pas de gel au boot)", () => {
    // Aucun authenticate() appele : le stockage doit rester vierge.
    expect(listUsers().length).toBe(0);
  });
});
