/**
 * IFC PARSER WORKER — NARCHI CORE V4
 * ----------------------------------
 * Parsing IFC hors thread principal, supervisé par le Watchdog
 * (`bim/WorkerWatchdog.ts`).
 *
 * Sécurité (audit destructif — Faille n°1) :
 *  - L'appel `OpenModel()` du runtime WASM web-ifc est enveloppé dans un
 *    bloc try/catch : toute erreur fatale (fichier corrompu, allocation
 *    mémoire WASM impossible, schéma IFC invalide) est interceptée et
 *    renvoyée au thread principal sous forme de message structuré
 *    `PARSE_ERROR` au lieu de faire crasher le Worker silencieusement.
 *  - Le runtime est initialisé paresseusement et réutilisé entre les
 *    requêtes tant que le Worker vit.
 *
 * Amorçage increvable (crash constaté en production à l'étape DEMARRAGE) :
 *  - `web-ifc` est importé DYNAMIQUEMENT, uniquement en phase 2. Le script
 *    du Worker n'a donc AUCUNE dépendance lourde à l'évaluation : même si
 *    le chunk web-ifc (Emscripten, plusieurs Mo) est impossible à charger
 *    dans le navigateur (connexion réinitialisée, CSP, cache obsolète),
 *    le Worker démarre toujours et le takeoff de phase 1 est toujours livré.
 *  - Le Worker poste `WORKER_READY` une fois son script évalué : le thread
 *    principal distingue ainsi un Worker jamais chargé (erreur réseau au
 *    téléchargement du script) d'un crash ultérieur pendant le traitement.
 */

import type * as WebIFC from "web-ifc";
import { parseIfcBytes } from "@/lib/ifcParser";
import { ifcToTakeoff } from "@/lib/modelTakeoff";
import type {
  IfcParseRequest,
  IfcParseError,
  IfcParseProgress,
  IfcParseSuccess,
  IfcParseValidation,
  IfcWorkerBoot,
} from "@/bim/WorkerWatchdog";

// ============================================================================
// RUNTIME WASM (singleton par Worker)
// ============================================================================

/**
 * Import DYNAMIQUE de web-ifc : jamais à l'évaluation du script du Worker
 * (voir l'en-tête du fichier). Un échec ici est dégradé en validation WASM
 * non confirmée — il ne fait jamais échouer un import déjà réussi.
 */
function importWebIfcModule(): Promise<typeof import("web-ifc")> {
  return import("web-ifc").catch((err: unknown) => {
    throw new Error(
      `Module web-ifc non chargeable dans le Worker : ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  });
}

let ifcApi: WebIFC.IfcAPI | null = null;
let initPromise: Promise<WebIFC.IfcAPI> | null = null;

function resolveWasmBase(): string {
  // Dans un Worker, un chemin relatif peut être résolu par rapport à l'URL
  // blob du bundle au lieu de l'origine Nginx. On force donc une URL absolue.
  const assetBase = (import.meta.env.VITE_ASSET_BASE || "").replace(/\/$/, "");
  const configured = import.meta.env.VITE_IFC_WASM_BASE || `${assetBase}/ifc/`;
  const withSlash = configured.endsWith("/") ? configured : `${configured}/`;
  return new URL(withSlash, self.location.origin).href;
}

async function assertWasmAsset(wasmBase: string): Promise<void> {
  const wasmUrl = new URL("web-ifc.wasm", wasmBase).href;
  const response = await fetch(wasmUrl, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`Runtime IFC introuvable (${response.status}) : ${wasmUrl}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const magic = [0x00, 0x61, 0x73, 0x6d];
  const valid = magic.every((value, index) => bytes[index] === value);
  if (!valid) {
    const contentType = response.headers.get("content-type") || "inconnu";
    throw new Error(
      `Runtime IFC invalide : ${wasmUrl} renvoie ${contentType} au lieu d'un fichier WebAssembly. ` +
      "Vérifiez que /ifc/web-ifc.wasm est bien servi par Nginx.",
    );
  }
}

async function getRuntime(): Promise<WebIFC.IfcAPI> {
  if (ifcApi) return ifcApi;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const webIfcModule = await importWebIfcModule();
    const api = new webIfcModule.IfcAPI();
    // Les assets WASM sont servis localement depuis /ifc/ (copiés au build
    // par scripts/copy-ifc-assets.mjs) — aucun CDN externe, conforme CSP.
    const wasmBase = resolveWasmBase();
    await assertWasmAsset(wasmBase);
    // web-ifc concatène lui-même `web-ifc.wasm` au chemin fourni, même
    // lorsque `absolute=true`. Il faut donc fournir l'URL absolue du
    // répertoire, avec le slash final, et non l'URL complète du fichier.
    // Source vérifiée dans web-ifc 0.0.77 : `wasmPath + path`.
    api.SetWasmPath(wasmBase, true);
    // web-ifc 0.0.77 sélectionne automatiquement la variante
    // multithread dès que crossOriginIsolated=true. Dans ce Worker, cette
    // variante peut rester bloquée sur certains environnements Chromium/WSL2.
    // Le parsing IFC reste fiable en mode mono-thread et utilise le WASM
    // validé ci-dessus.
    await api.Init(undefined, true);
    ifcApi = api;
    return api;
  })();

  return initPromise;
}

// ============================================================================
// PIPELINE DE PARSING SÉCURISÉ
// ============================================================================

function postProgress(requestId: string, stage: string): void {
  const response: IfcParseProgress = { type: "PARSE_PROGRESS", requestId, stage };
  self.postMessage(response);
}

function postValidation(
  requestId: string,
  validation: IfcParseValidation["validation"],
): void {
  const response: IfcParseValidation = { type: "PARSE_VALIDATION", requestId, validation };
  self.postMessage(response);
}

async function handleParseRequest(request: IfcParseRequest): Promise<void> {
  const { requestId, buffer, fileName } = request;
  const startedAt = performance.now();

  // ==================================================================
  // PHASE 1 — PARSING STREAMING (léger, sans WASM) : produit le takeoff
  // ==================================================================
  // Cette phase passe TOUJOURS en premier : son empreinte mémoire reste
  // modique quelle que soit la taille du fichier, donc l'import réussit
  // même quand la validation WASM (phase 2) rendrait le Worker intenable.
  const data = new Uint8Array(buffer);
  let takeoff: IfcParseSuccess["payload"]["takeoff"];
  let streamedElementCount = 0;
  let streamedSchema: string | null = null;
  try {
    postProgress(requestId, "TEXT_PARSE_START");
    const parsedModel = parseIfcBytes(data, fileName);
    postProgress(requestId, "TEXT_PARSE_DONE");
    if (!parsedModel.ok) {
      throw new Error(
        parsedModel.warnings[0] ?? "Structure IFC illisible (aucune entité reconnue)."
      );
    }
    takeoff = ifcToTakeoff(parsedModel);
    postProgress(requestId, "TAKEOFF_DONE");
    streamedElementCount = parsedModel.entities.size;
    streamedSchema = parsedModel.schema || null;
  } catch (err) {
    postError(requestId, "TAKEOFF_FAILED", err);
    return;
  }

  // Succès envoyé IMMÉDIATEMENT : si la phase 2 fait mourir le Worker
  // (OOM WASM sur fichier volumineux), l'import RESTE réussi.
  const success: IfcParseSuccess = {
    type: "PARSE_SUCCESS",
    requestId,
    payload: {
      modelID: -1,
      elementCount: streamedElementCount,
      schema: streamedSchema,
      durationMs: Math.round(performance.now() - startedAt),
      takeoff,
      validated: false,
    },
  };
  self.postMessage(success);

  // ==================================================================
  // PHASE 2 — VALIDATION CROISÉE WASM (best effort, post-succès)
  // ==================================================================
  // Le message ci-dessous confirme le modèle quand tout va bien. Toute
  // erreur est dégradée en PARSE_VALIDATION{validated:false} : elle ne
  // doit JAMAIS faire échouer un import déjà réussi.
  if (buffer.byteLength > MAX_WASM_VALIDATION_BYTES) {
    postValidation(requestId, {
      validated: false,
      warning: `validation croisée ignorée (fichier > ${MAX_WASM_VALIDATION_BYTES / 1024 / 1024} Mo)`,
    });
    return;
  }

  let modelID: number | null = null;
  try {
    postProgress(requestId, "WASM_INIT_START");
    const api = await getRuntime();
    postProgress(requestId, "WASM_INIT_DONE");

    postProgress(requestId, "OPEN_MODEL_START");
    try {
      modelID = api.OpenModel(data, {
        COORDINATE_TO_ORIGIN: true,
        USE_FAST_BOOLS: true,
      } as WebIFC.LoaderSettings);
    } catch {
      // Second essai sans optimisations (certains IFC 2x3 exotiques).
      modelID = api.OpenModel(data);
    }

    if (typeof modelID !== "number" || modelID < 0) {
      throw new Error("OpenModel a renvoyé un identifiant de modèle invalide.");
    }
    postProgress(requestId, "OPEN_MODEL_DONE");

    let elementCount = streamedElementCount;
    let schema: string | null = streamedSchema;
    try {
      const allLines = api.GetAllLines(modelID);
      elementCount = allLines.size();
      (allLines as { delete?: () => void }).delete?.();
      schema = api.GetModelSchema(modelID) ?? schema;
    } catch {
      // Métadonnées optionnelles : le takeoff est déjà livré.
    }

    // Le handle n'est pas conservé : ce modèle n'est qu'un validateur, le
    // viewer Fragments ouvre sa propre représentation du fichier.
    api.CloseModel(modelID);
    modelID = null;
    postValidation(requestId, { validated: true, elementCount, schema });
  } catch (err) {
    if (modelID !== null) {
      try {
        ifcApi?.CloseModel(modelID);
      } catch {
        /* runtime possiblement irrécupérable — ignoré */
      }
    }
    postValidation(requestId, {
      validated: false,
      warning: err instanceof Error ? err.message : "validation WASM impossible",
    });
  }
}

// Au-delà de cette taille, le modèle WASM web-ifc (3-10× la taille du
// fichier en mémoire linéaire) risquerait de faire tuer le Worker par le
// navigateur. La validation croisée est alors simplement ignorée : le
// takeoff produit par le parseur streaming suffit à l'import.
const MAX_WASM_VALIDATION_BYTES = 64 * 1024 * 1024;

function postError(requestId: string, code: string, err: unknown): void {
  const response: IfcParseError = {
    type: "PARSE_ERROR",
    requestId,
    error: {
      code,
      message:
        err instanceof Error
          ? err.message
          : "Erreur fatale non identifiée dans le runtime IFC.",
      stack: err instanceof Error ? err.stack : undefined,
    },
  };
  self.postMessage(response);
}

// ============================================================================
// POINT D'ENTRÉE — enregistrement du gestionnaire + poignée de main d'amorçage
// ============================================================================

try {
  self.addEventListener("message", (event: MessageEvent<IfcParseRequest>) => {
    const data = event.data;
    if (data?.type === "PARSE_IFC") {
      void handleParseRequest(data);
    }
  });
  // Prouve au thread principal que le script a été téléchargé ET évalué
  // jusqu'au bout. Sans ce message, un Worker mort-né (script jamais chargé)
  // est indistinguishable d'un crash pendant le traitement, et produisait le
  // stérile « erreur non rapportée par le navigateur » à l'étape DEMARRAGE.
  const ready: IfcWorkerBoot = { type: "WORKER_READY" };
  self.postMessage(ready);
} catch (err) {
  // Toute exception synchrone à l'évaluation est rapportée explicitement ;
  // seules les erreurs de CHARGEMENT des imports statiques restent hors de
  // portée de ce garde-fou (elles sont détectées côté principal par
  // l'absence de WORKER_READY — voir awaitWorkerReady).
  const bootError: IfcWorkerBoot = {
    type: "WORKER_BOOT_ERROR",
    message: err instanceof Error ? err.message : String(err),
  };
  self.postMessage(bootError);
}
