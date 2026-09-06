/**
 * Harnais d'exécution du Worker IFC bundlé (esbuild, format ESM + splitting,
 * identique à la structure produite par Vite en production).
 *
 * Simule l'environnement Web Worker dans Node (shim `self`) et rejoue le
 * cycle complet d'un import : amorçage (WORKER_READY) → phase 1 (takeoff
 * streaming) → phase 2 (validation WASM, volontairement impossible ici).
 *
 * Variables d'environnement :
 *   ENTRY     Chemin du worker bundlé (ifcParser.worker.js).
 *   IFC_FILE  Fichier IFC à envoyer.
 *   SCENARIO  "normal" (succès attendu) | "malformed" (PARSE_ERROR attendu).
 *
 * Sortie : une ligne JSON par événement reçu + verdict final
 *   {"verdict":"OK"}   → exit 0
 *   {"verdict":"FAIL"} → exit 1
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const ENTRY = process.env.ENTRY;
const IFC_FILE = process.env.IFC_FILE;
const SCENARIO = process.env.SCENARIO ?? "normal";
const TIMEOUT_MS = 30_000;

const inbox = [];
const handlers = { message: new Set() };

// --- Shim Web Worker minimal ------------------------------------------------
globalThis.self = {
  location: { origin: "http://ifc-smoke.invalid" },
  addEventListener: (type, fn) => {
    if (handlers[type]) handlers[type].add(fn);
  },
  removeEventListener: (type, fn) => {
    if (handlers[type]) handlers[type].delete(fn);
  },
  postMessage: (msg) => {
    inbox.push(msg);
    const summary = { event: msg.type };
    if (msg.stage) summary.stage = msg.stage;
    if (msg.error) summary.error = `${msg.error.code}: ${msg.error.message}`;
    if (msg.validation) summary.validation = msg.validation;
    if (msg.payload)
      summary.payload = {
        elementCount: msg.payload.elementCount,
        takeoffElements: msg.payload.takeoff?.elements?.length ?? 0,
      };
    console.log(JSON.stringify(summary));
  },
};

const killer = setTimeout(() => {
  console.log(JSON.stringify({ verdict: "FAIL", reason: `timeout global ${TIMEOUT_MS} ms — le Worker s'est tu ou boucle sans répondre` }));
  process.exit(1);
}, TIMEOUT_MS);

function fail(reason) {
  clearTimeout(killer);
  console.log(JSON.stringify({ verdict: "FAIL", reason }));
  process.exit(1);
}

function ok(extra = {}) {
  clearTimeout(killer);
  console.log(JSON.stringify({ verdict: "OK", ...extra }));
  process.exit(0);
}

function waitFor(predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = inbox.find(predicate);
      if (found) {
        clearInterval(timer);
        resolve(found);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`aucun ${label} après ${timeoutMs} ms`));
      }
    }, 10);
  });
}

// --- Exécution ---------------------------------------------------------------
try {
  await import(path.resolve(ENTRY));
} catch (err) {
  fail(`ÉVALUATION du script du Worker : ${err?.message ?? err}`);
}

// 1) La preuve de vie doit arriver IMMÉDIATEMENT après l'évaluation.
try {
  await waitFor((m) => m.type === "WORKER_READY", 5_000, "WORKER_READY");
} catch (err) {
  fail(err.message);
}

// 2) Envoi du fichier.
const bytes = readFileSync(IFC_FILE);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const request = {
  type: "PARSE_IFC",
  requestId: "smoke-1",
  fileName: path.basename(IFC_FILE),
  buffer,
};
for (const fn of handlers.message) fn({ data: request });

if (SCENARIO === "malformed") {
  try {
    await waitFor((m) => m.type === "PARSE_ERROR", 15_000, "PARSE_ERROR");
    ok({ scenario: SCENARIO, note: "entrée malformée rejetée proprement, sans crash ni boucle" });
  } catch (err) {
    fail(err.message);
  }
}

// 3) Scénario normal : le takeoff DOIT aboutir, même sans WASM.
let success;
try {
  success = await waitFor((m) => m.type === "PARSE_SUCCESS", 15_000, "PARSE_SUCCESS");
} catch (err) {
  fail(err.message);
}
if (!success.payload?.takeoff?.elements?.length) {
  fail("PARSE_SUCCESS sans éléments de takeoff");
}

// 4) Phase 2 : dans ce sandbox (et chez tout utilisateur dont le chunk
// web-ifc/WASM est injoignable), la validation doit échouer GRACIEUSEMENT.
let validationNote = "absente";
try {
  const validation = await waitFor((m) => m.type === "PARSE_VALIDATION", 20_000, "PARSE_VALIDATION");
  validationNote = validation.validation?.validated
    ? "WASM validé"
    : `dégradé gracieux (${validation.validation?.warning ?? "sans détail"})`;
} catch {
  validationNote = "phase 2 muette (tolérée : le succès est déjà livré)";
}

ok({
  scenario: SCENARIO,
  elements: success.payload.takeoff.elements.length,
  phase2: validationNote,
});
