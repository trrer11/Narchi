/**
 * §101 — Enregistrement du service worker NARCHI (PWA #10) + flot de mise
 * à jour honnête.
 *
 * Deux décisions DITES :
 *  - jamais en développement (import.meta.env.PROD seulement) : un SW qui
 *    cache en dev produit des écrans fantômes après chaque édition ;
 *  - jamais de rechargement AUTOMATIQUE : quand une nouvelle version du
 *    service worker attend, l'utilisateur voit une pastille « nouvelle
 *    version — recharger » jusqu'à ce qu'il choisisse (ou recharge de
 *    lui-même) — pas de dismissal qui ferait oublier la mise à jour.
 */

export const PWA_SW_URL = "/sw.js";

export type PwaOutcome = "updatefound" | "clean";
export type PwaBadge = "none" | "controlled" | "pending_user";

export interface PwaHooks {
  /**
   * Appelé une fois le bilan connu : « updatefound » (nouvelle version
   * en attente — apply() l'active et recharge) ou « clean » (rien à faire).
   */
  onOutcome: (outcome: PwaOutcome, apply: (() => void) | null) => void;
}

/**
 * Machine d'état PURE (testée) : quelle pastille afficher après le bilan
 * d'enregistrement ? « pending_user » reste AFFICHÉE jusqu'au rechargement
 * — c'est la règle §101 contre les mises à jour oubliées.
 */
export function resolutionForRegistration(outcome: PwaOutcome): PwaBadge {
  return outcome === "updatefound" ? "pending_user" : "controlled";
}

/**
 * Enregistre /sw.js en production et déroule le flot de mise à jour.
 * Retourne un cleanup qui détache les écouteurs (démontage React).
 * En DEV ou sans support navigateur : no-op (jamais de cache fantôme).
 */
export function registerPwaServiceWorker(hooks: PwaHooks): () => void {
  if (!import.meta.env.PROD) return () => undefined;
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return () => undefined;
  }

  let disposed = false;
  let detachControllerChange: (() => void) | null = null;

  const main = async () => {
    try {
      const registration = await navigator.serviceWorker.register(PWA_SW_URL);
      if (disposed) return;

      const announce = (worker: ServiceWorker) => {
        const apply = () => {
          const onChange = () => window.location.reload();
          navigator.serviceWorker.addEventListener("controllerchange", onChange, { once: true });
          detachControllerChange = () =>
            navigator.serviceWorker.removeEventListener("controllerchange", onChange);
          worker.postMessage({ type: "SKIP_WAITING" });
        };
        hooks.onOutcome("updatefound", apply);
      };

      const watch = (worker: ServiceWorker | null) => {
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          // installée et une version ANCIENNE contrôle encore → c'est une
          // MISE À JOUR en attente (première installation : pas de controller).
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            announce(worker);
          }
        });
      };

      // Une version attendait déjà AVANT ce chargement (utilisateur a fermé
      // l'onglet sans recharger) — la pastille revient, elle ne s'oublie pas.
      if (registration.waiting && navigator.serviceWorker.controller) {
        announce(registration.waiting);
      } else {
        hooks.onOutcome("clean", null);
      }
      registration.addEventListener("updatefound", () => watch(registration.installing));
      watch(registration.installing);

      // Forcer la vérification après chargement : le navigateur ne re-vérifie
      // par défaut qu'au bout de ~24 h — chez nous, chaque démarrage compte.
      registration.update().catch(() => undefined);
    } catch (err) {
      // Échec d'enregistrement : l'app reste 100 % utilisable en ligne ;
      // on le dit en console, jamais en pleurant à l'écran.
      console.warn("[PWA] Service Worker nicht registriert:", err);
    }
  };

  if (document.readyState === "complete") {
    void main();
  } else {
    window.addEventListener("load", () => void main(), { once: true });
  }

  return () => {
    disposed = true;
    detachControllerChange?.();
  };
}
