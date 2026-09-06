/* §101 — Service Worker NARCHI (PWA #10 ; §103 : cible = poste de bureau,
 * la voie « téléphone au chantier » a été abandonnée — HTTP simple sans
 * TLS n'autorise pas de SW hors localhost).
 *
 * Ce que ce fichier fait — EXACTEMENT :
 *  1. installe une coquille applicative cachée (index.html) pour que
 *     l'application DÉMARRE hors-ligne (chantier sans réseau) ;
 *  2. sert les assets FINGERPRINTÉS (/assets/*.[hash].js, /vendor/*) en
 *     cache-first : leur nom change à chaque build, un vieux exemplaire
 *     ne peut jamais supplanter un nouveau ;
 *  3. sert la navigation en NETWORK-FIRST : en ligne, le serveur décide
 *     toujours ; hors-ligne, repli sur la coquille cachée ;
 *  4. ne met JAMAIS en cache /api/ (ni aucune autre origine, ni le non-GET) :
 *     un vieux prix ou un vieux projet servi « comme si frais » serait un
 *     mensonge d'état — hors-ligne, l'API échoue et l'UI le dit (comportement
 *     existant : OfflineOutbox met en file, les écrans affichent l'erreur).
 *
 * Bump CACHE_VERSION seulement quand la LOGIQUE de ce fichier change : le
 * contenu, lui, est adressé par empreinte (aucun risque d'obsolescence).
 * Le test frontend/src/lib/pwa.test.ts épingle ce contrat.
 */
"use strict";

const CACHE_VERSION = "narchi-shell-v1";
const CACHE_STATIC = "narchi-icons-v1";

const ICON_URLS = [
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-192.png",
  "/icon-maskable-512.png",
];

// Fingerprint Vite : tout ce qui porte un hash de contenu dans son nom.
const FINGERPRINTED_RE = /^\/(assets|vendor)\//;

function isSameOriginGet(url, request) {
  return request.method === "GET" && url.origin === self.location.origin;
}

function isNavigation(request) {
  return (
    request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html")
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_STATIC)
      .then((cache) => cache.addAll(ICON_URLS))
      .catch(() => undefined) // une icône manquante ne doit pas casser l'install
  );
  // Le prompt de mise à jour (pwa.ts) décide quand activer : postMessage
  // "SKIP_WAITING". Sans prompt (première installation), on active de suite.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== CACHE_VERSION && name !== CACHE_STATIC)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function networkFirstShell(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const fresh = await fetch(request, { cache: "no-store" });
    if (fresh && fresh.ok) {
      cache.put("/", fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await caches.match("/", { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirstFingerprinted(request, cacheKey) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(cacheKey || request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) {
    cache.put(cacheKey || request, fresh.clone());
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (!isSameOriginGet(url, event.request)) return;

  // /api/ : JAMAIS mis en cache, toujours le réseau (ou l'échec honnête).
  if (url.pathname.startsWith("/api/")) return;

  // Navigation : réseau d'abord, coquille cachée en repli hors-ligne.
  if (isNavigation(event.request)) {
    event.respondWith(networkFirstShell(event.request));
    return;
  }

  // Assets fingerprintés : cache-first, sans risque (nom = empreinte).
  if (FINGERPRINTED_RE.test(url.pathname)) {
    event.respondWith(cacheFirstFingerprinted(event.request));
    return;
  }

  // Le reste same-origin statique (icônes, manifeste, sw.js lu par le
  // navigateur hors 'fetch') : cache-first sobre avec stockage d'appoint.
  event.respondWith(cacheFirstFingerprinted(event.request, event.request.url));
});
