/**
 * WORKER WATCHDOG — NARCHI CORE V4 (Module de sécurité BIM)
 * ---------------------------------------------------------
 * Gestionnaire de Web Worker équipé d'un Watchdog de sécurité pour le
 * parsing IFC hors thread principal.
 *
 * Failles corrigées (audit destructif — Faille n°1) :
 *  - Un fichier IFC corrompu ou volumineux pouvait geler le thread du Worker
 *    indéfiniment (boucle infinie dans le runtime WASM web-ifc) sans aucun
 *    mécanisme de récupération.
 *  - Aucune limite de temps n'était imposée : l'onglet devenait "zombie".
 *
 * Stratégie :
 *  1. Chaque parsing reçoit un identifiant de requête unique (anti-collision
 *     si plusieurs fichiers sont soumis en parallèle).
 *  2. Un timer Watchdog est armé au lancement. S'il expire avant la réponse
 *     du Worker : worker.terminate() est appelé (libération immédiate du
 *     thread et de la mémoire WASM), puis la promesse est rejetée.
 *  3. Les erreurs fatales interceptées dans le Worker (voir
 *     `workers/ifcParser.worker.ts`) remontent sous forme de message
 *     structuré `{ type: "PARSE_ERROR" }` et rejettent proprement la
 *     promesse au lieu de crasher silencieusement.
 *  4. Poignée de main d'amorçage : le Worker poste `WORKER_READY` à la fin
 *     de l'évaluation de son script. Le Pool attend cette annonce AVANT tout
 *     parsing — un Worker dont le script n'a jamais pu se charger (chunk JS
 *     bloqué par une connexion réinitialisée, un cache obsolète ou une CSP)
 *     est détecté en quelques secondes avec un message qui nomme la vraie
 *     cause, et une seconde tentative avec un Worker neuf est jouée
 *     automatiquement (les resets réseau transitoires sont absorbés).
 */

// ============================================================================
// PROTOCOLE DE MESSAGES (partagé avec workers/ifcParser.worker.ts)
// ============================================================================

export interface IfcParseRequest {
  type: "PARSE_IFC";
  requestId: string;
  fileName: string;
  /** Contenu binaire du fichier IFC (transféré, jamais copié). */
  buffer: ArrayBuffer;
}

export interface IfcParseSuccess {
  type: "PARSE_SUCCESS";
  requestId: string;
  payload: {
    /** -1 en mode dégradé (validation WASM non aboutie, modèle WASM fermé). */
    modelID: number;
    elementCount: number;
    schema: string | null;
    /** Durée du parsing côté Worker, en millisecondes. */
    durationMs: number;
    takeoff: import("@/lib/modelTakeoff").ModelTakeoff;
    /**
     * false tant que la validation croisée WASM n'a pas confirmé le modèle.
     * La validation WASM s'exécute APRÈS ce message (phase 2) : si elle
     * réussit, un message PARSE_VALIDATION la confirme ; si elle échoue ou
     * fait mourir le Worker, l'import reste valide (mode dégradé).
     */
    validated: boolean;
  };
}

export interface IfcParseProgress {
  type: "PARSE_PROGRESS";
  requestId: string;
  stage: string;
}

/** Confirmation (ou échec gracieux) de la validation WASM de phase 2. */
export interface IfcParseValidation {
  type: "PARSE_VALIDATION";
  requestId: string;
  validation: {
    validated: boolean;
    elementCount?: number;
    schema?: string | null;
    warning?: string;
  };
}

export interface IfcParseError {
  type: "PARSE_ERROR";
  requestId: string;
  error: {
    message: string;
    /** Code stable pour la télémétrie ("WASM_FATAL", "OPEN_MODEL_FAILED", …). */
    code: string;
    stack?: string;
  };
}

/**
 * Poignée de main d'amorçage, postée par le Worker à la fin de l'évaluation
 * de son script — SANS requestId (elle précède toute requête). Deux
 * interfaces distinctes (et non une union de littéraux) pour que le
 * narrowing TypeScript discrimine chaque cas.
 */
export interface IfcWorkerReady {
  type: "WORKER_READY";
}

export interface IfcWorkerBootFailure {
  type: "WORKER_BOOT_ERROR";
  /** Détail de l'exception synchrone d'évaluation. */
  message?: string;
}

export type IfcWorkerBoot = IfcWorkerReady | IfcWorkerBootFailure;

export type IfcWorkerResponse =
  | IfcParseSuccess
  | IfcParseError
  | IfcParseProgress
  | IfcParseValidation
  | IfcWorkerBoot;

export const IFC_PARSE_TIMEOUT_MESSAGE =
  "Timeout de parsing : Le fichier IFC est corrompu ou trop lourd";

export const IFC_WORKER_BOOT_MESSAGE =
  "Le moteur d'import IFC n'a pas pu démarrer : son script n'a pas été " +
  "chargé par le navigateur (connexion réinitialisée pendant le téléchargement " +
  "du chunk assets/*.js, cache navigateur obsolète ou blocage CSP). " +
  "Rechargez la page avec Ctrl+F5 puis réessayez.";

/** Erreur typée de DÉMARRAGE du Worker (script jamais chargé/évalué). */
export class IfcWorkerBootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IfcWorkerBootError";
  }
}

/** Erreur typée levée par le Watchdog (permet un `instanceof` côté UI). */
export class IfcParseTimeoutError extends Error {
  public readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(IFC_PARSE_TIMEOUT_MESSAGE);
    this.name = "IfcParseTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

// ============================================================================
// WATCHDOG
// ============================================================================

let requestCounter = 0;

function nextRequestId(): string {
  requestCounter += 1;
  const entropy =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `ifc-parse-${requestCounter}-${entropy}`;
}

/**
 * Lance le parsing d'un fichier IFC dans le Worker fourni, sous surveillance
 * d'un Watchdog.
 *
 * @param worker    Instance de Worker exécutant `workers/ifcParser.worker.ts`.
 * @param fileData  Contenu binaire du fichier IFC. ATTENTION : le buffer est
 *                  TRANSFÉRÉ au Worker (zéro-copie) et devient inutilisable
 *                  dans le thread appelant après l'appel.
 * @param timeoutMs Délai maximal accordé au Worker (30 000 ms par défaut).
 *
 * @throws IfcParseTimeoutError si le Worker ne répond pas dans le délai.
 *         Le Worker est alors IMMÉDIATEMENT terminé via `worker.terminate()`
 *         pour libérer le CPU et la mémoire WASM.
 */
export function parseIfcWithTimeout(
  worker: Worker,
  fileData: ArrayBuffer,
  fileName: string,
  timeoutMs: number = 30000,
): Promise<IfcParseSuccess["payload"]> {
  const requestId = nextRequestId();

  return new Promise<IfcParseSuccess["payload"]>((resolve, reject) => {
    let settled = false;
    let lastStage = "DEMARRAGE";
    const sizeMo = (fileData.byteLength / 1024 / 1024).toFixed(1);

    // --- Armement du Watchdog -------------------------------------------
    const watchdogTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      // Le Worker est considéré comme compromis : on le tue sans négociation.
      worker.terminate();
      reject(
        new Error(
          `${IFC_PARSE_TIMEOUT_MESSAGE} (dernière étape : ${lastStage}, fichier : ${sizeMo} Mo, délai : ${timeoutMs / 1000} s)`
        )
      );
    }, timeoutMs);

    const onMessage = (event: MessageEvent<IfcWorkerResponse>) => {
      const data = event.data;
      if (!data) return;
      // Messages d'amorçage : traités exclusivement par awaitWorkerReady().
      if (data.type === "WORKER_READY" || data.type === "WORKER_BOOT_ERROR") return;
      // Ignore les messages d'autres requêtes (parsing concurrent).
      if (data.requestId !== requestId) return;
      if (data.type === "PARSE_PROGRESS") {
        lastStage = data.stage;
        console.info(`[IFC Worker] ${data.stage}`);
        return;
      }
      if (data.type === "PARSE_VALIDATION") {
        // Phase 2 : simple confirmation (ou échec gracieux) post-succès.
        console.info(
          `[IFC Worker] validation WASM : ${data.validation.validated ? "OK" : `ignorée/échouée (${data.validation.warning ?? "sans détail"})`}`
        );
        return;
      }
      if (settled) return;
      settled = true;
      cleanup();

      if (data.type === "PARSE_SUCCESS") {
        resolve(data.payload);
      } else {
        reject(
          new Error(
            `Échec du parsing IFC [${data.error.code}] : ${data.error.message}`
          )
        );
      }
    };

    const onError = (event: ErrorEvent) => {
      // Erreur non interceptée dans le Worker (crash du runtime lui-même).
      if (settled) return;
      settled = true;
      cleanup();
      worker.terminate();
      // Diagnostic maximal : quand le navigateur tue le Worker (dépassement
      // mémoire, runtime .wasm injoignable…), ErrorEvent.message est vide —
      // on enrichit avec la position exacte du crash et la cause probable,
      // ADAPTÉE À L'ÉTAPE, pour ne plus jamais afficher un stérile
      // « erreur inconnue » ni accuser la mémoire à tort.
      const file = event.filename ? event.filename.split("/").pop() : null;
      const position = file ? ` [${file}:${event.lineno ?? "?"}:${event.colno ?? "?"}]` : "";
      const detail = event.message
        ? event.message
        : lastStage === "DEMARRAGE"
          ? "erreur non rapportée par le navigateur (dernière étape : DEMARRAGE — " +
            `crash avant le début du parsing : allocation mémoire du transfert ou exception très précoce ; fichier : ${sizeMo} Mo)`
          : `erreur non rapportée par le navigateur (dernière étape : ${lastStage}, fichier : ${sizeMo} Mo — cause fréquente : dépassement mémoire du moteur WASM sur un fichier volumineux)`;
      reject(
        new Error(`Crash fatal du Worker IFC : ${detail}${position}`)
      );
    };

    const cleanup = () => {
      clearTimeout(watchdogTimer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);

    const request: IfcParseRequest = {
      type: "PARSE_IFC",
      requestId,
      fileName,
      buffer: fileData,
    };
    // Transfert zéro-copie : indispensable pour les IFC > 100 Mo.
    worker.postMessage(request, [fileData]);
  });
}

/**
 * Fabrique le Worker de parsing IFC (bundlé par Vite via `new URL(...)`).
 * À appeler une fois par session de visualisation, puis à réutiliser.
 */
export function createIfcParserWorker(): Worker {
  return new Worker(new URL("../workers/ifcParser.worker.ts", import.meta.url), {
    type: "module",
    name: "narchi-ifc-parser",
  });
}

/**
 * Attend la poignée de main d'amorçage du Worker (`WORKER_READY`).
 *
 * Sans cette attente, un Worker dont le SCRIPT n'a jamais pu être chargé
 * (chunk JS perdu : connexion réinitialisée, cache obsolète, CSP) ne se
 * distingue pas d'un crash pendant le traitement : le navigateur émet un
 * `ErrorEvent` vide. Ici, l'échec devient explicite et rapide :
 *  - `WORKER_READY` reçu        → promesse résolue, le Worker est vivant ;
 *  - `WORKER_BOOT_ERROR` reçu   → rejet avec le détail du Worker ;
 *  - événement `error` ou délai → rejet avec la cause probable et le réflexe
 *    Ctrl+F5, puis worker.terminate() (le corps est inutilisable).
 *
 * @throws IfcWorkerBootError dans tous les cas d'échec.
 */
export function awaitWorkerReady(worker: Worker, timeoutMs = 10_000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      // Corps inutilisable : on libère le thread immédiatement.
      worker.terminate();
      reject(new IfcWorkerBootError(message));
    };

    const timer = setTimeout(() => {
      fail(`${IFC_WORKER_BOOT_MESSAGE} (aucun signal du Worker après ${timeoutMs / 1000} s)`);
    }, timeoutMs);

    const onMessage = (event: MessageEvent<IfcWorkerResponse>) => {
      const data = event.data;
      if (!data) return;
      if (data.type === "WORKER_READY") {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      } else if (data.type === "WORKER_BOOT_ERROR") {
        fail(
          "Le script du Worker IFC a signalé une erreur à son évaluation : " +
            `${data.message ?? "inconnue"}. Rechargez la page avec Ctrl+F5.`,
        );
      }
      // Les messages de requête (PARSE_*) sont ignorés : ils appartiennent
      // à parseIfcWithTimeout(), qui installe ses propres écouteurs.
    };

    const onError = (event: ErrorEvent) => {
      const file = event.filename ? event.filename.split("/").pop() : null;
      const position = file ? ` [${file}:${event.lineno ?? "?"}:${event.colno ?? "?"}]` : "";
      fail(
        `${IFC_WORKER_BOOT_MESSAGE}${event.message ? ` Détail : ${event.message}` : ""}${position}`,
      );
    };

    const cleanup = (): void => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
  });
}

// ============================================================================
// POOL DE WORKERS AVEC CYCLE DE VIE GÉRÉ
// (recréation automatique après un terminate() déclenché par le Watchdog)
// ============================================================================

export class IfcWorkerPool {
  private worker: Worker | null = null;
  private workerReady: Promise<void> | null = null;
  private terminated = false;

  /**
   * @param createWorker    Fabrique de Worker (injectable pour les tests).
   * @param readyTimeoutMs  Délai d'attente de la preuve de vie WORKER_READY.
   */
  constructor(
    private readonly createWorker: () => Worker = createIfcParserWorker,
    private readonly readyTimeoutMs = 10_000,
  ) {}

  /**
   * Crée ou réutilise le Worker, avec sa promesse d'amorçage associée (une
   * poignée de main par Vie du Worker — les parsings suivants l'attendent
   * déjà résolue, donc sans aucun délai).
   */
  private getOrCreateWorker(): { worker: Worker; ready: Promise<void> } {
    if (this.terminated || !this.worker || !this.workerReady) {
      this.worker = this.createWorker();
      this.workerReady = awaitWorkerReady(this.worker, this.readyTimeoutMs);
      this.terminated = false;
    }
    return { worker: this.worker, ready: this.workerReady };
  }

  /** Marque le Worker courant comme mort et le termine (idempotent). */
  private discardWorker(): void {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        /* terminate() sur un Worker déjà mort est un no-op */
      }
    }
    this.terminated = true;
    this.worker = null;
    this.workerReady = null;
  }

  /**
   * Parsing supervisé avec amorçage garanti.
   *
   * @param getFileData  Fabrique produisant le binaire du fichier. Appelée
   *   UNE FOIS PAR TENTATIVE, et seulement APRÈS la preuve de vie du Worker :
   *   le buffer est transféré au Worker (zéro-copie), donc une fabrique est
   *   indispensable pour relire le fichier si une seconde tentative s'impose.
   * @param fileName     Nom du fichier (diagnostics).
   * @param timeoutMs    Délai maximal accordé AU PARSING (30 000 ms défaut).
   *
   * Séquence : preuve de vie (WORKER_READY, 10 s max) → lecture du fichier →
   * parsing supervisé. Une erreur d'AMORÇAGE (IfcWorkerBootError) déclenche
   * UNE seconde tentative avec un Worker neuf — elle absorbe les resets
   * réseau transitoires. Les échecs de parsing (timeout, PARSE_ERROR, crash
   * en cours de traitement) ne sont JAMAIS relancés : un fichier qui tue le
   * Worker une fois le tuerait pareillement une seconde fois.
   */
  async parse(
    getFileData: () => Promise<ArrayBuffer>,
    fileName: string,
    timeoutMs = 30000,
  ): Promise<IfcParseSuccess["payload"]> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { worker, ready } = this.getOrCreateWorker();
      try {
        await ready;
        const fileData = await getFileData();
        return await parseIfcWithTimeout(worker, fileData, fileName, timeoutMs);
      } catch (error) {
        // Toute erreur peut laisser le Worker dans un état incohérent : le
        // prochain parsing repart toujours avec un Worker propre.
        this.discardWorker();
        if (error instanceof IfcWorkerBootError && attempt === 1) {
          console.warn(
            "[IFC Worker] Amorçage impossible, seconde tentative avec un Worker neuf :",
            error.message,
          );
          continue;
        }
        throw error;
      }
    }
    // Inatteignable (la boucle relance ou lève toujours) — filet TypeScript.
    throw new IfcWorkerBootError(IFC_WORKER_BOOT_MESSAGE);
  }

  /** Arrêt propre (à appeler au démontage du composant consommateur). */
  dispose(): void {
    if (this.worker && !this.terminated) {
      this.worker.terminate();
    }
    this.terminated = true;
    this.worker = null;
  }
}
