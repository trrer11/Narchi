/**
 * SECURE FINANCE STORE — NARCHI CORE V4 (Module de sécurité financière)
 * ---------------------------------------------------------------------
 * Verrouillage transactionnel du moteur de calcul financier (DIN 276 / HOAI).
 *
 * Failles corrigées (audit destructif — Faille n°3) :
 *  - Race condition : pendant une synchronisation ou un calcul vectorisé
 *    asynchrone, l'utilisateur pouvait exporter (PDF/Excel/GAEB) un montant
 *    global OBSOLÈTE, car l'UI affichait encore l'ancien résultat pendant
 *    que le nouveau était en cours de calcul.
 *  - Deux calculs concurrents pouvaient s'entrelacer : le résultat du
 *    calcul le plus LENT écrasait celui du plus récent (lost update).
 *
 * Stratégie :
 *  - `isCalculating` verrouille l'affichage et l'export tant qu'un calcul
 *    est en vol. L'UI DOIT afficher un indicateur de chargement sur le
 *    montant global tant que ce drapeau est vrai.
 *  - `currentTransactionId` : chaque calcul reçoit un identifiant unique.
 *    Seul le résultat portant l'identifiant de la transaction COURANTE est
 *    committé — tout résultat d'une transaction périmée est rejeté.
 *  - `guardedExport()` refuse toute demande d'export pendant un calcul.
 *
 * Implémentation volontairement sans dépendance externe (compatible avec
 * l'architecture de slices existante : `store/slices/financialSlice.ts`) via
 * `useSyncExternalStore` de React 19.
 */

import { useSyncExternalStore } from "react";

// ============================================================================
// TYPES
// ============================================================================

export interface FinanceCalculationResult {
  /** Montant global TTC en euros (source d'autorité pour l'export). */
  totalAmount: number;
  /** Ventilation par groupe de coûts DIN 276 (KG 100–800). */
  breakdown: Record<string, number>;
  /** Horodatage ISO du commit du résultat. */
  computedAt: string;
  /** Transaction ayant produit ce résultat (traçabilité d'audit). */
  transactionId: string;
}

export interface SecureFinanceState {
  /** VERROU : vrai dès qu'une synchronisation ou un calcul vectorisé court. */
  isCalculating: boolean;
  /** Identifiant unique de la transaction de calcul courante ("" au repos). */
  currentTransactionId: string;
  /** Dernier résultat COMMITTÉ (jamais un résultat intermédiaire). */
  result: FinanceCalculationResult | null;
  /** Dernière erreur de calcul, le cas échéant. */
  error: string | null;
}

type Listener = () => void;

// ============================================================================
// STORE (source de vérité unique, hors React)
// ============================================================================

let state: SecureFinanceState = {
  isCalculating: false,
  currentTransactionId: "",
  result: null,
  error: null,
};

const listeners = new Set<Listener>();

function setState(patch: Partial<SecureFinanceState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): SecureFinanceState {
  return state;
}

function newTransactionId(): string {
  const entropy =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `fin-tx-${entropy}`;
}

// ============================================================================
// API PUBLIQUE — CYCLE DE VIE TRANSACTIONNEL
// ============================================================================

export const secureFinanceStore = {
  getState: getSnapshot,
  subscribe,

  /**
   * Ouvre une transaction de calcul : passe `isCalculating` à `true` et
   * génère un identifiant unique. Tout calcul précédent encore en vol est
   * implicitement invalidé (son commit sera rejeté).
   *
   * @returns l'identifiant de transaction à repasser à `commitResult()`.
   */
  beginCalculation(): string {
    const transactionId = newTransactionId();
    setState({
      isCalculating: true,
      currentTransactionId: transactionId,
      error: null,
    });
    return transactionId;
  },

  /**
   * Committe le résultat d'un calcul, UNIQUEMENT si la transaction est
   * toujours la transaction courante. Un résultat périmé (transaction
   * remplacée entre-temps) est silencieusement rejeté — c'est le mécanisme
   * anti "lost update".
   *
   * @returns `true` si le résultat a été accepté, `false` s'il était périmé.
   */
  commitResult(
    transactionId: string,
    payload: { totalAmount: number; breakdown: Record<string, number> }
  ): boolean {
    if (transactionId !== state.currentTransactionId) {
      console.warn(
        `[SecureFinanceStore] Résultat périmé rejeté (tx=${transactionId}).`
      );
      return false;
    }
    setState({
      isCalculating: false,
      currentTransactionId: "",
      error: null,
      result: {
        totalAmount: payload.totalAmount,
        breakdown: { ...payload.breakdown },
        computedAt: new Date().toISOString(),
        transactionId,
      },
    });
    return true;
  },

  /** Clôt la transaction en erreur (déverrouille l'UI, conserve l'ancien résultat). */
  failCalculation(transactionId: string, message: string): void {
    if (transactionId !== state.currentTransactionId) return;
    setState({
      isCalculating: false,
      currentTransactionId: "",
      error: message,
    });
  },

  /**
   * Enveloppe transactionnelle : exécute un calcul asynchrone (moteur
   * DIN 276 vectorisé, synchronisation backend, Monte-Carlo…) sous verrou.
   * Usage :
   *   await secureFinanceStore.runCalculation(async () => computeCosts(cfg));
   */
  async runCalculation(
    task: () => Promise<{ totalAmount: number; breakdown: Record<string, number> }>
  ): Promise<boolean> {
    const transactionId = secureFinanceStore.beginCalculation();
    try {
      const payload = await task();
      return secureFinanceStore.commitResult(transactionId, payload);
    } catch (err) {
      secureFinanceStore.failCalculation(
        transactionId,
        err instanceof Error ? err.message : "Erreur de calcul financier."
      );
      return false;
    }
  },

  /**
   * GARDE D'EXPORT : refuse l'export tant qu'un calcul est en cours ou
   * qu'aucun résultat committé n'existe. Empêche l'export d'un montant
   * asynchrone obsolète.
   *
   * @throws Error si l'export est interdit dans l'état courant.
   * @returns le résultat committé, sûr pour l'export.
   */
  guardedExport(): FinanceCalculationResult {
    if (state.isCalculating) {
      throw new Error(
        "Export refusé : un calcul financier est en cours. Attendez la fin de la synchronisation."
      );
    }
    if (!state.result) {
      throw new Error("Export refusé : aucun résultat de calcul committé.");
    }
    return state.result;
  },

  /** Réinitialisation complète (changement de projet). */
  reset(): void {
    setState({
      isCalculating: false,
      currentTransactionId: "",
      result: null,
      error: null,
    });
  },
};

// ============================================================================
// HOOKS REACT
// ============================================================================

/** Abonnement React à l'état complet du store financier sécurisé. */
export function useSecureFinance(): SecureFinanceState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Montant global prêt pour l'affichage.
 * Retourne `{ locked: true }` pendant un calcul : le composant DOIT alors
 * afficher un indicateur de chargement (spinner/squelette) À LA PLACE du
 * montant, jamais l'ancien montant seul.
 *
 * Exemple d'intégration (CostEstimation.tsx) :
 *   const { locked, amount } = useGlobalAmount();
 *   {locked
 *     ? <span className="animate-pulse">Calcul en cours…</span>
 *     : <span>{amount?.toLocaleString("de-DE")} €</span>}
 */
export function useGlobalAmount(): { locked: boolean; amount: number | null } {
  const snapshot = useSecureFinance();
  return {
    locked: snapshot.isCalculating,
    amount: snapshot.result?.totalAmount ?? null,
  };
}

/**
 * Sélecteur dédié au bouton d'export (PDF/Excel/GAEB).
 * `true` UNIQUEMENT si aucun calcul n'est en vol ET qu'un résultat committé
 * existe. À brancher directement sur `disabled={!canExport}` :
 *
 *   const canExport = useCanExport();
 *   <Button disabled={!canExport} onClick={() => {
 *     const safe = secureFinanceStore.guardedExport(); // double garde
 *     exportPdf(safe.totalAmount, safe.breakdown);
 *   }}>Exporter le devis</Button>
 */
export function useCanExport(): boolean {
  const snapshot = useSecureFinance();
  return !snapshot.isCalculating && snapshot.result !== null;
}
