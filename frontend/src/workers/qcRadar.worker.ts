// NARCHI §43 — Worker radar QC : l'« analyse de 2 M de paires nage libre |
// le thread principal reste FREEZE-0 (méthode bcfService/ifcParser du repo).
// NE contient AUCUNE logique métier — Seule import/run de la pipeline
// partagée qcRadarAnalysis (même chiffres que la voie de secours sincrone).

import { runRadarAnalysis } from "@/lib/qcRadarAnalysis";
import type { BuildingElement } from "@/data/types";

export interface QcRadarRequest {
  jobId: number;
  elements: BuildingElement[];
}

export type QcRadarResponse =
  | { jobId: number; kind: "progress"; phase: "prepare" | "pairs" | "groups"; fraction: number }
  | { jobId: number; kind: "result"; payload: ReturnType<typeof runRadarAnalysis> }
  | { jobId: number; kind: "error"; message: string };

self.onmessage = (e: MessageEvent<QcRadarRequest>) => {
  const { jobId, elements } = e.data;
  try {
    const payload = runRadarAnalysis(elements, (p) => {
      self.postMessage({ jobId, kind: "progress", phase: p.phase, fraction: p.fraction });
    });
    self.postMessage({ jobId, kind: "result", payload } satisfies QcRadarResponse);
  } catch (err) {
    self.postMessage({ jobId, kind: "error", message: err instanceof Error ? err.message : String(err) } satisfies QcRadarResponse);
  }
};
