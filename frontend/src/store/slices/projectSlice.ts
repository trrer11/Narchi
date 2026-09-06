/**
 * PROJECT SLICE - NARCHI CORE
 * Manages project lifecycle, IFC element indexing, and model takeoff data.
 * Optimized for high-frequency updates from the 3D engine.
 */
import { type Project, type BuildingElement, type ElementStatus } from "@/data/types";
import type { ModelTakeoff } from "@/lib/modelTakeoff";
import type { StateCreator } from "zustand";
import type { State } from "../AppStore";
// §118 — marquage de synchro (le moteur ne connaît pas le store : DI).
import { markProjectDirty, markProjectDeleted } from "@/lib/projectSync";
import { costFuerProjekt, hoaiFuerProjekt } from "./financialSlice";
import { energyFuerProjekt } from "../LegacyDerivedSlice";

export interface ProjectSlice {
  projects: Project[];
  activeProjectId: string;
  elements: BuildingElement[];
  takeoff: ModelTakeoff | null;
  
  // Actions
  setActiveProjectId: (id: string) => void;
  setProjects: (projects: Project[]) => void;
  setElements: (elements: BuildingElement[]) => void;
  setTakeoff: (takeoff: ModelTakeoff | null) => void;
  addProject: (project: Project) => void;
  /// §167 — modifie des champs d'un projet (ex. budget carbone) : DATÉ + mis
  /// en file de synchro (§118), comme addProject.
  updateProject: (id: string, patch: Partial<Project>) => void;
  /// Supprime un projet et tout ce qui lui est rattaché (éléments indexés) ;
  /// réattribue le projet actif s'il pointait sur le projet supprimé.
  removeProject: (id: string) => void;
  updateElementStatus: (id: string, status: ElementStatus) => void;
}

export const createProjectSlice: StateCreator<State, [], [], ProjectSlice> = (set) => ({
  projects: [],
  activeProjectId: "",
  elements: [],
  takeoff: null,

  setActiveProjectId: (id: string) => set((state) => {
    const hoaiConfig = hoaiFuerProjekt(state.hoaiByProjekt ?? {}, id, state.hoaiConfig);
    let hoaiByProjekt = state.hoaiByProjekt ?? {};
    if (id && !hoaiByProjekt[id] && hoaiConfig.anrechenbareKosten > 0 && Object.keys(hoaiByProjekt).length === 0) {
      hoaiByProjekt = { [id]: hoaiConfig };
    }
    const costConfig = costFuerProjekt(state.costByProjekt ?? {}, id, state.costConfig);
    let costByProjekt = state.costByProjekt ?? {};
    if (id && !costByProjekt[id] && costConfig.ngf > 0 && Object.keys(costByProjekt).length === 0) {
      costByProjekt = { [id]: costConfig };
    }
    const energyConfig = energyFuerProjekt(state.energyByProjekt ?? {}, id, state.energyConfig);
    let energyByProjekt = state.energyByProjekt ?? {};
    if (id && !energyByProjekt[id] && energyConfig.tfa > 0 && Object.keys(energyByProjekt).length === 0) {
      energyByProjekt = { [id]: energyConfig };
    }
    return {
      activeProjectId: id,
      hoaiConfig,
      hoaiByProjekt,
      costConfig,
      costByProjekt,
      energyConfig,
      energyByProjekt,
      takeoff: null,
    };
  }),
  setProjects: (projects: Project[]) => set({ projects }),
  setElements: (elements: BuildingElement[]) => set({ elements }),
  setTakeoff: (takeoff: ModelTakeoff | null) => set({ takeoff }),
  
  addProject: (project: Project) => {
    // §118 — la création est DATÉE et mise en file de synchro : un projet
    // saisi ici doit apparaître sur les autres appareils du bureau.
    if (!project.updatedAt) project = { ...project, updatedAt: new Date().toISOString() };
    set((state) => ({
      projects: [project, ...state.projects],
      activeProjectId: project.id,
      hoaiConfig: hoaiFuerProjekt(state.hoaiByProjekt ?? {}, project.id),
      costConfig: costFuerProjekt(state.costByProjekt ?? {}, project.id),
      energyConfig: energyFuerProjekt(state.energyByProjekt ?? {}, project.id),
    }));
    markProjectDirty(project.id);
  },

  updateProject: (id: string, patch: Partial<Project>) => {
    set((state) => ({
      projects: state.projects.map((p: Project) =>
        p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p,
      ),
    }));
    markProjectDirty(id);
  },

  removeProject: (id: string) => {
    set((state) => {
      const remaining = state.projects.filter((p) => p.id !== id);
      return {
        projects: remaining,
        // Cascade : les éléments IFC indexés sous ce projet partent avec lui.
        elements: state.elements.filter((el) => el.projectId !== id),
        activeProjectId:
          state.activeProjectId === id ? (remaining[0]?.id ?? "") : state.activeProjectId,
        hoaiConfig: hoaiFuerProjekt(
          state.hoaiByProjekt ?? {},
          state.activeProjectId === id ? (remaining[0]?.id ?? "") : state.activeProjectId,
        ),
        costConfig: costFuerProjekt(
          state.costByProjekt ?? {},
          state.activeProjectId === id ? (remaining[0]?.id ?? "") : state.activeProjectId,
        ),
        energyConfig: energyFuerProjekt(
          state.energyByProjekt ?? {},
          state.activeProjectId === id ? (remaining[0]?.id ?? "") : state.activeProjectId,
        ),
      };
    });
    // §118 — la suppression voyage elle aussi (pierre tombale serveur),
    // sinon l'autre appareil garderait le projet pour toujours.
    markProjectDeleted(id);
  },

  updateElementStatus: (id: string, status: ElementStatus) => 
    set((state) => ({
      elements: state.elements.map((el: BuildingElement) => 
        el.id === id ? { ...el, status, lastUpdated: new Date().toISOString() } : el
      )
    })),
});
