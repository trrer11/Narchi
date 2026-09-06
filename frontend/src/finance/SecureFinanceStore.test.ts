/**
 * SUITE VITEST — SecureFinanceStore
 * Valide le verrou transactionnel anti race-condition (Faille n°3).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { secureFinanceStore } from "./SecureFinanceStore";

describe("SecureFinanceStore — verrou transactionnel", () => {
  beforeEach(() => {
    secureFinanceStore.reset();
  });

  it("pose le verrou isCalculating et génère un currentTransactionId au démarrage", () => {
    const txId = secureFinanceStore.beginCalculation();
    const state = secureFinanceStore.getState();
    expect(state.isCalculating).toBe(true);
    expect(state.currentTransactionId).toBe(txId);
    expect(txId).toMatch(/^fin-tx-/);
  });

  it("committe le résultat d'une transaction courante et libère le verrou", () => {
    const txId = secureFinanceStore.beginCalculation();
    const accepted = secureFinanceStore.commitResult(txId, {
      totalAmount: 8_900_000,
      breakdown: { KG300: 5_200_000, KG400: 3_700_000 },
    });
    const state = secureFinanceStore.getState();
    expect(accepted).toBe(true);
    expect(state.isCalculating).toBe(false);
    expect(state.currentTransactionId).toBe("");
    expect(state.result?.totalAmount).toBe(8_900_000);
    expect(state.result?.transactionId).toBe(txId);
  });

  it("rejette le commit d'une transaction périmée (anti lost-update)", () => {
    const staleTx = secureFinanceStore.beginCalculation();
    const freshTx = secureFinanceStore.beginCalculation(); // remplace staleTx

    const staleAccepted = secureFinanceStore.commitResult(staleTx, {
      totalAmount: 111,
      breakdown: {},
    });
    expect(staleAccepted).toBe(false);
    // Le verrou reste posé : la transaction fraîche est toujours en vol.
    expect(secureFinanceStore.getState().isCalculating).toBe(true);

    const freshAccepted = secureFinanceStore.commitResult(freshTx, {
      totalAmount: 222,
      breakdown: {},
    });
    expect(freshAccepted).toBe(true);
    expect(secureFinanceStore.getState().result?.totalAmount).toBe(222);
  });

  it("guardedExport refuse l'export pendant un calcul en vol", () => {
    secureFinanceStore.beginCalculation();
    expect(() => secureFinanceStore.guardedExport()).toThrowError(
      /Export refusé : un calcul financier est en cours/
    );
  });

  it("guardedExport refuse l'export sans résultat committé", () => {
    expect(() => secureFinanceStore.guardedExport()).toThrowError(
      /aucun résultat de calcul committé/
    );
  });

  it("guardedExport renvoie le résultat committé une fois le verrou libéré", () => {
    const txId = secureFinanceStore.beginCalculation();
    secureFinanceStore.commitResult(txId, { totalAmount: 42_000, breakdown: { KG300: 42_000 } });
    const safe = secureFinanceStore.guardedExport();
    expect(safe.totalAmount).toBe(42_000);
    expect(safe.breakdown.KG300).toBe(42_000);
  });

  it("runCalculation : deux calculs concurrents → seul le plus récent gagne", async () => {
    const slow = secureFinanceStore.runCalculation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { totalAmount: 100, breakdown: {} };
    });
    const fast = secureFinanceStore.runCalculation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { totalAmount: 999, breakdown: {} };
    });

    const [slowOk, fastOk] = await Promise.all([slow, fast]);
    expect(fastOk).toBe(true);   // transaction la plus récente : committée
    expect(slowOk).toBe(false);  // transaction périmée : rejetée
    expect(secureFinanceStore.getState().result?.totalAmount).toBe(999);
  });

  it("failCalculation libère le verrou en conservant l'ancien résultat", async () => {
    const okTx = secureFinanceStore.beginCalculation();
    secureFinanceStore.commitResult(okTx, { totalAmount: 500, breakdown: {} });

    const failedOk = await secureFinanceStore.runCalculation(async () => {
      throw new Error("Moteur DIN 276 indisponible");
    });
    const state = secureFinanceStore.getState();
    expect(failedOk).toBe(false);
    expect(state.isCalculating).toBe(false);
    expect(state.error).toMatch(/DIN 276/);
    expect(state.result?.totalAmount).toBe(500); // ancien résultat préservé
  });
});
