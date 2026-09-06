// Tests de la suppression de projet : cascade sur les éléments indexés et
// réattribution du projet actif.

import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./AppStore";
import type { BuildingElement, Project } from "@/data/types";

function makeProject(id: string, name = `Projet ${id}`): Project {
  return {
    id,
    code: `PRJ-${id}`,
    name,
    type: "Residential",
    location: "Hannover, DE",
    client: "Test",
    status: "planning",
    progress: 0,
    budget: 1_000_000,
    spent: 0,
    grossFloorArea: 500,
    floors: 3,
    startDate: "2026-08-05",
    endDate: "2027-12-31",
    team: ["AM"],
    classificationCode: "DIN-276",
    carbonBudgetKg: 300_000,
    health: 100,
    riskScore: 5,
    accent: "#3b82f6",
  };
}

function makeElement(id: string, projectId: string): BuildingElement {
  return {
    id,
    guid: `guid-${id}`,
    code: "300",
    classificationLabel: "Rohbau",
    name: `Mur ${id}`,
    type: "IfcWall",
    materialId: "mat-concrete",
    level: "EG",
    projectId,
    status: "modeled",
    qty: 10,
    unit: "m³",
    weightKg: 1000,
    cost: 5000,
    carbonKg: 800,
    properties: [],
    lastUpdated: "2026-08-05T10:00:00.000Z",
    conflicts: 0,
  };
}

describe("removeProject", () => {
  beforeEach(() => {
    useAppStore.setState({ projects: [], elements: [], activeProjectId: "" });
  });

  it("supprime le projet et ses éléments en cascade, réattribue le projet actif", () => {
    const store = useAppStore.getState();
    store.addProject(makeProject("p1"));
    useAppStore.getState().addProject(makeProject("p2"));
    useAppStore.setState({
      elements: [makeElement("e1", "p1"), makeElement("e2", "p1"), makeElement("e3", "p2")],
      activeProjectId: "p1",
    });

    useAppStore.getState().removeProject("p1");

    const state = useAppStore.getState();
    expect(state.projects.map((p) => p.id)).toEqual(["p2"]);
    // Les éléments de p1 partent avec lui ; ceux de p2 sont intacts.
    expect(state.elements.map((e) => e.id)).toEqual(["e3"]);
    // Le projet actif pointait sur p1 → réattribué au restant.
    expect(state.activeProjectId).toBe("p2");
  });

  it("conserve le projet actif quand un autre projet est supprimé", () => {
    useAppStore.getState().addProject(makeProject("p1"));
    useAppStore.getState().addProject(makeProject("p2"));
    useAppStore.setState({ activeProjectId: "p2", elements: [makeElement("e1", "p1")] });

    useAppStore.getState().removeProject("p1");

    const state = useAppStore.getState();
    expect(state.projects.map((p) => p.id)).toEqual(["p2"]);
    expect(state.activeProjectId).toBe("p2");
    expect(state.elements).toHaveLength(0);
  });

  it("id inconnu → aucun effet (état inchangé)", () => {
    useAppStore.getState().addProject(makeProject("p1"));
    useAppStore.setState({ elements: [makeElement("e1", "p1")], activeProjectId: "p1" });

    useAppStore.getState().removeProject("fantome");

    const state = useAppStore.getState();
    expect(state.projects).toHaveLength(1);
    expect(state.elements).toHaveLength(1);
    expect(state.activeProjectId).toBe("p1");
  });

  it("dernier projet supprimé → projet actif vidé", () => {
    useAppStore.getState().addProject(makeProject("p1"));
    useAppStore.getState().removeProject("p1");

    expect(useAppStore.getState().activeProjectId).toBe("");
    expect(useAppStore.getState().projects).toHaveLength(0);
  });
});

describe("updateProject (§167)", () => {
  beforeEach(() => {
    useAppStore.setState({ projects: [], elements: [], activeProjectId: "" });
  });

  it("modifie les champs ciblés sans toucher aux autres", () => {
    useAppStore.getState().addProject(makeProject("p1"));
    useAppStore.getState().updateProject("p1", { carbonBudgetKg: 120_000 });

    const p = useAppStore.getState().projects.find((x) => x.id === "p1")!;
    expect(p.carbonBudgetKg).toBe(120_000);
    // Les autres champs restent intacts.
    expect(p.name).toBe("Projet p1");
    expect(p.budget).toBe(1_000_000);
    // L'édition est horodatée (§118 — la synchro la verra).
    expect(p.updatedAt).toBeTruthy();
  });

  it("id inconnu → aucun effet", () => {
    useAppStore.getState().addProject(makeProject("p1"));
    useAppStore.getState().updateProject("fantome", { carbonBudgetKg: 1 });
    expect(useAppStore.getState().projects).toHaveLength(1);
    expect(useAppStore.getState().projects[0].carbonBudgetKg).toBe(300_000);
  });
});
