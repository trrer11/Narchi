// NARCHI V6.12 — Pipeline radar UNIQUE (§43).
// MÊME code pour le thread principal ET le Web Worker (ça tue toute dérive
// de chiffres entre le mode fond et le mode secours) :
//   raw ClashDetector → whitelist Anschluss (§37) → Befundgruppen (§37)
// La page QC n'appelle plus jamais les moteurs Elle-même : Seuls ces
// résultats-clones (données pures, structured-cloneables) remontent.

import type { BuildingElement } from "@/data/types";
import { ClashDetector, type Clash } from "@/lib/planpruefung";
import {
  classOfElements,
  groupClashes,
  splitConnections,
  withGroupLevels,
  DEFAULT_CONNECTION_FILTER,
  type ClashGroup,
  type ConnectionVerdict,
} from "@/lib/clashGroups";

export interface RadarProgress {
  /** prepare = bbox/Express-ID · pairs = boucle O(n²) · groups = foyers. */
  phase: "prepare" | "pairs" | "groups";
  /** Fraction de la PHASE (≈ même progression globale vu le poids). */
  fraction: number;
}

export interface RadarConnection {
  clash: Clash;
  verdict: ConnectionVerdict;
}

export interface RadarAnalysisResult {
  /** Toutes les paires (après garde des jumeaux Express ID). */
  clashes: Clash[];
  /** Vraies collisions (whitelist retirée) — base du radar et du BCF. */
  realClashes: Clash[];
  /** Anschlüsse filtrés (documentés, comptés — jamais silencieux). */
  connections: RadarConnection[];
  connectionCount: number;
  /** Befundgruppen triées (sévérité → taille → alpha), ids BG-xx stables. */
  groups: ClashGroup[];
}

/**
 * Analyse complète, 100 % déterministe. `onProgress` optionnel : phase
 * « pairs » pendant la boucle, « groups » à la fusion (îlots courts).
 */
export function runRadarAnalysis(
  elements: BuildingElement[],
  onProgress?: (p: RadarProgress) => void,
): RadarAnalysisResult {
  onProgress?.({ phase: "prepare", fraction: 0 });
  const elementsById = new Map(elements.map((e) => [e.id, e]));
  const classOf = classOfElements((id) => elementsById.get(id));

  const clashes = ClashDetector.detectClashes(elements, (f) =>
    onProgress?.({ phase: "pairs", fraction: f }),
  );

  onProgress?.({ phase: "groups", fraction: 0 });
  const { real: realClashes, connections } = splitConnections(clashes, classOf, DEFAULT_CONNECTION_FILTER);
  const groups = withGroupLevels(groupClashes(realClashes, classOf), (id) => elementsById.get(id));
  onProgress?.({ phase: "groups", fraction: 1 });

  return { clashes, realClashes, connections, connectionCount: connections.length, groups };
}
