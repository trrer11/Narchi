/**
 * SESSION SECURITY - NARCHI CORE (P1-B, etage 1 : disjoncteur de trafic)
 * ----------------------------------------------------------------------
 * Etat GLOBAL et SYNCHRONE de validite de session (pattern Circuit Breaker,
 * calque sur le disjoncteur GPU du viewer).
 *
 * Contrat "Gel controle et persistance en sursis" :
 *  - Sur 401 : suspend() -> toutes les couches emettrices (flushQueue de
 *    remoteDb, pollers, chat) verifient isSuspended() AVANT d'emettre.
 *    Zero martelement du backend, zero pollution de logs.
 *  - La file d'ecritures N'EST PAS videe : elle reste persistee
 *    (localStorage narchi:writequeue, survit a la fermeture d'onglet).
 *  - Sur re-authentification : resume() SYNCHRONE puis rejeu immediat.
 */

type Listener = (suspended: boolean) => void;

let suspended = false;
const listeners = new Set<Listener>();

export const sessionSecurity = {
  /** Ouvre le disjoncteur : gele tout trafic authentifie sortant. */
  suspend(): void {
    if (suspended) return;
    suspended = true;
    listeners.forEach((l) => { try { l(true); } catch { /* noop */ } });
    // Evenement DOM pour les modules non abonnes (UI badge "hors ligne").
    window.dispatchEvent(new CustomEvent("narchi-session-suspended"));
  },

  /** Ferme le disjoncteur : reautorise le trafic. SYNCHRONE par contrat. */
  resume(): void {
    if (!suspended) return;
    suspended = false;
    listeners.forEach((l) => { try { l(false); } catch { /* noop */ } });
    window.dispatchEvent(new CustomEvent("narchi-session-resumed"));
  },

  /** Lecture synchrone par les couches emettrices (flushQueue, pollers). */
  isSuspended(): boolean {
    return suspended;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
