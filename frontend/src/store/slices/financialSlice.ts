/**
 * FINANCIAL SLICE - NARCHI CORE
 * Handles DIN 276 cost estimations and HOAI honorarium calculations.
 * State is limited to configurations to allow memoized calculation in selectors.
 */

import type { StateCreator } from "zustand";
import type { State } from "../AppStore";

export interface CostConfig {
  typologyId: string;
  ngf: number;
  regionId: string;
  qualityId: string;
  year: number;
  includeVat: boolean;
  includeLand: boolean;
  landValue: number;
  untergeschosse: number;
  obergeschosse: number;
  bauweiseId: string;
  energiestandardId: string;
  din276?: "2018" | "2008"; // §71 — Fassung DIN 276-1 (défaut 2018)
  /** §239 — woher die NGF kommt. Nie still auf Messung setzen. */
  ngfQuelle?: "messung" | "eingabe";
}

export interface HoaiConfig {
  anrechenbareKosten: number;
  honorarzone: number;
  zusatzId: string;
  modeId: string;
}

export interface FinancialSlice {
  costConfig: CostConfig;
  hoaiConfig: HoaiConfig;
  hoaiByProjekt: Record<string, HoaiConfig>;
  costByProjekt: Record<string, CostConfig>;

  // Actions
  setCostConfig: (patch: Partial<CostConfig>) => void;
  setHoaiConfig: (patch: Partial<HoaiConfig>) => void;
  resetFinancials: () => void;
}

/** §236 — HOAI-Zahlen je Projekt, nicht global. */
export function hoaiFuerProjekt(
  map: Record<string, HoaiConfig>,
  projektId: string,
  fallbackGlobal?: HoaiConfig,
): HoaiConfig {
  const id = projektId.trim();
  if (!id) return { ...DEFAULT_HOAI_CONFIG };
  if (map[id]) return { ...map[id] };
  if (fallbackGlobal && Object.keys(map).length === 0 && fallbackGlobal.anrechenbareKosten > 0) {
    return { ...fallbackGlobal };
  }
  return { ...DEFAULT_HOAI_CONFIG };
}

export const DEFAULT_COST_CONFIG: CostConfig = {
  typologyId: "mfh",
  // §226 — keine erfundene 4.200 m² in München. 0 = leer, bis NGF
  // getippt oder aus dem Projekt übernommen wird.
  ngf: 0,
  regionId: "de-han",
  qualityId: "standard",
  year: 2026,
  includeVat: true,
  includeLand: false,
  landValue: 0,
  untergeschosse: 0,
  obergeschosse: 2,
  bauweiseId: "massiv",
  energiestandardId: "geg",
};

/** §237 — DIN-276-NGF je Projekt. */
export function costFuerProjekt(
  map: Record<string, CostConfig>,
  projektId: string,
  fallbackGlobal?: CostConfig,
): CostConfig {
  const id = projektId.trim();
  if (!id) return { ...DEFAULT_COST_CONFIG };
  if (map[id]) return { ...map[id] };
  if (fallbackGlobal && Object.keys(map).length === 0 && fallbackGlobal.ngf > 0) {
    return { ...fallbackGlobal };
  }
  return { ...DEFAULT_COST_CONFIG };
}

export const DEFAULT_HOAI_CONFIG: HoaiConfig = {
  // §225 — kein erfundenes 8,9-Mio-Honorar. 0 = leer, bis der Nutzer
  // tippt oder « aus DIN 276 » übernimmt.
  anrechenbareKosten: 0,
  honorarzone: 3,
  zusatzId: "none",
  modeId: "reference",
};

export const createFinancialSlice: StateCreator<State, [], [], FinancialSlice> = (set) => ({
  costConfig: DEFAULT_COST_CONFIG,
  hoaiConfig: DEFAULT_HOAI_CONFIG,
  hoaiByProjekt: {},
  costByProjekt: {},

  setCostConfig: (patch: Partial<CostConfig>) =>
    set((state) => {
      const costConfig = { ...state.costConfig, ...patch };
      const id = (state.activeProjectId || "").trim();
      const costByProjekt = id
        ? { ...state.costByProjekt, [id]: costConfig }
        : state.costByProjekt;
      return { costConfig, costByProjekt };
    }),

  setHoaiConfig: (patch: Partial<HoaiConfig>) => 
    set((state) => {
      const hoaiConfig = { ...state.hoaiConfig, ...patch };
      const id = (state.activeProjectId || "").trim();
      const hoaiByProjekt = id
        ? { ...state.hoaiByProjekt, [id]: hoaiConfig }
        : state.hoaiByProjekt;
      return { hoaiConfig, hoaiByProjekt };
    }),

  resetFinancials: () => set({ 
    costConfig: DEFAULT_COST_CONFIG, 
    hoaiConfig: DEFAULT_HOAI_CONFIG,
    hoaiByProjekt: {},
  }),
});
