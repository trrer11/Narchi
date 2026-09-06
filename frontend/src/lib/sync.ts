export interface SyncPhase {
  label: string;
  weight: number;
  detail: string;
}

// Ordered execution plan for the Narchi reconciliation engine.
export const SYNC_PHASES: SyncPhase[] = [
  { label: "Establishing secure channels", weight: 8, detail: "Negotiating transport with data sources" },
  { label: "Reading model & schedule streams", weight: 16, detail: "Streaming element geometry and tabular records" },
  { label: "Parsing geometric quantities", weight: 18, detail: "Deriving lengths, areas and volumes" },
  { label: "Classifying against NMC", weight: 16, detail: "Mapping elements to the Narchi classification" },
  { label: "Computing cost & embodied carbon", weight: 18, detail: "Applying material rates and emission factors" },
  { label: "Resolving element conflicts", weight: 14, detail: "Deduplicating and reconciling property drift" },
  { label: "Indexing & writing ledger", weight: 10, detail: "Persisting the immutable element ledger" },
];

export const SYNC_TOTAL_WEIGHT = SYNC_PHASES.reduce((s, p) => s + p.weight, 0);

export function phaseRange(index: number): { start: number; end: number } {
  let start = 0;
  for (let i = 0; i < index; i++) start += SYNC_PHASES[i].weight;
  const end = start + SYNC_PHASES[index].weight;
  return { start: Math.round((start / SYNC_TOTAL_WEIGHT) * 100), end: Math.round((end / SYNC_TOTAL_WEIGHT) * 100) };
}
