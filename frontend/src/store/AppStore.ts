/**
 * APP STORE - NARCHI CORE V2
 * Centralized state orchestration with High-Performance URL Synchronization.
 * 
 * Architecture:
 * - Single Source of Truth (SSOT): The Browser URL.
 * - Sync Strategy: Optimized Deep Comparison to prevent render loops.
 * - Flow: Action -> URL Update -> Store Sync -> UI Render.
 */

import { create } from "zustand";
import { createJSONStorage, devtools, persist, subscribeWithSelector } from "zustand/middleware";
import { useMemo } from "react";

import { createUserSlice, type UserSlice } from "./slices/userSlice";
import { createProjectSlice, type ProjectSlice } from "./slices/projectSlice";
import { createFinancialSlice, type FinancialSlice } from "./slices/financialSlice";
import { createSystemSlice, type SystemSlice } from "./slices/systemSlice";
import {
  createLegacyDerivedSlice,
  deriveCostResult,
  deriveHoaiResult,
  deriveEnergyResult,
  deriveKpis,
  FALLBACK_PROJECT,
  type LegacyDerivedSlice,
  type Kpis,
} from "./LegacyDerivedSlice";
import { TYPOLOGIES, type Typology } from "@/data/typologies";
import {
  DE_REGIONS, QUALITY_STANDARDS, activeCountry,
  type CountryConfig, type RegionConfig, type QualityConfig,
} from "@/data/countries";
import type { CostResult } from "@/lib/costEngine";
import type { HoaiResult } from "@/lib/hoaiEngine";
import { indexedDbStateStorage } from "./indexedDbStorage";
import type { EnergyResult } from "@/lib/energyEngine";
import type { Project, BuildingElement, Issue, LevelInfo, Material } from "@/data/types";

// ============================================================================
// ROUTING TYPES
// ============================================================================

export interface RouteState {
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
}

export type State = UserSlice & ProjectSlice & FinancialSlice & SystemSlice & LegacyDerivedSlice & {
  route: RouteState;
  navigate: (path: string, query?: Record<string, string>) => void;
};

// ============================================================================
// PERFORMANCE UTILITIES
// ============================================================================

/**
 * Optimized Deep Equality Check for RouteState.
 * Prevents unnecessary re-renders by comparing values instead of serialized strings.
 */
function isRouteEqual(a: RouteState, b: RouteState): boolean {
  // 1. Reference check (Short-circuit)
  if (a === b) return true;

  // 2. Primitive check
  if (a.path !== b.path) return false;

  // 3. Compare Params (unordered)
  const aParamsKeys = Object.keys(a.params);
  const bParamsKeys = Object.keys(b.params);
  if (aParamsKeys.length !== bParamsKeys.length) return false;
  for (const key of aParamsKeys) {
    if (a.params[key] !== b.params[key]) return false;
  }

  // 4. Compare Query (unordered)
  const aQueryKeys = Object.keys(a.query);
  const bQueryKeys = Object.keys(b.query);
  if (aQueryKeys.length !== bQueryKeys.length) return false;
  for (const key of aQueryKeys) {
    if (a.query[key] !== b.query[key]) return false;
  }

  return true;
}

// ============================================================================
// URL UTILITIES
// ============================================================================

const URL_UTILS = {
  parseUrl: (): RouteState => {
    const hash = window.location.hash.replace(/^#/, "") || "/";
    const [pathPart, queryPart] = hash.split("?");
    
    const params: Record<string, string> = {};
    const projectMatch = pathPart.match(/\/app\/project\/([^\/]+)/);
    if (projectMatch) {
      params.projectId = projectMatch[1];
    }

    const query: Record<string, string> = {};
    if (queryPart) {
      const searchParams = new URLSearchParams(queryPart);
      searchParams.forEach((value, key) => {
        query[key] = value;
      });
    }

    return { path: pathPart, params, query };
  },

  stringifyUrl: (path: string, query: Record<string, string> = {}): string => {
    const queryStr = new URLSearchParams(query).toString();
    return `#${path}${queryStr ? `?${queryStr}` : ""}`;
  },
};

// ============================================================================
// EVENT BUS (Pub/Sub léger pour la communication inter-modules 3D <-> pages)
// ============================================================================

type EventHandler = (payload: unknown) => void;

class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  publish(event: string, payload: unknown): void {
    this.handlers.get(event)?.forEach((handler) => {
      try { handler(payload); } catch (err) { console.error(`[EventBus] handler "${event}" failed:`, err); }
    });
  }

  subscribe(event: string, handler: EventHandler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => { this.handlers.get(event)?.delete(handler); };
  }
}

export const eventBus = new EventBus();

// ============================================================================
// STORE ASSEMBLY
// ============================================================================

export const useAppStore = create<State>()(
  devtools(
    persist(
      subscribeWithSelector((set, get, api) => ({
      ...createUserSlice(set, get, api),
      ...createProjectSlice(set, get, api),
      ...createFinancialSlice(set, get, api),
      ...createSystemSlice(set, get, api),
      // Correctif P0 A1-1 : état + actions hérités V3 (energyConfig,
      // commandOpen, runSync, setIssueStatus…) — voir LegacyDerivedSlice.ts
      ...createLegacyDerivedSlice(set as never, get as never),

      route: URL_UTILS.parseUrl(),

      navigate: (path, query = {}) => {
        const newUrl = URL_UTILS.stringifyUrl(path, query);
        if (window.location.hash !== newUrl) {
          window.location.hash = newUrl;
        }
      },
    })),
    {
      name: "narchi:app-state:v5",
      version: 1,
      storage: createJSONStorage(() => indexedDbStateStorage),
      partialize: (state) => {
        const persistedTakeoff = state.takeoff
          ? {
              ...state.takeoff,
              // File et blob: URL ne survivent pas à un rechargement.
              sourceFile: undefined,
              ifcObjectUrl: undefined,
            }
          : null;
        return {
          projects: state.projects,
          activeProjectId: state.activeProjectId,
          elements: state.elements,
          takeoff: persistedTakeoff,
          settings: state.settings,
          costConfig: state.costConfig,
          hoaiConfig: state.hoaiConfig,
          hoaiByProjekt: state.hoaiByProjekt,
          costByProjekt: state.costByProjekt,
          energyByProjekt: state.energyByProjekt,
          energyConfig: state.energyConfig,
          compliance: state.compliance,
          issues: state.issues,
          materials: state.materials,
          levels: state.levels,
        } as State;
      },
    },
  ),
  { name: "NARCHI V5 Store" },
  )
);

// ============================================================================
// ROUTE SYNCHRONIZER (High Performance Bridge)
// ============================================================================

export class RouteSynchronizer {
  private static active = false;
  private static readonly handleLocationChange = () => this.syncUrlToStore();

  /** Initialise une seule paire de listeners et retourne son cleanup React. */
  public static init(): () => void {
    if (!this.active) {
      this.active = true;
      this.syncUrlToStore();
      window.addEventListener("popstate", this.handleLocationChange);
      window.addEventListener("hashchange", this.handleLocationChange);
    }

    return () => {
      if (!this.active) return;
      window.removeEventListener("popstate", this.handleLocationChange);
      window.removeEventListener("hashchange", this.handleLocationChange);
      this.active = false;
    };
  }

  /**
   * Synchronizes URL to Store with strict equality checks.
   * Eliminates render loops and redundant updates.
   */
  private static syncUrlToStore() {
    const newRoute = URL_UTILS.parseUrl();
    const currentRoute = useAppStore.getState().route;

    // Optimization: Use specialized deepEqual instead of JSON.stringify
    if (isRouteEqual(newRoute, currentRoute)) {
      return;
    }

    useAppStore.setState((state) => {
      const nextState = { ...state, route: newRoute };

      // Sync project context from URL params
      if (newRoute.params.projectId) {
        const projectExists = state.projects.some(p => p.id === newRoute.params.projectId);
        
        if (projectExists) {
          nextState.activeProjectId = newRoute.params.projectId;
        } else {
          // Hydration Guard: Redirect to safety if project is invalid
          console.error(`[RouteSync] Invalid Project ID: ${newRoute.params.projectId}`);
          window.location.hash = "#/app/dashboard/overview";
          return state; 
        }
      }

      return nextState;
    });
  }
}

// ============================================================================
// COMPATIBILITY FACADE
// ============================================================================

/**
 * Contrat COMPLET renvoyé par useApp() : état V4 + clés dérivées V3.
 * Le typage strict remplace l'ancien `any` qui masquait la rupture de
 * contrat Store ↔ Pages (cause de la page blanche au lancement).
 */
export interface AppFacade extends State {
  /* --- Dérivations calculées (jamais undefined) --- */
  costResult: CostResult;
  hoaiResult: HoaiResult;
  energyResult: EnergyResult;
  kpis: Kpis;
  /* --- Référentiels statiques --- */
  typologies: Typology[];
  regions: RegionConfig[];
  qualities: QualityConfig[];
  country: CountryConfig;
  /* --- Vues dérivées du projet actif --- */
  activeProject: Project;
  activeElements: BuildingElement[];
  activeIssues: Issue[];
  activeLevels: LevelInfo[];
  /* --- Helpers hérités --- */
  getMaterial: (id: string) => Material | undefined;
  estimateForProject: (projectId: string) => CostResult | null;
  unreadCount: number;
}

/**
 * Hook de compatibilité historique (API du store V3), désormais TYPÉ.
 * Recompose les clés dérivées à chaque rendu à partir de l'état réel :
 * les moteurs DIN 276 / HOAI / GEG sont déterministes et mémoïsés sur
 * leurs configurations — aucune donnée factice, aucun undefined.
 */
import { useShallow } from "zustand/react/shallow";

export function useApp(): AppFacade {
  const state = useAppStore(useShallow((s) => s));

  const costResult = useMemo(
    () => deriveCostResult(state.costConfig),
    [state.costConfig],
  );
  const hoaiResult = useMemo(
    () => deriveHoaiResult(state.hoaiConfig),
    [state.hoaiConfig],
  );
  const energyResult = useMemo(
    () => deriveEnergyResult(state.energyConfig),
    [state.energyConfig],
  );

  const activeProject = useMemo<Project>(
    () => state.projects.find((p: Project) => p.id === state.activeProjectId)
      ?? state.projects[0]
      ?? FALLBACK_PROJECT,
    [state.projects, state.activeProjectId],
  );
  const activeElements = useMemo<BuildingElement[]>(
    () => activeProject.id
      ? state.elements.filter((e: BuildingElement) => e.projectId === activeProject.id)
      : state.elements,
    [state.elements, activeProject.id],
  );
  const activeIssues = useMemo<Issue[]>(
    () => activeProject.id
      ? state.issues.filter((i: Issue) => i.projectId === activeProject.id)
      : state.issues,
    [state.issues, activeProject.id],
  );

  const kpis = useMemo<Kpis>(
    () => deriveKpis(state.projects, state.elements, state.compliance, state.issues),
    [state.projects, state.elements, state.compliance, state.issues],
  );

  const getMaterial = useMemo(
    () => (id: string) => state.materials.find((m: Material) => m.id === id),
    [state.materials],
  );
  const estimateForProject = useMemo(
    () => (projectId: string) => {
      if (!state.projects.some((p: Project) => p.id === projectId)) return null;
      const cfg = state.costByProjekt?.[projectId]
        ?? (projectId === state.activeProjectId ? state.costConfig : undefined);
      if (!cfg || cfg.ngf <= 0) return null;
      return deriveCostResult(cfg);
    },
    [state.projects, state.costByProjekt, state.costConfig, state.activeProjectId],
  );

  const unreadCount = useMemo(
    () => state.notifications.filter((n: { read: boolean }) => !n.read).length,
    [state.notifications],
  );

  return {
    ...state,
    costResult,
    hoaiResult,
    energyResult,
    kpis,
    typologies: TYPOLOGIES,
    regions: DE_REGIONS,
    qualities: QUALITY_STANDARDS,
    country: activeCountry(),
    activeProject,
    activeElements,
    activeIssues,
    activeLevels: state.levels,
    getMaterial,
    estimateForProject,
    unreadCount,
  };
}

export default useAppStore;
