/**
 * LEGACY DERIVED SLICE - NARCHI CORE V5 (Correctif P0 A1-1 : page blanche)
 * -------------------------------------------------------------------------
 * CAUSE DE LA PAGE BLANCHE : les pages (Landing, Overview, CostEstimation,
 * Schedule, GegEnergie, HoaiHonorar, DashboardShell...) consomment via
 * useApp() ~30 cles heritees du store V3 (typologies, costResult, kpis,
 * energyResult, runSync...) absentes de TOUS les slices V4. Premier rendu
 * de Landing.tsx : typologies.map sur undefined -> TypeError -> crash de
 * l'arbre React -> ecran blanc.
 *
 * Ce module retablit le contrat Store <-> Pages :
 *  1. Etat + actions manquants (energyConfig, commandOpen, runSync...).
 *  2. Derivations PURES branchees sur les VRAIS moteurs (DIN 276, HOAI,
 *     GEG, KPIs agreges) - aucune donnee factice.
 *  3. Defauts SAINS et types : plus jamais d'undefined expose aux vues.
 */
import type {
  Project, BuildingElement, Material, ComplianceRule, DataSource,
  LevelInfo, Issue, IssueStatus, RiskItem, ScheduleTask, Milestone,
} from "@/data/types";
import { TYPOLOGIES, type Typology } from "@/data/typologies";
import {
  DE_REGIONS, QUALITY_STANDARDS, activeCountry,
  type CountryConfig, type RegionConfig, type QualityConfig,
} from "@/data/countries";
import { estimateCost, type CostResult, type CostInput } from "@/lib/costEngine";
import { matchMaterials } from "@/lib/materialMatch";
import { calcHoai, type HoaiResult } from "@/lib/hoaiEngine";
import { calcEnergy, type EnergyResult, type EnergyInput } from "@/lib/energyEngine";
import { SYNC_PHASES, phaseRange } from "@/lib/sync";
// §117 — le store MARQUE les Mängel écrits localement ; le moteur
// (lib/issueSync) ne connaît pas le store (injection) → pas de cycle.
import { markIssueDirty } from "@/lib/issueSync";
import type { CostConfig, HoaiConfig } from "./slices/financialSlice";

/* ========================================================================
 * TYPES DU CONTRAT LEGACY
 * ===================================================================== */

export interface Kpis {
  totalElements: number;
  portfolioValue: number;
  totalCarbonKg: number;
  validatedPct: number;
  complianceScore: number;
  openConflicts: number;
}

export interface LegacyDerivedSlice {
  /* --- Etat additionnel (absent des slices V4) --- */
  energyConfig: EnergyInput;
  energyByProjekt: Record<string, EnergyInput>;
  commandOpen: boolean;
  materials: Material[];
  compliance: ComplianceRule[];
  sources: DataSource[];
  risks: RiskItem[];
  issues: Issue[];
  levels: LevelInfo[];
  schedule: ScheduleTask[];
  milestones: Milestone[];

  /* --- Actions manquantes consommees par les pages --- */
  setEnergyConfig: (patch: Partial<EnergyInput>) => void;
  setCommandOpen: (open: boolean) => void;
  setIssueStatus: (id: string, status: IssueStatus) => void;
  /** §102 — saisie chantier (Baustelle) : un Mangel devient une Issue. */
  addIssue: (issue: Issue) => void;
  /** §117 — USAGES RÉSERVÉS AU MOTEUR DE SYNCHRO (jamais les pages) :
   *  appliquer/retirer des Mängel venus du SERVEUR sans les remettre en
   *  file de poussée (sinon boucle serveur→local→serveur). */
  upsertIssues: (issues: Issue[]) => void;
  removeIssues: (ids: string[]) => void;
  /** §118 — idem pour les PROJETS (miroir serveur) : appliquer/retirer
   *  SANS marquage — sinon chaque tirage re-pousserait en boucle. */
  upsertProjects: (projects: Project[]) => void;
  removeProjectsSilent: (ids: string[]) => void;
  setElementStatus: (id: string, status: string) => void;
  addElements: (els: BuildingElement[]) => void;
  retrySource: (id: string) => void;
  runSync: () => Promise<void>;
}

/* ========================================================================
 * DEFAUTS SAINS (jamais undefined)
 * ===================================================================== */

export const DEFAULT_ENERGY_CONFIG: EnergyInput = {
  // §227 — keine erfundene 615 m² in München. 0 = leer, bis TFA
  // getippt oder aus Projekt / IFC übernommen wird.
  tfa: 0,
  geschosse: 2,
  fensteranteil: 0.28,
  climateId: "cl-han",
  bauteilWandId: "aw-ks-eps",
  bauteilDachId: "d-steil",
  bauteilFensterId: "f-2isg",
  bauteilBodenId: "b-platte",
  gValue: 0.55,
  fShading: 0.9,
  orientationId: "so-sw",
  nAir: 0.6,
  massId: "mittel",
  heizsystemId: "h-lw",
  dhwDemand: 12.5,
  thetaI: 20,
};

/** §237 — GEG-TFA je Projekt. */
export function energyFuerProjekt(
  map: Record<string, EnergyInput>,
  projektId: string,
  fallbackGlobal?: EnergyInput,
): EnergyInput {
  const id = projektId.trim();
  if (!id) return { ...DEFAULT_ENERGY_CONFIG };
  if (map[id]) return { ...map[id] };
  if (fallbackGlobal && Object.keys(map).length === 0 && fallbackGlobal.tfa > 0) {
    return { ...fallbackGlobal };
  }
  return { ...DEFAULT_ENERGY_CONFIG };
}

const EMPTY_KPIS: Kpis = {
  totalElements: 0,
  portfolioValue: 0,
  totalCarbonKg: 0,
  validatedPct: 0,
  complianceScore: 0,
  openConflicts: 0,
};

const FALLBACK_PROJECT: Project = {
  id: "", code: "", name: "Kein Projekt", type: "-", location: "-",
  client: "-", status: "design", progress: 0, budget: 0, spent: 0,
  grossFloorArea: 0, floors: 0, startDate: "", endDate: "", team: [],
  classificationCode: "DIN-276", carbonBudgetKg: 0, health: 0,
  riskScore: 0, accent: "#3b82f6",
};

/* ========================================================================
 * DERIVATIONS PURES (branchees sur les VRAIS moteurs de calcul)
 * ===================================================================== */

/** DIN 276 : derive le CostResult complet depuis la config du slice V4. */
export function deriveCostResult(costConfig: CostConfig): CostResult {
  const typology: Typology =
    TYPOLOGIES.find((t) => t.id === costConfig.typologyId) ?? TYPOLOGIES[0];
  const region: RegionConfig =
    DE_REGIONS.find((r) => r.id === costConfig.regionId) ?? DE_REGIONS[0];
  const quality: QualityConfig =
    QUALITY_STANDARDS.find((q) => q.id === costConfig.qualityId) ?? QUALITY_STANDARDS[1];
  const country: CountryConfig = activeCountry();

  const input: CostInput = {
    typology,
    // §226 — 0 bleibt 0 (kein stilles 1 m²). Der Motor hält das aus.
    ngf: Math.max(0, costConfig.ngf),
    region,
    quality,
    country,
    year: costConfig.year,
    includeVat: costConfig.includeVat,
    includeLand: costConfig.includeLand,
    landValue: costConfig.landValue,
    untergeschosse: costConfig.untergeschosse,
    obergeschosse: costConfig.obergeschosse,
    bauweiseId: costConfig.bauweiseId,
    energiestandardId: costConfig.energiestandardId,
    din276: costConfig.din276,
  };
  return estimateCost(input);
}

/** HOAI : honoraires depuis la config du slice V4. */
export function deriveHoaiResult(hoaiConfig: HoaiConfig): HoaiResult {
  return calcHoai({
    anrechenbareKosten: Math.max(0, hoaiConfig.anrechenbareKosten),
    honorarzone: hoaiConfig.honorarzone,
    zusatzId: hoaiConfig.zusatzId,
    modeId: hoaiConfig.modeId,
  });
}

/** GEG : bilan energetique depuis l'etat energyConfig. */
export function deriveEnergyResult(energyConfig: EnergyInput): EnergyResult {
  return calcEnergy(energyConfig);
}

/** KPIs agreges depuis les VRAIES donnees (projets + elements importes). */
export function deriveKpis(
  projects: Project[],
  elements: BuildingElement[],
  compliance: ComplianceRule[],
  issues: Issue[],
): Kpis {
  if (projects.length === 0 && elements.length === 0) return EMPTY_KPIS;
  const totalElements = elements.length;
  const portfolioValue = projects.reduce((s, p) => s + (p.budget || 0), 0);
  // §174 — CO₂ COHÉRENT : le KPI « CO₂ (inkarniert) » doit être le MÊME A1–A3
  // (Ökobaudat) que le cockpit §161 et la liste §162 — un seul chiffre, une
  // seule source. L'ancienne somme brute de `element.carbonKg` (takeoff) était
  // UN AUTRE chiffre (facteurs RATES) et affichait deux CO₂ différents sur le
  // même écran. matchMaterials(elements) est le moteur de vérité.
  const totalCarbonKg = matchMaterials(elements).co2Kg;
  const validated = elements.filter(
    (e) => e.status === "validated" || e.status === "approved" || e.status === "issued",
  ).length;
  const passing = compliance.filter((c) => c.status === "pass").length;
  return {
    totalElements,
    portfolioValue,
    totalCarbonKg,
    validatedPct: totalElements ? (validated / totalElements) * 100 : 0,
    complianceScore: compliance.length
      ? Math.round((passing / compliance.length) * 100)
      : 0,
    openConflicts: issues.filter((i) => i.status !== "resolved").length,
  };
}

/* ========================================================================
 * CREATEUR DE SLICE (etat + actions)
 * ===================================================================== */

type SetFn = (
  partial:
    | Partial<Record<string, unknown>>
    | ((state: Record<string, unknown>) => Partial<Record<string, unknown>>),
) => void;
type GetFn = () => Record<string, unknown>;

let syncLogId = 0;

export function createLegacyDerivedSlice(set: SetFn, get: GetFn): LegacyDerivedSlice {
  return {
    energyConfig: DEFAULT_ENERGY_CONFIG,
    energyByProjekt: {},
    commandOpen: false,
    materials: [],
    compliance: [],
    sources: [],
    risks: [],
    issues: [],
    levels: [],
    schedule: [],
    milestones: [],

    setEnergyConfig: (patch) =>
      set((state) => {
        const energyConfig = { ...(state.energyConfig as EnergyInput), ...patch };
        const id = String(state.activeProjectId ?? "").trim();
        const prev = (state.energyByProjekt as Record<string, EnergyInput>) ?? {};
        const energyByProjekt = id ? { ...prev, [id]: energyConfig } : prev;
        return { energyConfig, energyByProjekt };
      }),

    setCommandOpen: (open) => set({ commandOpen: open }),

    setIssueStatus: (id, status) => {
      // §117 — l'écriture locale est DATÉE (LWW) et MISE EN FILE de
      // poussée : ce que cet appareil change doit rejoindre les autres.
      const horodatage = new Date().toISOString();
      set((state) => ({
        issues: (state.issues as Issue[]).map((i) =>
          i.id === id ? { ...i, status, updatedAt: horodatage } : i,
        ),
      }));
      markIssueDirty(id);
    },

    addIssue: (issue) => {
      if (!issue.updatedAt) issue = { ...issue, updatedAt: new Date().toISOString() };
      set((state) => ({ issues: [...(state.issues as Issue[]), issue] }));
      markIssueDirty(issue.id);
    },

    upsertIssues: (entrants) =>
      set((state) => {
        const courants = new Map((state.issues as Issue[]).map((i) => [i.id, i]));
        for (const i of entrants) courants.set(i.id, i);
        return { issues: [...courants.values()] };
      }),
    removeIssues: (ids) =>
      set((state) => {
        const partants = new Set(ids);
        return { issues: (state.issues as Issue[]).filter((i) => !partants.has(i.id)) };
      }),

    upsertProjects: (entrants) =>
      set((state) => {
        const courants = new Map((state.projects as Project[]).map((p) => [p.id, p]));
        for (const p of entrants) courants.set(p.id, p);
        return { projects: [...courants.values()] };
      }),
    removeProjectsSilent: (ids) =>
      set((state) => {
        const partants = new Set(ids);
        return {
          projects: (state.projects as Project[]).filter((p) => !partants.has(p.id)),
          // activeProjectId pointant un retiré : la facade replie proprement
          // (comportement §111 existant, aucune pseudo-sélection nouvelle).
          activeProjectId: partants.has(state.activeProjectId as string)
            ? ""
            : (state.activeProjectId as string),
        };
      }),

    setElementStatus: (id, status) =>
      set((state) => ({
        elements: (state.elements as BuildingElement[]).map((e) =>
          e.id === id ? { ...e, status } : e,
        ),
      })),

    addElements: (els) =>
      set((state) => ({
        elements: [...(state.elements as BuildingElement[]), ...els],
      })),

    retrySource: (id) =>
      set((state) => ({
        sources: (state.sources as DataSource[]).map((s) =>
          s.id === id ? { ...s, status: "syncing" as const } : s,
        ),
      })),

    /** Reconciliation reelle pilotee par les phases de lib/sync.ts. */
    runSync: async () => {
      const getSync = () =>
        (get().sync as { running: boolean }) ?? { running: false };
      if (getSync().running) return;

      const setSyncState = get().setSyncState as (p: object) => void;
      const elements = (get().elements as BuildingElement[]) ?? [];

      setSyncState({ running: true, progress: 0, log: [], conflicts: 0, resolved: 0 });
      for (let i = 0; i < SYNC_PHASES.length; i++) {
        const phase = SYNC_PHASES[i];
        const { end } = phaseRange(i);
        setSyncState({
          phase: phase.label,
          progress: end,
          records: elements.length,
        });
        set((state) => {
          const sync = state.sync as { log: unknown[] };
          return {
            sync: {
              ...(state.sync as object),
              log: [
                ...sync.log,
                {
                  id: ++syncLogId,
                  ts: new Date().toISOString(),
                  phase: phase.label,
                  level: "info" as const,
                  message: phase.detail,
                },
              ],
            },
          };
        });
        await new Promise((r) => setTimeout(r, 220));
      }
      setSyncState({
        running: false,
        progress: 100,
        phase: "Termine",
        lastRun: new Date().toISOString(),
      });
    },
  };
}

export { FALLBACK_PROJECT, EMPTY_KPIS };
