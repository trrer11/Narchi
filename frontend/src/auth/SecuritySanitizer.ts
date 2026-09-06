/**
 * SECURITY SANITIZER — NARCHI CORE V4 (Module anti-XSS & sessions)
 * ----------------------------------------------------------------
 * Neutralisation XSS des messages de chat + politique de session par
 * cookie sécurisé.
 *
 * Failles corrigées (audit destructif — Faille n°4) :
 *  - XSS stocké : les messages de chat étaient acceptés bruts ; un payload
 *    `<img src=x onerror=...>` injecté via l'API pouvait s'exécuter chez
 *    tout membre du canal.
 *  - Vol de session : le token JWT était persisté dans `localStorage`
 *    (clé "narchi:session"), donc lisible par n'importe quel script XSS.
 *    → Combinaison des deux = prise de contrôle de compte complète.
 *
 * Politique appliquée :
 *  1. `sanitizeChatMessage()` échappe les caractères sensibles en entités
 *     HTML. INTERDICTION d'utiliser `dangerouslySetInnerHTML` côté rendu :
 *     le texte assaini est rendu via l'interpolation JSX standard
 *     (`{message.text}`), qui ré-échappe une seconde fois (défense en
 *     profondeur).
 *  2. Le token de session ne transite QUE via un cookie `narchi_session`
 *     émis par le backend FastAPI avec `HttpOnly; Secure; SameSite=Strict`.
 *     Le JavaScript client n'a plus JAMAIS accès au token.
 *  3. `purgeLegacyTokenStorage()` supprime tout token hérité de l'ancienne
 *     implémentation localStorage/sessionStorage au démarrage de l'app.
 */

import { sessionSecurity } from "./sessionSecurity";

// ============================================================================
// 1. NEUTRALISATION XSS
// ============================================================================

/**
 * Table d'échappement des caractères sensibles vers leurs entités HTML.
 * Couvre les vecteurs d'injection de balises (< >), de rupture d'attributs
 * (" '), de fermeture de balise (/) et d'entités (&, échappé en premier).
 */
const HTML_ENTITY_MAP: ReadonlyArray<[RegExp, string]> = [
  [/&/g, "&amp;"], // TOUJOURS en premier — sinon double-échappement des autres entités
  [/</g, "&lt;"],
  [/>/g, "&gt;"],
  [/"/g, "&quot;"],
  [/'/g, "&#x27;"],
  [/\//g, "&#x2F;"],
];

/** Longueur maximale d'un message de chat (aligné sur chatService.MAX_TEXT). */
const MAX_MESSAGE_LENGTH = 4000;

/**
 * Assainit un message de chat brut avant persistance et affichage.
 *
 * Remplace les caractères sensibles `< > " ' /` (et `&`) par leurs entités
 * HTML sécurisées, supprime les caractères de contrôle invisibles et tronque
 * à la longueur maximale autorisée.
 *
 * Le résultat DOIT être rendu via l'interpolation JSX/textContent —
 * JAMAIS via `dangerouslySetInnerHTML` ou `innerHTML`.
 */
export function sanitizeChatMessage(rawMessage: string): string {
  if (typeof rawMessage !== "string") return "";

  // 1. Normalisation Unicode (empêche les contournements par composition).
  let safe = rawMessage.normalize("NFC");

  // 2. Suppression des caractères de contrôle (hors \n et \t) et des
  //    caractères de manipulation bidirectionnelle (Trojan Source).
  // eslint-disable-next-line no-control-regex
  safe = safe.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, "");

  // 3. Échappement des caractères sensibles en entités HTML.
  for (const [pattern, entity] of HTML_ENTITY_MAP) {
    safe = safe.replace(pattern, entity);
  }

  // 4. Troncature défensive (anti-DoS d'affichage).
  return safe.slice(0, MAX_MESSAGE_LENGTH).trim();
}

/**
 * Variante pour tout contenu utilisateur affiché hors chat
 * (noms de projets, commentaires BCF, notes d'audit…).
 */
export function sanitizeUserContent(raw: string, maxLength = 10000): string {
  return sanitizeChatMessage(raw).slice(0, maxLength);
}

/**
 * Variante STRICTE pour les champs à risque élevé (liens, notes BIM,
 * métadonnées importées de fichiers IFC/BCF tiers). En plus de
 * l'échappement en entités, supprime les schémas d'URI exécutables et
 * les gestionnaires d'événements inline.
 */
export function sanitizeChatMessageStrict(rawMessage: string): string {
  return sanitizeChatMessage(rawMessage)
    .replace(/javascript:/gi, "")
    .replace(/vbscript:/gi, "")
    .replace(/data:text\/html/gi, "")
    .replace(/on\w+\s*=/gi, "")     // onload=, onerror=, onclick=…
    .replace(/`/g, "&#x60;");        // injection dans les templates ES6
}

// ============================================================================
// 2. SÉCURISATION DES SESSIONS — COOKIE HttpOnly / Secure / SameSite=Strict
// ============================================================================

/**
 * Clés héritées de l'ancienne implémentation vulnérable. Le token n'est
 * PLUS JAMAIS écrit sous ces clés ; elles sont purgées au démarrage.
 */
const LEGACY_TOKEN_KEYS = ["narchi:session", "narchi:remote:token"] as const;

/**
 * Purge tout token hérité de localStorage ET sessionStorage.
 * À appeler au boot de l'application (main.tsx) et au logout.
 */
export function purgeLegacyTokenStorage(): void {
  for (const key of LEGACY_TOKEN_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* stockage indisponible (mode privé) — sans conséquence */
    }
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* idem */
    }
  }
}

/**
 * Contrat de session côté client.
 *
 * Le token vit exclusivement dans le cookie `narchi_session` émis par le
 * backend FastAPI (voir `backend/app/api/auth_routes.py`) :
 *
 *     response.set_cookie(
 *         key="narchi_session",
 *         value=access_token,
 *         httponly=True,        # inaccessible à document.cookie → anti-XSS
 *         secure=True,          # transmis uniquement en HTTPS
 *         samesite="strict",    # jamais envoyé en navigation cross-site → anti-CSRF
 *         max_age=...,
 *     )
 *
 * Conséquences côté client :
 *  - AUCUN header `Authorization: Bearer ...` construit en JS.
 *  - Toute requête vers l'API utilise `credentials: "include"` : le
 *    navigateur joint le cookie automatiquement.
 *  - `document.cookie` ne peut PAS lire le token (HttpOnly) : même en cas
 *    de XSS résiduel, la session n'est pas exfiltrable.
 */

/** Endpoints d'authentification : un 401 y est NORMAL (mauvais mot de passe),
 *  il ne doit jamais declencher l'expiration de session globale. */
const AUTH_ENDPOINT_RE = /\/api\/v\d+\/auth\//;

/**
 * Stockage d'isolation Multi-Tenant de l'agence connectée.
 */
let activeTenantId: string | null = null;

export function setActiveTenantId(tenantId: string | null): void {
  activeTenantId = tenantId;
}

export function getActiveTenantId(): string | null {
  return activeTenantId;
}

/**
 * Règle d'exclusion (bypass) stricte pour l'intercepteur 401.
 * Ne doit jamais intercepter comme une expiration de session :
 * - Les endpoints d'authentification (/api/v5/auth/token, /api/v5/auth/guest-login, etc.)
 * - Tout chemin d'authentification générale défini par AUTH_ENDPOINT_RE.
 */
export function isBypassUrl(url: string): boolean {
  return (
    url.includes("/api/v5/auth/token") ||
    url.includes("/api/v5/auth/guest-login") ||
    AUTH_ENDPOINT_RE.test(url)
  );
}

export async function secureFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

  // Contournement direct pour les ressources locales (blob:, data:) :
  // évite d'injecter des en-têtes HTTP de cookies ou de tenant_id qui feraient
  // crasher le moteur de fetch natif du navigateur sur des protocoles non-HTTP.
  if (url.startsWith("blob:") || url.startsWith("data:")) {
    return fetch(input, init);
  }

  const headers = new Headers(init.headers);

  // Injection étanche et automatique du tenant_id de l'agence connectée
  // sur toutes les requêtes sortantes vers l'API (sauf pour les routes bypassées)
  if (activeTenantId && !isBypassUrl(url)) {
    headers.set("X-Tenant-ID", activeTenantId);
  }

  const response = await fetch(input, {
    ...init,
    headers,
    // Le cookie HttpOnly narchi_session est joint automatiquement.
    credentials: "include",
  });

  // ------------------------------------------------------------------
  // P1-B : INTERCEPTEUR 401 GLOBAL.
  // Session expiree en plein travail -> ouverture du disjoncteur de
  // trafic (gel de flushQueue/pollers) + broadcast pour que AuthStore
  // nettoie l'etat memoire et que le Router raffiche Login.
  // Les endpoints /auth/ sont exclus : un 401 y signifie simplement
  // "identifiants invalides", pas "session expiree".
  // ------------------------------------------------------------------
  if (response.status === 401 && !isBypassUrl(url)) {
    if (!sessionSecurity.isSuspended()) {
      sessionSecurity.suspend();
      window.dispatchEvent(new CustomEvent("narchi-session-expired"));
    }
  }
  return response;
}

/**
 * Déconnexion sécurisée : demande au backend d'invalider le cookie
 * (Set-Cookie avec Max-Age=0) puis purge les résidus locaux.
 * Le client NE PEUT PAS supprimer un cookie HttpOnly lui-même — c'est
 * volontairement une opération serveur.
 */
export async function secureLogout(): Promise<void> {
  try {
    await secureFetch("/api/v5/auth/logout", { method: "POST" });
  } catch {
    /* le backend peut être injoignable — la purge locale reste faite */
  }
  purgeLegacyTokenStorage();
  setActiveTenantId(null);
}

/**
 * Vérifie l'existence d'une session valide SANS jamais lire le token :
 * on interroge le backend, qui valide le cookie HttpOnly côté serveur.
 */
export async function hasActiveSession(): Promise<boolean> {
  try {
    const res = await secureFetch("/api/v5/auth/me", { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// 3. INITIALISATION DE LA COUCHE DE SÉCURITÉ (à appeler dans main.tsx)
// ============================================================================

/**
 * Initialise la couche de sécurité au démarrage de l'application :
 *  1. Purge les tokens hérités du stockage JavaScript (liste blanche
 *     EXPLICITE — pas de regex large qui effacerait des clés légitimes
 *     comme narchi:chatread:* ou les préférences UI).
 *  2. Alerte si l'app tourne en HTTP en production (cookies Secure inopérants).
 *  3. Alerte si aucune Content-Security-Policy n'est détectée en production.
 *
 * Usage (main.tsx) :
 *   import { initializeSecurityLayer } from "@/auth/SecuritySanitizer";
 *   initializeSecurityLayer();
 */
export function initializeSecurityLayer(): void {
  // 1. Purge ciblée des tokens hérités.
  purgeLegacyTokenStorage();

  const isProd = (import.meta as { env?: { PROD?: boolean } }).env?.PROD === true;

  // 2. HTTPS obligatoire en production (sinon le flag Secure est inopérant).
  if (isProd && window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
    console.error(
      "[SecuritySanitizer] ALERTE : application servie en HTTP en production — " +
      "le cookie Secure ne sera pas transmis. Activez TLS."
    );
  }

  // 3. Détection CSP (l'en-tête HTTP est préférable ; le <meta> est un indice).
  const cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  if (isProd && !cspMeta) {
    console.warn(
      "[SecuritySanitizer] Aucune CSP <meta> détectée. Vérifiez que l'en-tête " +
      "Content-Security-Policy est bien posé par nginx (frontend/nginx.conf)."
    );
  }

  console.info("[SecuritySanitizer] Couche de sécurité initialisée.");
}

// ============================================================================
// 4. VECTEURS DE TEST XSS (pour les tests unitaires Vitest)
// ============================================================================

/** Chaque vecteur DOIT ressortir de sanitizeChatMessage() sans < > " ' / bruts. */
export const XSS_TEST_VECTORS: readonly string[] = [
  `<script>alert("xss")</script>`,
  `<img src=x onerror=alert(1)>`,
  `"><svg onload=alert(1)>`,
  `javascript:void(alert(1))`,
  `' OR '1'='1`,
  `</textarea><script>fetch('/api')</script>`,
] as const;

/** Auto-validation : true si aucun vecteur ne survit à la sanitisation. */
export function validateXSSProtection(): boolean {
  return XSS_TEST_VECTORS.every((vector) => {
    const out = sanitizeChatMessage(vector);
    // Après sanitisation, plus AUCUN caractère brut < > " ' ne doit subsister.
    return !/[<>"']/.test(out);
  });
}
