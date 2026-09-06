/**
 * §118 — Moteur de synchro PROJETS : éprouvé pour de vrai (fetch moqué,
 * deps INJECTÉES en mémoire — le moteur ne connaît pas le store).
 *
 * Épinglé :
 *  - correspondances des DEUX sens (fiche d'affichage complète dans la
 *    charge ; repli « planning » JAMAIS de statut hors union — attrapé à
 *    la relecture des types, le cast masquait l'erreur à tsc) ;
 *  - legacy sans updatedAt → la date de 1re synchro fait foi (dit) ;
 *  - file PERSISTANTE (localStorage), rien ne part hors-ligne, vidée
 *    seulement sur applied ; décliné → rattrapage GET par id (même raison
 *    que §117 : le delta peut manquer la version gagnante) ;
 *  - tombstone → retrait local ; écrit locale plus récente → remise en
 *    file (résurrection, leçon §117) ;
 *  - suppressions = file de DELETE DISTINCTE ; DELETE 404 = but atteint ;
 *    re-création après suppression = sortie de la file de DELETE ;
 *  - LWW en MILLISECONDES (jamais lexicale : « .000Z » vs « +00:00 ») ;
 *  - page tronquée → curseur arrêté au dernier reçu ;
 *  - collage store RÉEL (useAppStore) : addProject date + enfile ;
 *    removeProject enfile le DELETE ; actions silencieuses n'enquillent
 *    JAMAIS (boucle serveur→local→serveur interdite).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetProjectSyncForTests,
  attachProjectSync,
  getProjectSyncStatus,
  markProjectDeleted,
  markProjectDirty,
  projectToSyncItem,
  pullProjects,
  pushProjects,
  remoteToProject,
  subscribeProjectSync,
  syncProjectsOnce,
  type ProjectRemote,
  type ProjectSyncDeps,
} from "@/lib/projectSync";
import type { Project } from "@/data/types";
import { useAppStore } from "@/store/AppStore";

const h = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@/auth/SecuritySanitizer", () => ({ secureFetch: h.fetchMock }));

const NOW = "2026-08-12T10:00:00.000Z";

function projetLocal(over: Partial<Project> = {}): Project {
  return {
    id: "prj-1",
    code: "NW-26",
    name: "Neubau Wohnhaus",
    type: "Wohnbau",
    location: "Hannover",
    client: "Familie Yilmaz",
    status: "construction",
    progress: 35,
    budget: 850000,
    spent: 120000,
    grossFloorArea: 420,
    floors: 3,
    startDate: "2026-03-01",
    endDate: "2027-06-30",
    team: ["arch-1"],
    classificationCode: "",
    carbonBudgetKg: 12000,
    health: 90,
    riskScore: 2,
    accent: "#0ea5e9",
    updatedAt: NOW,
    ...over,
  };
}

function remote(over: Partial<ProjectRemote> = {}): ProjectRemote {
  return {
    id: "prj-2",
    name: "Umbau Büro",
    payload: {
      code: "UB-11",
      type: "Büro",
      location: "Burgdorf",
      client: "Stadt Burgdorf",
      status: "design",
      progress: 10,
      budget: 300000,
      spent: 0,
      grossFloorArea: 250,
      floors: 2,
      startDate: "2026-09-01",
      endDate: "2027-01-31",
      team: ["arch-2", "arch-3"],
      classificationCode: "",
      carbonBudgetKg: 0,
      health: 100,
      riskScore: 1,
      accent: "",
    },
    created_by: "arch-2",
    created_at: "2026-08-11T08:00:00+00:00",
    updated_at: "2026-08-12T11:00:00+00:00",
    deleted_at: null,
    ...over,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Harnais { state: { projects: Project[] }; deps: ProjectSyncDeps }
function harnais(seed: Project[] = []): Harnais {
  const state = { projects: seed };
  return {
    state,
    deps: {
      loadProjects: () => state.projects,
      upsertProjects: (entrants) => {
        const parId = new Map(state.projects.map((p) => [p.id, p]));
        for (const p of entrants) parId.set(p.id, p);
        state.projects = [...parId.values()];
      },
      removeProjects: (ids) => {
        const s = new Set(ids);
        state.projects = state.projects.filter((p) => !s.has(p.id));
      },
    },
  };
}

/** attach avec debounce immense : JAMAIS de minuteur en test (déterminisme). */
function engine(hh: Harnais): void {
  attachProjectSync(hh.deps, { debounceMs: 86_400_000 });
}

describe("correspondances pures", () => {
  it("local → item : la fiche complète voyage dans la charge, updatedAt = updated_at", () => {
    const item = projectToSyncItem(projetLocal(), NOW);
    expect(item.id).toBe("prj-1");
    expect(item.name).toBe("Neubau Wohnhaus");
    expect(item.updated_at).toBe(NOW);
    expect(item.payload).toMatchObject({
      code: "NW-26",
      location: "Hannover",
      budget: 850000,
      status: "construction",
      team: ["arch-1"],
    });
    const withAddr = projectToSyncItem(
      projetLocal({ clientStreet: "Markt 3", clientZip: "30159", clientCity: "Hannover", clientLeitweg: "0204:x" }),
      NOW,
    );
    expect(withAddr.payload.clientStreet).toBe("Markt 3");
    expect(withAddr.payload.clientLeitweg).toBe("0204:x");
    // id/name ne sont JAMAIS dans la charge : colonnes dédiées côté serveur.
    expect(item.payload).not.toHaveProperty("id");
    expect(item.payload).not.toHaveProperty("name");
  });

  it("local → item : legacy sans updatedAt → la date de 1re synchro fait foi (dit)", () => {
    const item = projectToSyncItem(projetLocal({ updatedAt: undefined }), NOW);
    expect(item.updated_at).toBe(NOW); // jamais de passé inventé
  });

  it("serveur → local : charge éparse = replis DITS, jamais hors union", () => {
    const p = remoteToProject(remote({ payload: {} }));
    expect(p.id).toBe("prj-2");
    expect(p.name).toBe("Umbau Büro");
    expect(p.status).toBe("planning"); // même repli que projectStatusMeta
    expect(p.progress).toBe(0);
    expect(p.budget).toBe(0);
    expect(p.team).toEqual([]);
    expect(p.updatedAt).toBe("2026-08-12T11:00:00+00:00");
  });

  it("serveur → local : team non-tableau ne casse rien (repli [])", () => {
    const p = remoteToProject(remote({ payload: { team: "arch-2" } }));
    expect(p.team).toEqual([]);
  });
});

describe("moteur : file, poussée, tirage", () => {
  beforeEach(() => {
    _resetProjectSyncForTests();
    h.fetchMock.mockReset();
  });
  afterEach(() => { _resetProjectSyncForTests(); });

  it("poussée : appliqués = file vidée, phase sync, charge conforme", async () => {
    const hh = harnais([projetLocal()]);
    engine(hh);
    h.fetchMock.mockResolvedValueOnce(
      json(200, { results: [{ id: "prj-1", applied: true, server_updated_at: NOW }] }),
    );
    markProjectDirty("prj-1");
    const n = await pushProjects(NOW);
    expect(n).toBe(1);
    expect(getProjectSyncStatus().pending).toBe(0);
    expect(getProjectSyncStatus().phase).toBe("sync");
    const [url, init] = h.fetchMock.mock.calls[0];
    expect(url).toBe("/api/v5/project-sync/batch");
    const corps = JSON.parse(String((init as RequestInit).body)) as {
      items: Array<{ id: string; name: string; updated_at: string; payload: Record<string, unknown> }>;
    };
    expect(corps.items[0]).toMatchObject({
      id: "prj-1", name: "Neubau Wohnhaus", updated_at: NOW,
    });
    expect(corps.items[0].payload.budget).toBe(850000);
  });

  it("poussée déclinée → rattrapage GET par id et version SERVEUR appliquée", async () => {
    const hh = harnais([projetLocal({ name: "ma version locale" })]);
    engine(hh);
    h.fetchMock
      .mockResolvedValueOnce(json(200, {
        results: [{ id: "prj-1", applied: false, server_updated_at: "2026-08-12T12:00:00+00:00" }],
      }))
      .mockResolvedValueOnce(json(200, remote({
        id: "prj-1",
        name: "version gagnante",
        payload: { ...remote().payload, name: undefined },
        updated_at: "2026-08-12T12:00:00+00:00",
      })));
    markProjectDirty("prj-1");
    await pushProjects(NOW);
    expect(h.fetchMock.mock.calls[1][0]).toBe("/api/v5/project-sync/prj-1");
    expect(hh.state.projects[0].name).toBe("version gagnante");
    expect(getProjectSyncStatus().pending).toBe(0); // décliné = résolu, pas coincé
  });

  it("hors-ligne : RIEN ne part, les deux files attendent, la phase le dit", async () => {
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const hh = harnais([projetLocal()]);
    engine(hh);
    markProjectDirty("prj-1");
    markProjectDeleted("prj-9");
    const n = await pushProjects(NOW);
    expect(n).toBe(0);
    expect(h.fetchMock).not.toHaveBeenCalled();
    const s = getProjectSyncStatus();
    expect(s.phase).toBe("offline");
    expect(s.pending).toBe(1);
    expect(s.pendingDeletes).toBe(1);
    spy.mockRestore();
  });

  it("erreur serveur à la poussée : file conservée, message nu", async () => {
    const hh = harnais([projetLocal()]);
    engine(hh);
    h.fetchMock.mockResolvedValueOnce(json(500, { detail: "boom" }));
    markProjectDirty("prj-1");
    await pushProjects(NOW);
    const s = getProjectSyncStatus();
    expect(s.phase).toBe("erreur");
    expect(s.lastError).toBe("HTTP 500");
    expect(s.pending).toBe(1); // rien n'est perdu, réessaiera
  });

  it("suppression : DELETE dédié ; 404 = déjà parti = but atteint", async () => {
    const hh = harnais();
    engine(hh);
    markProjectDeleted("prj-7");
    h.fetchMock.mockResolvedValueOnce(json(404, { detail: "inconnu" }));
    const n = await pushProjects(NOW);
    expect(n).toBe(1); // 404 compte comme atteint (idempotent)
    expect(h.fetchMock.mock.calls[0][0]).toBe("/api/v5/project-sync/prj-7");
    expect((h.fetchMock.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
    expect(getProjectSyncStatus().pendingDeletes).toBe(0); // pas coincé en file
  });

  it("supprimé puis RE-CRÉÉ : sorti de la file de DELETE, reparti en upsert", async () => {
    const hh = harnais([projetLocal({ id: "prj-8", name: "Résurrection locale" })]);
    engine(hh);
    markProjectDeleted("prj-8");
    expect(getProjectSyncStatus().pendingDeletes).toBe(1);
    markProjectDirty("prj-8"); // l'utilisateur le re-crée localement
    const s = getProjectSyncStatus();
    expect(s.pendingDeletes).toBe(0); // plus question de le tuer au serveur
    expect(s.pending).toBe(1);
    h.fetchMock.mockResolvedValueOnce(
      json(200, { results: [{ id: "prj-8", applied: true, server_updated_at: NOW }] }),
    );
    const n = await pushProjects(NOW);
    expect(n).toBe(1);
    expect(h.fetchMock).toHaveBeenCalledTimes(1); // JAMAIS de DELETE envoyé
    expect(String(h.fetchMock.mock.calls[0][0])).toContain("/batch");
  });

  it("tirage : curseur serveur mémorisé, nouveau appliqué, tombstone retire", async () => {
    const hh = harnais([projetLocal({ id: "prj-vieux", updatedAt: "2026-08-11T10:00:00.000Z" })]);
    engine(hh);
    h.fetchMock.mockResolvedValueOnce(json(200, {
      projects: [
        remote({ id: "prj-neuf" }),
        remote({
          id: "prj-vieux",
          deleted_at: "2026-08-12T09:00:00+00:00",
          updated_at: "2026-08-12T09:00:00+00:00",
        }),
      ],
      server_time: "2026-08-12T13:00:00+00:00",
      truncated: false,
    }));
    await pullProjects();
    const ids = hh.state.projects.map((p) => p.id);
    expect(ids).toContain("prj-neuf");
    expect(ids).not.toContain("prj-vieux"); // suppression apprise ici
    // Second tirage : le curseur envoyé = server_time du premier.
    h.fetchMock.mockResolvedValueOnce(json(200, { projects: [], server_time: "2026-08-12T13:10:00+00:00", truncated: false }));
    await pullProjects();
    const url2 = new URL(String(h.fetchMock.mock.calls[1][0]), "http://t");
    expect(url2.searchParams.get("since")).toBe("2026-08-12T13:00:00+00:00");
    expect(getProjectSyncStatus().lastSyncAt).toBe("2026-08-12T13:10:00+00:00");
  });

  it("delta TRONQUÉ → curseur arrêté au dernier reçu (aucun trou masqué)", async () => {
    const hh = harnais();
    engine(hh);
    h.fetchMock.mockResolvedValueOnce(json(200, {
      projects: [remote({ id: "x1", updated_at: "2026-08-12T08:00:00+00:00" })],
      server_time: "2026-08-12T13:00:00+00:00",
      truncated: true,
    }));
    await pullProjects();
    h.fetchMock.mockResolvedValueOnce(json(200, { projects: [], server_time: "2026-08-12T13:05:00+00:00", truncated: false }));
    await pullProjects();
    const url = new URL(String(h.fetchMock.mock.calls[1][0]), "http://t");
    expect(url.searchParams.get("since")).toBe("2026-08-12T08:00:00+00:00"); // PAS server_time
  });

  it("LWW keyhole : local PLUS RÉCENT ou ÉGAL (« .000Z » vs « +00:00 ») = local gardé", async () => {
    // Même instant, deux suffixes : une comparaison lexicale trierait
    // « +00:00 » APRÈS « .000Z ». On compare en ms : ÉGALITÉ = local gardé
    // (anti flip-flop, même règle que §117).
    const hh = harnais([projetLocal({ name: "locale", updatedAt: "2026-08-12T12:00:00.000Z" })]);
    engine(hh);
    h.fetchMock.mockResolvedValueOnce(json(200, {
      projects: [remote({ id: "prj-1", name: "serveur", updated_at: "2026-08-12T12:00:00+00:00" })],
      server_time: "2026-08-12T13:00:00+00:00",
      truncated: false,
    }));
    await pullProjects();
    expect(hh.state.projects[0].name).toBe("locale");
  });

  it("tombstone vs écrit locale PLUS RÉCENTE : gardé ici et RE-POUSSÉ (résurrection)", async () => {
    const hh = harnais([projetLocal({ updatedAt: "2026-08-12T10:30:00.000Z" })]);
    engine(hh);
    h.fetchMock.mockResolvedValueOnce(json(200, {
      projects: [remote({
        id: "prj-1",
        deleted_at: "2026-08-12T09:00:00+00:00",
        updated_at: "2026-08-12T09:00:00+00:00",
      })],
      server_time: "2026-08-12T13:00:00+00:00",
      truncated: false,
    }));
    await pullProjects();
    expect(hh.state.projects).toHaveLength(1); // pas effacé ici
    expect(getProjectSyncStatus().pending).toBe(1); // remis en file → revivra serveur
  });

  it("tirage hors-ligne : rien ne part, la phase le dit, curseur intact", async () => {
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const hh = harnais();
    engine(hh);
    const n = await pullProjects();
    expect(n).toBe(0);
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(getProjectSyncStatus().phase).toBe("offline");
    expect(localStorage.getItem("narchi:projects:sync-cursor")).toBeNull();
    spy.mockRestore();
  });

  it("file persistante : la file REPART du disque au branchement (redémarrage navigateur)", async () => {
    localStorage.setItem("narchi:projects:sync-queue", JSON.stringify(["prj-1"]));
    localStorage.setItem("narchi:projects:deleted-queue", JSON.stringify(["prj-mort"]));
    const hh = harnais([projetLocal()]);
    engine(hh);
    expect(getProjectSyncStatus().pending).toBe(1);
    expect(getProjectSyncStatus().pendingDeletes).toBe(1);
    h.fetchMock
      .mockResolvedValueOnce(json(200, { detail: "ok" })) // DELETE prj-mort
      .mockResolvedValueOnce(json(200, { results: [{ id: "prj-1", applied: true, server_updated_at: NOW }] }));
    const n = await pushProjects(NOW);
    expect(n).toBe(2);
    expect(getProjectSyncStatus().pending).toBe(0);
    expect(getProjectSyncStatus().pendingDeletes).toBe(0);
    expect((h.fetchMock.mock.calls[0][1] as RequestInit).method).toBe("DELETE"); // tombes d'abord
  });

  it("cycle complet : on POUSSE avant de TIRER (ordre lisible dans les appels)", async () => {
    const hh = harnais([projetLocal()]);
    engine(hh);
    const ordre: string[] = [];
    h.fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      ordre.push(init?.method === "POST" ? "push" : `pull:${u.includes("since") ? "avec" : "sans"}`);
      if (init?.method === "POST") {
        return json(200, { results: [{ id: "prj-1", applied: true, server_updated_at: NOW }] });
      }
      return json(200, { projects: [], server_time: "2026-08-12T13:00:00+00:00", truncated: false });
    });
    markProjectDirty("prj-1");
    await syncProjectsOnce();
    expect(ordre).toEqual(["push", "pull:sans"]);
  });

  it("subscribe notifie chaque transition (badge toujours à jour)", async () => {
    const hh = harnais([projetLocal()]);
    engine(hh);
    let notifications = 0;
    let dernierePhase = "";
    const off = subscribeProjectSync((s) => { notifications += 1; dernierePhase = s.phase; });
    h.fetchMock.mockResolvedValueOnce(
      json(200, { results: [{ id: "prj-1", applied: true, server_updated_at: NOW }] }),
    );
    markProjectDirty("prj-1"); // notifie (file = 1)
    await pushProjects(NOW);   // notifie (sync)
    expect(notifications).toBeGreaterThanOrEqual(3); // branchement + file + sync
    expect(dernierePhase).toBe("sync");
    off();
  });
});

describe("store → moteur (collage réel slices)", () => {
  beforeEach(() => {
    _resetProjectSyncForTests();
    useAppStore.setState({ projects: [], activeProjectId: "" });
  });
  afterEach(() => {
    _resetProjectSyncForTests();
    useAppStore.setState({ projects: [], activeProjectId: "" });
  });

  it("addProject DATE et met en file (même sans moteur démarré : file conservée)", () => {
    useAppStore.getState().addProject(projetLocal({ id: "prj-store-1", updatedAt: undefined }));
    const stocke = useAppStore.getState().projects[0];
    expect(stocke.updatedAt).toBeTruthy(); // daté à l'écriture (LWW)
    expect(useAppStore.getState().activeProjectId).toBe("prj-store-1"); // §111 conservé
    expect(getProjectSyncStatus().pending).toBe(1);
    const disque = JSON.parse(localStorage.getItem("narchi:projects:sync-queue") ?? "[]") as string[];
    expect(disque).toContain("prj-store-1"); // survit à une fermeture navigateur
  });

  it("addProject respecte un updatedAt DÉJÀ posé (jamais réécrit)", () => {
    useAppStore.getState().addProject(projetLocal({ id: "prj-store-1b", updatedAt: "2026-08-01T08:00:00.000Z" }));
    expect(useAppStore.getState().projects[0].updatedAt).toBe("2026-08-01T08:00:00.000Z");
  });

  it("removeProject enfile le DELETE (la suppression voyage aussi)", () => {
    useAppStore.getState().addProject(projetLocal({ id: "prj-store-2" }));
    useAppStore.getState().removeProject("prj-store-2");
    expect(useAppStore.getState().projects).toHaveLength(0);
    expect(useAppStore.getState().activeProjectId).toBe(""); // façade repliée (existant)
    const s = getProjectSyncStatus();
    expect(s.pending).toBe(0); // plus rien à pousser d'un disparu
    expect(s.pendingDeletes).toBe(1); // mais la TOMBE doit être posée serveur
    const disque = JSON.parse(localStorage.getItem("narchi:projects:deleted-queue") ?? "[]") as string[];
    expect(disque).toContain("prj-store-2");
  });

  it("upsertProjects/removeProjectsSilent N'ENQUILLENT pas (boucle interdite)", () => {
    useAppStore.getState().upsertProjects([projetLocal({ id: "prj-remote-1", name: "Du serveur" })]);
    expect(useAppStore.getState().projects).toHaveLength(1);
    expect(getProjectSyncStatus().pending).toBe(0); // venu du serveur : rien à repousser
    useAppStore.setState({ activeProjectId: "prj-remote-1" });
    useAppStore.getState().removeProjectsSilent(["prj-remote-1"]);
    expect(useAppStore.getState().projects).toHaveLength(0);
    expect(useAppStore.getState().activeProjectId).toBe(""); // pointeur replié proprement
    expect(getProjectSyncStatus().pendingDeletes).toBe(0); // JAMAIS de DELETE renvoyé
  });
});
