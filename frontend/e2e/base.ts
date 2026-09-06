/**
 * §121 — URL de la stack sous test, UNE SEULE source.
 *
 *  - Depuis le PC (navigateur humain) : http://localhost:8080.
 *  - Depuis le conteneur Playwright : E2E_BASE_URL=http://host.docker.internal:8080
 *    (localhost DANS le conteneur = loopback du conteneur, pas l'hôte —
 *    §192 l'a prouvé : ERR_CONNECTION_REFUSED).
 *
 * Le routeur de l'app est un routeur par HASH (#/app/...) : l'URL complète
 * d'une page est donc `${BASE_URL}/#/app/<vue>`.
 */
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8080";

/** URL complète d'une page applicative (routeur hash, voir RouteSynchronizer). */
export function appUrl(hashPfad: string): string {
  return `${BASE_URL}/#${hashPfad}`;
}
