/**
 * §117 — Moteur de synchro Mängel : éprouvé pour de vrai (fetch moqué,
 * store INJECTÉ en mémoire — le moteur ne connaît pas le store).
 *
 * Épinglé :
 *  - correspondances des DEUX sens (visitDate→day ; jour recomposé depuis
 *    startDate+raisedDay ; projet inconnu = skip/parké, jamais inventé) ;
 *  - file persistante (localStorage), repoussée intacte hors-ligne,
 *    vidée seulement sur applied=true ;
 *  - verdict décliné → rattrapage GET par id (le delta seul pourrait
 *    manquer la version gagnante : curseur au-delà de SA date) ;
 *  - LWW aux deux bouts + comparaison en MILLISECONDES (jamais lexicale :
 *    « .000Z » vs « +00:00 » trient faux pour le même instant) ;
 *  - tombstone → retrait local, SAUF écrit locale plus récente
 *    (résurrection §117 : la ligne revit côté serveur à la poussée) ;
 *  - delta tronqué → curseur = dernier élément reçu, aucun trou masqué ;
 *  - « garés » comptés et DITS, puis appliqués quand le projet arrive.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetIssueSyncForTests,
  attachIssueSync,
  getIssueSyncStatus,
  issueToSyncItem,
  markIssueDirty,
  pullIssues,
  pushIssues,
  remoteToIssue,
  retryParkedIssues,
  startIssueSync,
  stopIssueSync,
  subscribeIssueSync,
  syncIssuesOnce,
  type IssueRemote,
  type IssueSyncDeps,
} from "@/lib/issueSync";
import {
  _resetProjectSyncForTests,
  attachProjectSync,
  pullProjects,
  type ProjectRemote,
} from "@/lib/projectSync";
import type { Issue, Project } from "@/data/types";

const h = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@/auth/SecuritySanitizer", () => ({ secureFetch: h.fetchMock }));

const P1 = { id: "prj-A1", startDate: "2026-08-01" };
const NOW = "2026-08-12T10:00:00.000Z";

function issueLocal(over: Partial<Issue> = {}): Issue {
  return {
    id: "m-1",
    title: "Riss",
    description: "",
    level: "Treppenhaus",
    classificationCode: "",
    severity: "major",
    status: "open",
    assignee: "Baustelle",
    raisedDay: 9,
    projectId: "prj-A1",
    photoIds: ["ph-1"],
    visitDate: "2026-08-10",
    updatedAt: NOW,
    ...over,
  };
}

function remote(over: Partial<IssueRemote> = {}): IssueRemote {
  return {
    id: "m-1",
    project_id: "prj-A1",
    day: "2026-08-10",
    title: "Riss (serveur)",
    description: "",
    zone: "Treppenhaus",
    severity: "major",
    status: "open",
    photo_ids: ["ph-9"],
    video_ids: [],
    created_by: "arch-2",
    created_at: "2026-08-10T08:00:00+00:00",
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

interface Harnais { state: { issues: Issue[]; projects: typeof P1[] }; deps: IssueSyncDeps }
function harnais(seed: Partial<Harnais["state"]> = {}): Harnais {
  const state = { issues: seed.issues ?? [], projects: seed.projects ?? [P1] };
  return {
    state,
    deps: {
      loadIssues: () => state.issues,
      loadProjects: () => state.projects,
      upsertLocal: (entrants) => {
        const parId = new Map(state.issues.map((i) => [i.id, i]));
        for (const i of entrants) parId.set(i.id, i);
        state.issues = [...parId.values()];
      },
      removeLocal: (ids) => {
        const s = new Set(ids);
        state.issues = state.issues.filter((i) => !s.has(i.id));
      },
    },
  };
}

describe("correspondances pures", () => {
  it("local → item : visitDate porte le jour ; ids photos voyagent ; horodatage requis", () => {
    const map = issueToSyncItem(issueLocal(), [P1], NOW);
    expect("item" in map ? map.item : null).toMatchObject({
      id: "m-1", project_id: "prj-A1", day: "2026-08-10",
      zone: "Treppenhaus", status: "open", photo_ids: ["ph-1"],
      video_ids: [], updated_at: NOW,
    });
  });

  it("local → item : sans visitDate, jour RECOMPOSÉ depuis startDate+raisedDay", () => {
    const map = issueToSyncItem(issueLocal({ visitDate: undefined, raisedDay: 9 }), [P1], NOW);
    expect("item" in map && map.item.day).toBe("2026-08-10"); // 01.08 + 9 j
  });

  it("local → item : projet inconnu = skip DIT (jamais de date inventée)", () => {
    const map = issueToSyncItem(issueLocal({ visitDate: undefined }), [], NOW);
    expect("skip" in map ? map.skip : "").toContain("introuvable");
  });

  it("serveur → local : raisedDay recomposé, provenance dite, projet inconnu = null", () => {
    const conv = remoteToIssue(remote(), [P1]);
    expect(conv).toMatchObject({
      id: "m-1", title: "Riss (serveur)", level: "Treppenhaus",
      projectId: "prj-A1", visitDate: "2026-08-10",
      updatedAt: "2026-08-12T11:00:00+00:00", raisedDay: 9,
      photoIds: ["ph-9"],
    });
    expect(conv?.assignee).toContain("Sync"); // on DIT d'où ça vient
    expect(remoteToIssue(remote({ project_id: "prj-inconnu" }), [P1])).toBeNull();
  });
});

describe("moteur : file, poussée, tirage", () => {
  beforeEach(() => {
    _resetIssueSyncForTests();
    h.fetchMock.mockReset();
  });
  afterEach(() => { stopIssueSync(); _resetIssueSyncForTests(); });

  it("poussée : seuls les modifiés partent, appliqués = file vidée, phase sync", async () => {
    const hh = harnais({ issues: [issueLocal()] });
    h.fetchMock.mockResolvedValueOnce(
      json(200, { results: [{ id: "m-1", applied: true, server_updated_at: NOW }] }),
    );
    engine(hh);
    markIssueDirty("m-1");
    const n = await pushIssues(NOW);
    expect(n).toBe(1);
    expect(getIssueSyncStatus().pending).toBe(0);
    expect(getIssueSyncStatus().phase).toBe("sync");
    const [url, init] = h.fetchMock.mock.calls[0];
    expect(url).toBe("/api/v5/issues/batch");
    expect(JSON.parse(String((init as RequestInit).body)).items[0].updated_at).toBe(NOW);
  });

  it("poussée déclinée → rattrapage GET par id et version SERVEUR appliquée", async () => {
    const locale = issueLocal({ title: "ma version", updatedAt: "2026-08-12T10:00:00.000Z" });
    const hh = harnais({ issues: [locale] });
    engine(hh);
    h.fetchMock
      .mockResolvedValueOnce(json(200, {
        results: [{ id: "m-1", applied: false, server_updated_at: "2026-08-12T12:00:00+00:00" }],
      }))
      .mockResolvedValueOnce(json(200, remote({ title: "version gagnante", updated_at: "2026-08-12T12:00:00+00:00" })));
    markIssueDirty("m-1");
    await pushIssues(NOW);
    expect(h.fetchMock.mock.calls[1][0]).toBe("/api/v5/issues/m-1");
    expect(hh.state.issues[0].title).toBe("version gagnante");
    expect(getIssueSyncStatus().pending).toBe(0); // décliné = résolu, pas coincé
  });

  it("hors-ligne : RIEN ne part, la file attend, la phase le dit", async () => {
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const hh = harnais({ issues: [issueLocal()] });
    engine(hh);
    markIssueDirty("m-1");
    const n = await pushIssues(NOW);
    expect(n).toBe(0);
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(getIssueSyncStatus().phase).toBe("offline");
    expect(getIssueSyncStatus().pending).toBe(1);
    spy.mockRestore();
  });

  it("erreur serveur à la poussée : file conservée, message nu", async () => {
    const hh = harnais({ issues: [issueLocal()] });
    engine(hh);
    h.fetchMock.mockResolvedValueOnce(json(500, { detail: "boom" }));
    markIssueDirty("m-1");
    await pushIssues(NOW);
    const s = getIssueSyncStatus();
    expect(s.phase).toBe("erreur");
    expect(s.lastError).toBe("HTTP 500");
    expect(s.pending).toBe(1); // rien n'est perdu, réessaiera
  });

  it("ligne sans projet et sans date : non envoyée, RESTE en file, comptée honnêtement", async () => {
    const hh = harnais({ issues: [issueLocal({ visitDate: undefined, projectId: "fantome" })] });
    engine(hh);
    markIssueDirty("m-1");
    await pushIssues(NOW);
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(getIssueSyncStatus().pending).toBe(1);
  });

  it("tirage : curseur serveur mémorisé, nouveau appliqué, tombstone retire", async () => {
    const hh = harnais({ issues: [issueLocal({ id: "m-vieux", updatedAt: "2026-08-11T10:00:00.000Z" })] });
    engine(hh);
    h.fetchMock.mockResolvedValueOnce(json(200, {
      issues: [remote({ id: "m-neuf" }), remote({ id: "m-vieux", deleted_at: "2026-08-12T09:00:00+00:00", updated_at: "2026-08-12T09:00:00+00:00" })],
      server_time: "2026-08-12T13:00:00+00:00",
      truncated: false,
    }));
    await pullIssues();
    const ids = hh.state.issues.map((i) => i.id);
    expect(ids).toContain("m-neuf");
    expect(ids).not.toContain("m-vieux"); // suppression apprise ici
    // Second tirage : le curseur envoyé = server_time du premier.
    h.fetchMock.mockResolvedValueOnce(json(200, { issues: [], server_time: "2026-08-12T13:10:00+00:00", truncated: false }));
    await pullIssues();
    const url2 = new URL(String(h.fetchMock.mock.calls[1][0]), "http://t");
    expect(url2.searchParams.get("since")).toBe("2026-08-12T13:00:00+00:00");
    expect(getIssueSyncStatus().lastSyncAt).toBe("2026-08-12T13:10:00+00:00");
  });

  it("delta TRONQUÉ → curseur arrêté au dernier reçu (aucun trou masqué)", async () => {
    const hh = harnais();
    engine(hh);
    h.fetchMock.mockResolvedValueOnce(json(200, {
      issues: [remote({ id: "x1", updated_at: "2026-08-12T08:00:00+00:00" })],
      server_time: "2026-08-12T13:00:00+00:00",
      truncated: true,
    }));
    await pullIssues();
    h.fetchMock.mockResolvedValueOnce(json(200, { issues: [], server_time: "2026-08-12T13:05:00+00:00", truncated: false }));
    await pullIssues();
    const url = new URL(String(h.fetchMock.mock.calls[1][0]), "http://t");
    expect(url.searchParams.get("since")).toBe("2026-08-12T08:00:00+00:00"); // PAS server_time
  });

  it("LWW keyhole : local PLUS RÉCENT (« .000Z ») bat serveur (« +00:00 ») du MÊME instant", async () => {
    // Même instant, deux écritures de suffixe — une comparaison lexicale
    // trierait « +00:00 » APRÈS « .000Z ». On compare en ms : ÉGALITÉ =
    // on garde le local, anti flip-flop.
    const hh = harnais({ issues: [issueLocal({ title: "locale", updatedAt: "2026-08-12T12:00:00.000Z" })] });
    engine(hh);
    h.fetchMock.mockResolvedValueOnce(json(200, {
      issues: [remote({ title: "serveur", updated_at: "2026-08-12T12:00:00+00:00" })],
      server_time: "2026-08-12T13:00:00+00:00",
      truncated: false,
    }));
    await pullIssues();
    expect(hh.state.issues[0].title).toBe("locale");
  });

  it("tombstone vs écrit locale PLUS RÉCENTE : on garde le local et on le RE-POUSSE (résurrection)", async () => {
    const locale = issueLocal({ updatedAt: "2026-08-12T10:30:00.000Z" });
    const hh = harnais({ issues: [locale] });
    engine(hh);
    h.fetchMock.mockResolvedValueOnce(json(200, {
      issues: [remote({ deleted_at: "2026-08-12T09:00:00+00:00", updated_at: "2026-08-12T09:00:00+00:00" })],
      server_time: "2026-08-12T13:00:00+00:00",
      truncated: false,
    }));
    await pullIssues();
    expect(hh.state.issues).toHaveLength(1); // pas effacé ici
    expect(getIssueSyncStatus().pending).toBe(1); // remis en file → revivra serveur
  });

  it("Mangel garé (projet absent ici) : compté, DIT, appliqué quand le projet arrive", async () => {
    const hh = harnais();
    engine(hh);
    hh.state.projects = []; // aucun projet sur CET appareil
    h.fetchMock.mockResolvedValueOnce(json(200, {
      issues: [remote({ project_id: "prj-A1" })],
      server_time: "2026-08-12T13:00:00+00:00",
      truncated: false,
    }));
    await pullIssues();
    expect(hh.state.issues).toHaveLength(0);
    expect(getIssueSyncStatus().parked).toBe(1); // dit, pas fondu ailleurs
    // Le projet arrive (créé ici) ; au delta suivant, le même Mangel
    // (renvoyé par une since plus ancienne... simulé) s'applique proprement.
    hh.state.projects = [P1];
    h.fetchMock.mockResolvedValueOnce(json(200, {
      issues: [remote({ project_id: "prj-A1" })],
      server_time: "2026-08-12T13:05:00+00:00",
      truncated: false,
    }));
    await pullIssues();
    expect(hh.state.issues).toHaveLength(1);
    expect(getIssueSyncStatus().parked).toBe(0);
  });

  it("file persistante : reconnexion après redémarrage = la file REPART du disque", async () => {
    localStorage.setItem("narchi:issues:sync-queue", JSON.stringify(["m-1"]));
    const hh = harnais({ issues: [issueLocal()] });
    h.fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return json(200, { results: [{ id: "m-1", applied: true, server_updated_at: NOW }] });
      }
      return json(200, { issues: [], server_time: "2026-08-12T13:00:00+00:00", truncated: false });
    });
    startIssueSync(engineDeps(hh), { intervalMs: 3_600_000, debounceMs: 3_600_000 });
    await vi.waitFor(() => {
      expect(getIssueSyncStatus().pending).toBe(0); // file du disque poussée seule
    });
    expect(getIssueSyncStatus().lastSyncAt).toBe("2026-08-12T13:00:00+00:00");
  });

  it("cycle complet : on POUSSE avant de TIRER (ordre lisible dans les appels)", async () => {
    const hh = harnais({ issues: [issueLocal()] });
    engine(hh);
    const ordre: string[] = [];
    h.fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      ordre.push(init?.method === "POST" ? "push" : `pull:${u.includes("since") ? "avec" : "sans"}`);
      if (init?.method === "POST") {
        return json(200, { results: [{ id: "m-1", applied: true, server_updated_at: NOW }] });
      }
      return json(200, { issues: [], server_time: "2026-08-12T13:00:00+00:00", truncated: false });
    });
    markIssueDirty("m-1");
    await syncIssuesOnce();
    expect(ordre).toEqual(["push", "pull:sans"]);
  });

  it("subscribe notifie chaque transition (badge toujours à jour)", async () => {
    const hh = harnais({ issues: [issueLocal()] });
    engine(hh);
    const phases: string[] = [];
    const off = subscribeIssueSync((s) => phases.push(s.phase));
    h.fetchMock.mockResolvedValueOnce(json(200, { results: [{ id: "m-1", applied: true, server_updated_at: NOW }] }));
    markIssueDirty("m-1"); // notifie (file = 1)
    await pushIssues(NOW);   // notifie (sync)
    expect(phases.length).toBeGreaterThanOrEqual(3);
    expect(phases[phases.length - 1]).toBe("sync");
    off();
  });

  it("stop : plus d'intervalle, double stop sans douleur", () => {
    const hh = harnais();
    engine(hh);
    stopIssueSync();
    stopIssueSync();
    markIssueDirty("m-1"); // moteur arrêté : file conservée, pas de requête
    expect(getIssueSyncStatus().pending).toBe(1);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
});

// Petits utilitaires locaux à la suite (deps injectées = moteur réel).

/** attach = moteur branché SANS cycle initial (déterminisme des tests) ;
 *  le cycle initial de startIssueSync est couvert par « file persistante ». */
function engine(hh: { deps: IssueSyncDeps }): void {
  attachIssueSync(hh.deps, { intervalMs: 86_400_000, debounceMs: 86_400_000 });
}

function engineDeps(hh: { deps: IssueSyncDeps }): IssueSyncDeps {
  return hh.deps;
}

// ============================================================================
// §121 — COURSE RÉELLE trouvée par la suite E2E navigateur : au premier
// démarrage d'un appareil, le tirage des Mängel peut battre celui des
// Projets de quelques millisecondes → Mangel « garé » alors que son projet
// arrive juste après. Avant §121, le garé n'était rejoué QUE si le serveur
// le renvoyait — ce que le delta strict (updated_at > since, curseur déjà
// passé) ne refait JAMAIS : le Mangel restait invisible à vie sur cet
// appareil (le test §117 « simulait » lui-même ce renvoi — aveu repris).
// Loi restaurée : curseur GELÉ tant qu'un enregistrement du tirage est garé
// + copie mémoire rejouée INSTANTANÉMENT quand le miroir Projets livre.
// ============================================================================
describe("§121 — garés : curseur honnête + guérison instantanée", () => {
  const ANCIENNE = "2026-08-12T12:00:00+00:00";

  beforeEach(() => {
    _resetIssueSyncForTests();
    _resetProjectSyncForTests();
    h.fetchMock.mockReset();
  });
  afterEach(() => {
    stopIssueSync();
    _resetIssueSyncForTests();
    _resetProjectSyncForTests();
  });

  function projetRemote(over: Partial<ProjectRemote> = {}): ProjectRemote {
    return {
      id: "prj-A1",
      name: "Zentrale E2E",
      payload: { code: "P-E2E", startDate: "2026-08-01", status: "planning" },
      updated_at: "2026-08-12T12:30:00+00:00",
      created_by: "arch-1",
      created_at: "2026-08-12T10:00:00+00:00",
      deleted_at: null,
      ...over,
    };
  }

  it("Mangel garé ⇒ curseur GELÉ : cycles suivants re-demandent la MÊME since, guérison dès le projet là", async () => {
    localStorage.setItem("narchi:issues:sync-cursor", ANCIENNE);
    const hh = harnais();
    engine(hh);
    hh.state.projects = []; // projet pas encore tiré sur CET appareil

    h.fetchMock.mockResolvedValueOnce(json(200, {
      issues: [remote({ project_id: "prj-A1" })],
      server_time: "2026-08-12T13:00:00+00:00",
      truncated: false,
    }));
    await pullIssues();
    expect(hh.state.issues).toHaveLength(0);
    expect(getIssueSyncStatus().parked).toBe(1); // dit, jamais fondu ailleurs
    // LOI : rien d'affirmé reçu qui ne l'est pas → curseur INCHANGÉ.
    expect(localStorage.getItem("narchi:issues:sync-cursor")).toBe(ANCIENNE);

    // Cycle suivant : même since → le serveur REDONNE le garé (delta strict) ;
    // projet toujours absent → re-garé → curseur TOUJOURS gelé (rejet honorable).
    h.fetchMock.mockResolvedValueOnce(json(200, {
      issues: [remote({ project_id: "prj-A1" })],
      server_time: "2026-08-12T13:06:00+00:00",
      truncated: false,
    }));
    await pullIssues();
    expect(String(h.fetchMock.mock.calls[1][0])).toContain(`since=${encodeURIComponent(ANCIENNE)}`);
    expect(localStorage.getItem("narchi:issues:sync-cursor")).toBe(ANCIENNE);
    expect(getIssueSyncStatus().parked).toBe(1);

    // Le projet est enfin là : le même renvoi s'applique, le curseur repart.
    hh.state.projects = [P1];
    h.fetchMock.mockResolvedValueOnce(json(200, {
      issues: [remote({ project_id: "prj-A1" })],
      server_time: "2026-08-12T13:09:00+00:00",
      truncated: false,
    }));
    await pullIssues();
    expect(hh.state.issues).toHaveLength(1);
    expect(getIssueSyncStatus().parked).toBe(0);
    expect(localStorage.getItem("narchi:issues:sync-cursor")).toBe("2026-08-12T13:09:00+00:00");
  });

  it("le PROJET tiré par le miroir §118 dé-gare INSTANTANÉMENT (copie mémoire, zéro appel issues)", async () => {
    // Harnais croisé : les DEUX moteurs branchés sur LE MÊME état (comme
    // dans le store réel), fetch partagé (même secureFetch moqué).
    const etat: { issues: Issue[]; projects: Project[] } = { issues: [], projects: [] };
    attachIssueSync(
      {
        loadIssues: () => etat.issues,
        loadProjects: () => etat.projects,
        upsertLocal: (entrants) => {
          const m = new Map(etat.issues.map((i) => [i.id, i]));
          for (const i of entrants) m.set(i.id, i);
          etat.issues = [...m.values()];
        },
        removeLocal: (ids) => {
          const s = new Set(ids);
          etat.issues = etat.issues.filter((i) => !s.has(i.id));
        },
      },
      { intervalMs: 86_400_000, debounceMs: 86_400_000 },
    );
    h.fetchMock.mockResolvedValueOnce(json(200, {
      issues: [remote({ project_id: "prj-A1" })],
      server_time: "2026-08-12T13:00:00+00:00",
      truncated: false,
    }));
    await pullIssues();
    expect(getIssueSyncStatus().parked).toBe(1);

    // Le miroir Projets tire enfin son delta : le garé doit s'appliquer
    // SANS aucun nouvel appel réseau issues.
    attachProjectSync(
      {
        loadProjects: () => etat.projects,
        upsertProjects: (entrants) => {
          const m = new Map(etat.projects.map((p) => [p.id, p]));
          for (const p of entrants) m.set(p.id, p);
          etat.projects = [...m.values()];
        },
        removeProjects: (ids) => {
          const s = new Set(ids);
          etat.projects = etat.projects.filter((p) => !s.has(p.id));
        },
      },
      { debounceMs: 86_400_000 },
    );
    h.fetchMock.mockReset();
    h.fetchMock.mockResolvedValueOnce(json(200, {
      projects: [projetRemote()],
      server_time: "2026-08-12T13:01:00+00:00",
      truncated: false,
    }));
    await pullProjects();
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(String(h.fetchMock.mock.calls[0][0])).toContain("/api/v5/project-sync");
    expect(etat.projects).toHaveLength(1);
    expect(etat.issues).toHaveLength(1); // garé → appliqué sur-le-champ
    expect(etat.issues[0].title).toBe("Riss (serveur)");
    expect(getIssueSyncStatus().parked).toBe(0);
  });

  it("retryParkedIssues seul (appel direct) : projet apparu localement → garé appliqué, sans réseau", async () => {
    const hh = harnais();
    engine(hh);
    hh.state.projects = [];
    h.fetchMock.mockResolvedValueOnce(json(200, {
      issues: [remote({ project_id: "prj-A1" })],
      server_time: "2026-08-12T13:00:00+00:00",
      truncated: false,
    }));
    await pullIssues();
    expect(getIssueSyncStatus().parked).toBe(1);
    h.fetchMock.mockReset();

    hh.state.projects = [P1]; // projet créé ICI entre-temps
    const n = retryParkedIssues();
    expect(n).toBe(1);
    expect(hh.state.issues).toHaveLength(1);
    expect(h.fetchMock).not.toHaveBeenCalled(); // copie mémoire, zéro réseau
    expect(getIssueSyncStatus().parked).toBe(0);
  });

  it("tombe d'un Mangel GARÉ : dé-garé proprement, le curseur repart (pas de boucle)", async () => {
    const hh = harnais();
    engine(hh);
    hh.state.projects = [];
    h.fetchMock.mockResolvedValueOnce(json(200, {
      issues: [remote({ project_id: "prj-A1" })],
      server_time: "2026-08-12T13:00:00+00:00",
      truncated: false,
    }));
    await pullIssues();
    expect(getIssueSyncStatus().parked).toBe(1);
    expect(localStorage.getItem("narchi:issues:sync-cursor")).toBeNull(); // gelé (1re synchro)

    // Le serveur supprime le Mangel entre-temps : la tombe prime.
    h.fetchMock.mockResolvedValueOnce(json(200, {
      issues: [remote({ project_id: "prj-A1", deleted_at: "2026-08-12T13:30:00+00:00", updated_at: "2026-08-12T13:30:00+00:00" })],
      server_time: "2026-08-12T13:31:00+00:00",
      truncated: false,
    }));
    await pullIssues();
    expect(getIssueSyncStatus().parked).toBe(0);
    expect(hh.state.issues).toHaveLength(0);
    // Rien de garé CE tirage → le curseur peut enfin avancer.
    expect(localStorage.getItem("narchi:issues:sync-cursor")).toBe("2026-08-12T13:31:00+00:00");
    // Et la copie mémoire est purgée : un appel direct ne ressuscite rien.
    expect(retryParkedIssues()).toBe(0);
    expect(hh.state.issues).toHaveLength(0);
  });
});
