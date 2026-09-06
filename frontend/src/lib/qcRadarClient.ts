// NARCHI §43 — Client radar QC : essaie le WORKER (fond = UI fluide), secours
// SYNCHRONE si window.Worker indisponible (vieux navigateur, test node).
// Un seul job à la fois par runner : toute relance `run` ANNULE le job
// précédent (rejet RadarCancelled, worker tué). Aucun résultat obsolète
// ne vient recouvrir l'état frais — source de vérité unique = la page.

import type { BuildingElement } from "@/data/types";
import { runRadarAnalysis, type RadarAnalysisResult, type RadarProgress } from "@/lib/qcRadarAnalysis";
import type { QcRadarResponse } from "@/workers/qcRadar.worker";

export type RadarWorkerFactory = () => Worker;

export class RadarCancelled extends Error {
  override name = "RadarCancelled";
  constructor() { super("radar-cancelled"); }
}

function defaultFactory(): Worker {
  return new Worker(new URL("../workers/qcRadar.worker.ts", import.meta.url), { type: "module" });
}

export interface RadarRun {
  promise: Promise<RadarAnalysisResult>;
  cancel: () => void;
}

/**
 * Runner à un seul job vivant (par runner). Worker si possible, sinon sync
 * asynchrone (microtask — l'UI respire une frame). `factory` = injection
 * de test (mock déterministe), inutile en production.
 */
export function createRadarRunner(factory: RadarWorkerFactory = defaultFactory) {
  let current: RadarRun | null = null;

  return {
    run(elements: BuildingElement[], onProgress?: (p: RadarProgress) => void): RadarRun {
      // Annule le job précédent (la page reste L'unique source de vérité).
      current?.cancel();

      let cancelled = false;
      let worker: Worker | null = null;
      let rejectFn: (err: Error) => void = () => undefined;

      const cancel = () => {
        if (cancelled) return;
        cancelled = true;
        worker?.terminate();
        rejectFn(new RadarCancelled());
        current = null;
      };

      const promise = new Promise<RadarAnalysisResult>((resolve, reject) => {
        rejectFn = reject;

        // Voie 1 — WORKER : l'analyse de 2 M de paires s'exécute en fond.
        if (!cancelled && typeof Worker !== "undefined") {
          try {
            worker = factory();
          } catch {
            worker = null; // amorçage impossible → voie 2
          }
        }
        if (worker) {
          const w = worker;
          const finish = () => {
            w.terminate();
            if (!cancelled) current = null;
          };
          w.onmessage = (e: MessageEvent<QcRadarResponse>) => {
            if (cancelled) return;
            const msg = e.data;
            if (msg.kind === "progress") {
              onProgress?.({ phase: msg.phase, fraction: msg.fraction });
            } else if (msg.kind === "result") {
              finish();
              resolve(msg.payload);
            } else {
              finish();
              // Erreur DANS le worker → secours synchrone (bouton jamais mort).
              try {
                resolve(runRadarAnalysis(elements, onProgress));
              } catch (err) {
                reject(err instanceof Error ? err : new Error(msg.message));
              }
            }
          };
          w.onerror = () => {
            if (cancelled) return;
            finish();
            try {
              resolve(runRadarAnalysis(elements, onProgress));
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          };
          w.postMessage({ jobId: 1, elements });
          return;
        }

        // Voie 2 — SECOURS SYNCHRONE (Worker indisponible) : même pipeline
        // (zéro dérive de chiffres), déclenchée en microtask respirante.
        queueMicrotask(() => {
          if (cancelled) return; // rejectFn déjà appelé par cancel()
          try {
            const result = runRadarAnalysis(elements, onProgress);
            if (!cancelled) {
              current = null;
              resolve(result);
            }
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      });

      const run: RadarRun = { promise, cancel };
      current = run;
      return run;
    },

    /// Nettoyage au démontage de la page (tue tout job en vol).
    dispose() {
      current?.cancel();
      current = null;
    },
  };
}
