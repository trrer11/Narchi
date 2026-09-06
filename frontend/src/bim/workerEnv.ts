/**
 * DÉTECTION D'ENVIRONNEMENT SANS WEB WORKERS — NARCHI
 * ----------------------------------------------------
 * Certains environnements bloquent de façon déterministe le chargement ou
 * l'exécution des scripts de Web Worker (web-shield d'antivirus, extensions,
 * politique réseau, navigateur sans Workers ES modules). Symptôme observé en
 * production : le worker de parsing IFC ET le worker Fragments de That Open
 * meurent avant tout message — les imports et la 3D plantaient au premier
 * essai, et seul un rechargement faisait apparaître le repli.
 *
 * Ce module mémorise le verdict « Workers indisponibles » pour la durée de
 * l'onglet (sessionStorage) : après un premier échec avéré, TOUTES les
 * fonctionnalités concernées (parsing, visionneuse) vont DIRECTEMENT au
 * moteur de secours — plus d'attente de 90 s, plus de rechargement manuel.
 * Le drapeau expire avec l'onglet : un environnement sain ne le pose jamais.
 */

const STORAGE_KEY = "narchi:workers-blocked";

let blocked = readFlag();

function readFlag(): boolean {
  try {
    return (
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(STORAGE_KEY) === "1"
    );
  } catch {
    return false;
  }
}

/** Vrai si l'environnement a déjà prouvé qu'il ne sait pas exécuter nos Workers. */
export function areWorkersBlocked(): boolean {
  return blocked;
}

/** Enregistre l'échec d'un Worker : le prochain appel ira au moteur de secours. */
export function markWorkersBlocked(reason: unknown): void {
  if (blocked) return;
  blocked = true;
  try {
    sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* stockage indisponible : drapeau mémoire seul, suffisant pour la session */
  }
  console.warn(
    "[NARCHI] Environnement sans Web Workers détecté — moteurs de secours activés pour la session :",
    reason instanceof Error ? reason.message : reason,
  );
}
