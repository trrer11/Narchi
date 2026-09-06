/**
 * §87 — décisions pures du renouvellement silencieux de session.
 */
import { describe, expect, it } from "vitest";
import {
  ACCESS_TOKEN_TTL_S,
  BOOT_ASSUMED_TTL_S,
  nextExpiry,
  REFRESH_MARGIN_MS,
  shouldRefreshNow,
  WAKE_MARGIN_MS,
} from "@/lib/sessionRefresh";

describe("§87 — nextExpiry / shouldRefreshNow", () => {
  it("contrat de durées : miroir serveur 15 min, marges cohérentes", () => {
    expect(ACCESS_TOKEN_TTL_S).toBe(900);
    expect(REFRESH_MARGIN_MS).toBeLessThan(ACCESS_TOKEN_TTL_S * 1000);
    expect(BOOT_ASSUMED_TTL_S).toBeLessThan(ACCESS_TOKEN_TTL_S);
    expect(WAKE_MARGIN_MS).toBeGreaterThan(REFRESH_MARGIN_MS);
  });

  it("nextExpiry : expires_in → échéance, négatif borné à 0", () => {
    expect(nextExpiry(1_000_000, 900)).toBe(1_900_000);
    expect(nextExpiry(1_000_000, -5)).toBe(1_000_000);
    expect(nextExpiry(1_000_000)).toBe(1_000_000 + ACCESS_TOKEN_TTL_S * 1000);
  });

  it("shouldRefreshNow : entrée dans la marge, échéance passée, inconnu", () => {
    const expiry = 1_000_000;
    // Loin de l'échéance : silence.
    expect(shouldRefreshNow(expiry - REFRESH_MARGIN_MS - 1, expiry)).toBe(false);
    // Dans la marge : on pousse.
    expect(shouldRefreshNow(expiry - REFRESH_MARGIN_MS, expiry)).toBe(true);
    expect(shouldRefreshNow(expiry - 1_000, expiry)).toBe(true);
    // Échéance DÉPASSÉE (réveil de veille) : on pousse quand même —
    // le refresh cookie 7 jours sauve la session sans login.
    expect(shouldRefreshNow(expiry + 60_000, expiry)).toBe(true);
    // Pas d'échéance connue : jamais de requête inutile.
    expect(shouldRefreshNow(expiry + 60_000, null)).toBe(false);
    // Marge personnalisée (réveil d'onglet) : hors marge → silence,
    // borne exacte → on pousse.
    expect(shouldRefreshNow(expiry - WAKE_MARGIN_MS - 1, expiry, WAKE_MARGIN_MS)).toBe(false);
    expect(shouldRefreshNow(expiry - WAKE_MARGIN_MS, expiry, WAKE_MARGIN_MS)).toBe(true);
  });
});
