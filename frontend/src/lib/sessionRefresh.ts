/**
 * §87 — Renouvellement de session SILENCIEUX (plainte réelle du client :
 * déconnexion après ~3–5 min d'inactivité, reconnexion forcée — pile les
 * 15 min du jeton d'accès, le cookie refresh 7 jours n'étant jamais
 * consommé).
 *
 * Ce module contient les décisions PURES (testées) ; le pilote concret
 * (timers, secureFetch, disjoncteur) vit dans AuthStore.
 *
 * Contrat honnête : posture SOC2 conservée (access 15 min / refresh
 * 7 jours — mêmes constantes que le serveur §87), l'utilisateur actif ne
 * voit JAMAIS le login en journée ; seuls inactifs > 7 jours, sessions
 * révoquées (mot de passe changé, compte désactivé) ou refresh vraiment
 * expiré retombent sur l'écran d'identification.
 */

/// Miroir du serveur (ACCESS_TOKEN_TTL_MINUTES = 15, auth_routes §87).
export const ACCESS_TOKEN_TTL_S = 15 * 60;
/// Marge de renouvellement : on rafraîchit ~2 min avant l'échéance.
export const REFRESH_MARGIN_MS = 2 * 60 * 1000;
/// Cadence de la boucle (visible seulement — un onglet caché ne poll pas).
export const REFRESH_POLL_MS = 30 * 1000;
/// Au réveil d'onglet : renouvelle si moins de 10 min restent (couvre la
/// mise en veille d'un portable > durée du jeton).
export const WAKE_MARGIN_MS = 10 * 60 * 1000;
/// Boot : le TTL restant du cookie HttpOnly est ILLISIBLE — hypothèse
/// prudente « moitié de vie » (la boucle amorce un renouvellement rapide).
export const BOOT_ASSUMED_TTL_S = 4 * 60;

/** Échéance de session à partir d'un expires_in serveur (borné ≥ 0). */
export function nextExpiry(now: number, expiresInSec: number = ACCESS_TOKEN_TTL_S): number {
  return now + Math.max(0, expiresInSec) * 1000;
}

/**
 * Faut-il renouveler MAINTENANT ? Jamais si l'échéance est inconnue
 * (pas de session suivie) ; vrai dès l'entrée dans la marge, y compris
 * quand l'échéance est déjà dépassée (retour de veille).
 */
export function shouldRefreshNow(
  now: number,
  expiresAt: number | null,
  marginMs: number = REFRESH_MARGIN_MS,
): boolean {
  if (expiresAt === null) return false;
  return now >= expiresAt - marginMs;
}
