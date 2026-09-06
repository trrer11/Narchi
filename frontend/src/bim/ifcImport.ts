/**
 * IMPORT IFC RÉSILIENT — NARCHI CORE V4
 * --------------------------------------
 * Stratégie à deux moteurs, dans cet ordre :
 *
 *  1. **Web Worker** (`IfcWorkerPool`) : parsing hors thread principal,
 *     watchdog et validation WASM en bonus — le chemin normal.
 *  2. **Thread principal** (repli automatique) : si le script du Worker
 *     n'a JAMAIS pu démarrer (IfcWorkerBootError — chunk bloqué par
 *     l'environnement : web-shield antivirus, extension, navigateur sans
 *     Workers ES modules, politique réseau), le même parseur streaming
 *     s'exécute ici, sans Worker ni WASM. Il fonctionne dans 100 % des
 *     navigateurs ; sur très gros fichier, l'UI peut marquer une courte
 *     pause, mais l'import aboutit toujours.
 *
 * Un échec de PARSING (fichier réellement corrompu, timeout de traitement)
 * ne bascule JAMAIS vers le repli : le Worker a démontré qu'il fonctionne,
 * c'est le fichier qui est en cause — la même erreur se reproduirait.
 */

import {
  IfcWorkerBootError,
  IfcWorkerPool,
  type IfcParseSuccess,
} from "@/bim/WorkerWatchdog";
import { markWorkersBlocked } from "@/bim/workerEnv";
import { parseIfcBytes } from "@/lib/ifcParser";
import { ifcToTakeoff } from "@/lib/modelTakeoff";

export type IfcImportEngine = "worker" | "main-thread";

export interface IfcImportResult {
  payload: IfcParseSuccess["payload"];
  /** Moteur ayant réellement produit le résultat (diagnostic / télémétrie). */
  engine: IfcImportEngine;
}

export async function importIfcResilient(
  pool: IfcWorkerPool,
  getFileData: () => Promise<ArrayBuffer>,
  fileName: string,
  timeoutMs = 90_000,
): Promise<IfcImportResult> {
  try {
    const payload = await pool.parse(getFileData, fileName, timeoutMs);
    return { payload, engine: "worker" };
  } catch (error) {
    if (!(error instanceof IfcWorkerBootError)) throw error;
    // Mémorisé pour la session : la visionneuse 3D évitera aussi le moteur
    // à Workers et ira directement à la géométrie sans Worker.
    markWorkersBlocked(error);
    console.warn(
      "[IFC] Web Worker indisponible dans cet environnement — " +
        "repli automatique sur le thread principal :",
      error.message,
    );
  }

  const buffer = await getFileData();
  const startedAt = performance.now();
  const parsed = parseIfcBytes(new Uint8Array(buffer), fileName);
  if (!parsed.ok) {
    throw new Error(
      parsed.warnings[0] ?? "Structure IFC illisible (aucune entité reconnue).",
    );
  }
  return {
    engine: "main-thread",
    payload: {
      modelID: -1, // pas de modèle WASM en mode repli — la 3D Fragments ouvre le fichier elle-même
      elementCount: parsed.entities.size,
      schema: parsed.schema || null,
      durationMs: Math.round(performance.now() - startedAt),
      takeoff: ifcToTakeoff(parsed),
      validated: false,
    },
  };
}
