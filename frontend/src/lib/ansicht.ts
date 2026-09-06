/**
 * §109 — Densité de TOUTE l'interface (« Ansicht »).
 *
 * Le client avait demandé « dézoome de 30 % » : le §107 l'avait posé sur
 * la SEULE page Baustelle, avec un widget dans son en-tête — erreur
 * d'interprétation, dite et corrigée : « je parlais du zoom de
 * l'interface ». La densité est donc désormais UN réglage global (barre
 * du haut), trois niveaux, mémorisé sur ce poste (jamais serveur).
 *
 * Défaut 70 % = la demande explicite « −30 % ». Toute valeur stockée
 * invalide retombe sur le défaut : jamais de zoom fantasme.
 */

export const ANSICHT_LEVELS = [0.7, 0.85, 1] as const;
export type AnsichtLevel = (typeof ANSICHT_LEVELS)[number];
export const DEFAULT_ANSICHT: AnsichtLevel = 0.7;

/** Clé actuelle (interface entière). */
export const ANSICHT_KEY = "narchi:ui:zoom";
/** Ancienne clé §107 (page Baustelle seule) — reprise une fois, puis
 *  oubliée au prochain choix pour ne pas laisser deux vérités. */
export const LEGACY_ANSICHT_KEY = "narchi:baustelle:zoom";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function isAnsichtLevel(value: number): value is AnsichtLevel {
  return (ANSICHT_LEVELS as readonly number[]).includes(value);
}

/** Lit la densité mémorisée ; reprend l'ancienne clé page-seule si la
 *  nouvelle n'existe pas encore (le réglage §107 du client n'est pas
 *  perdu) ; invalide/absent → défaut. Jamais d'exception. */
export function readAnsicht(storage: StorageLike): AnsichtLevel {
  try {
    const raw = storage.getItem(ANSICHT_KEY) ?? storage.getItem(LEGACY_ANSICHT_KEY);
    const parsed = raw === null ? Number.NaN : Number(raw);
    return isAnsichtLevel(parsed) ? parsed : DEFAULT_ANSICHT;
  } catch {
    return DEFAULT_ANSICHT;
  }
}

/** Persiste le choix et oublie l'ancienne clé (une seule source de
 *  vérité à partir d'ici). Stockage indisponible (navigation privée) =
 *  choix valable pour la session, jamais d'erreur jetée. */
export function saveAnsicht(storage: StorageLike, level: AnsichtLevel): void {
  try {
    storage.setItem(ANSICHT_KEY, String(level));
    storage.removeItem(LEGACY_ANSICHT_KEY);
  } catch {
    /* session courante seulement */
  }
}
