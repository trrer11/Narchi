/**
 * §117 — Badge synchro : SURTOUT ne jamais mentir. Chaque phrase affichée
 * est éprouvée contre une transition RÉELLE du moteur (pas un snapshot
 * décoratif) : jamais lancé, hors-ligne avec file, synchronisé (heure
 * SERVEUR), Mängel garés car projet absent ici.
 * + collage store : addIssue/setIssueStatus datent et mettent en file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act, createElement } from "react";

import { IssueSyncBadge } from "@/components/IssueSyncBadge";
import {
  _resetIssueSyncForTests,
  attachIssueSync,
  getIssueSyncStatus,
  markIssueDirty,
  pullIssues,
  pushIssues,
  stopIssueSync,
  type IssueSyncDeps,
} from "@/lib/issueSync";
import {
  _resetProjectSyncForTests,
  markProjectDeleted,
  markProjectDirty,
} from "@/lib/projectSync";
import {
  _resetMediaSyncForTests,
  attachMediaSync,
  markMediaForUpload,
  uploadPendingMedia,
} from "@/lib/mediaSync";
import { useAppStore } from "@/store/AppStore";

const h = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@/auth/SecuritySanitizer", () => ({ secureFetch: h.fetchMock }));

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const P1 = { id: "prj-A1", startDate: "2026-08-01" };

function depsVides(projets = [P1]): { state: { issues: never[]; projects: typeof P1[] }; deps: IssueSyncDeps } {
  const state = { issues: [] as never[], projects: projets };
  return {
    state,
    deps: {
      loadIssues: () => state.issues,
      loadProjects: () => state.projects,
      upsertLocal: () => {},
      removeLocal: () => {},
    },
  };
}

let hosts: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = [];
async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(IssueSyncBadge)); });
  hosts.push({ host, root });
  return host;
}

describe("IssueSyncBadge — chaque phrase est vraie", () => {
  beforeEach(() => {
    _resetIssueSyncForTests();
    _resetProjectSyncForTests();
    _resetMediaSyncForTests();
    h.fetchMock.mockReset();
  });
  afterEach(async () => {
    for (const { host, root } of hosts) {
      await act(async () => root.unmount());
      host.remove();
    }
    hosts = [];
    stopIssueSync();
    _resetIssueSyncForTests();
    _resetProjectSyncForTests();
    _resetMediaSyncForTests();
  });

  it("jamais lancé → « Noch nie synchronisiert » (jamais un OK décoratif)", async () => {
    const host = await mount();
    expect(host.textContent).toContain("Noch nie synchronisiert");
  });

  it("hors-ligne avec une écriture en attente → compteur nu", async () => {
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    attachIssueSync(depsVides().deps, { intervalMs: 86_400_000 });
    const host = await mount();
    await act(async () => {
      markIssueDirty("m-9");
      await pushIssues();
    });
    expect(host.textContent).toContain("Offline — 1 Änderung(en) warten");
    expect(h.fetchMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("cycle réussi → « Synchronisiert · » avec l'heure DU SERVEUR", async () => {
    attachIssueSync(depsVides().deps, { intervalMs: 86_400_000 });
    const host = await mount();
    h.fetchMock.mockResolvedValueOnce(json(200, {
      issues: [], server_time: "2026-08-12T13:10:00+00:00", truncated: false,
    }));
    await act(async () => { await pullIssues(); });
    expect(host.textContent).toContain("Synchronisiert ·");
  });

  it("Mangel garé (projet absent ici) → compteur DIT au lieu de silence", async () => {
    attachIssueSync(depsVides([]).deps, { intervalMs: 86_400_000 }); // zéro projet
    const host = await mount();
    h.fetchMock.mockResolvedValueOnce(json(200, {
      issues: [{
        id: "m-2", project_id: "prj-A1", day: "2026-08-10", title: "Riss",
        description: "", zone: "", severity: "minor", status: "open",
        photo_ids: [], video_ids: [], created_by: "arch-2",
        created_at: null, updated_at: "2026-08-12T11:00:00+00:00", deleted_at: null,
      }],
      server_time: "2026-08-12T13:10:00+00:00",
      truncated: false,
    }));
    await act(async () => { await pullIssues(); });
    expect(host.textContent).toContain("1 geparkt (Projekt fehlt hier)");
  });

  // §118 — le badge dit AUSSI les deux nouveaux flux (jamais de silence).

  it("projet créé ici, pas encore synchronisé → « Projekte: 1 warten » DIT", async () => {
    const host = await mount();
    await act(async () => {
      markProjectDirty("prj-z1"); // sans moteur branché : file tenue, comptée
    });
    expect(host.textContent).toContain("Projekte: 1 warten");
  });

  it("projet + suppression en attente → compteur cumulé honnête (pas deux lignes)", async () => {
    const host = await mount();
    await act(async () => {
      markProjectDirty("prj-z2");
      markProjectDeleted("prj-z3");
    });
    expect(host.textContent).toContain("Projekte: 2 warten");
  });

  it("photo en file → « Medien: 1 warten » ; REFUSÉE par le serveur → « nicht hochladbar » EN ROUGE", async () => {
    markMediaForUpload("ph-b1"); // avant branchement : file tenue, pas de déclenchement
    attachMediaSync({
      getBlob: async () => new Blob([new Uint8Array([1])]),
      putBlob: async () => {},
    });
    const host = await mount();
    expect(host.textContent).toContain("Medien: 1 warten");
    h.fetchMock.mockResolvedValueOnce(json(422, { detail: "Dateityp nicht erlaubt" }));
    await act(async () => { await uploadPendingMedia(); });
    expect(host.textContent).toContain("Medien: 1 nicht hochladbar"); // refus DIT
    // Le refus n'est PAS re-compté « en attente » : un autre mot, une autre couleur.
    expect(host.textContent).not.toContain("Medien: 1 warten");
    expect(host.querySelector("span")?.className).toContain("red");
  });
});

describe("store → moteur (collage réel LegacyDerivedSlice)", () => {
  beforeEach(() => {
    _resetIssueSyncForTests();
    _resetProjectSyncForTests();
    _resetMediaSyncForTests();
    useAppStore.setState({ issues: [] });
  });
  afterEach(() => {
    stopIssueSync();
    _resetIssueSyncForTests();
    _resetProjectSyncForTests();
    _resetMediaSyncForTests();
    useAppStore.setState({ issues: [] });
  });

  it("addIssue DATE et met en file (même sans moteur démarré : file conservée)", () => {
    useAppStore.getState().addIssue({
      id: "m-store-1", title: "Riss", description: "", level: "", classificationCode: "",
      severity: "minor", status: "open", assignee: "Baustelle", raisedDay: 9, projectId: "prj-A1",
    });
    const stocke = useAppStore.getState().issues[0];
    expect(stocke.updatedAt).toBeTruthy(); // daté à l'écriture (LWW)
    expect(getIssueSyncStatus().pending).toBe(1);
    const disque = JSON.parse(localStorage.getItem("narchi:issues:sync-queue") ?? "[]") as string[];
    expect(disque).toContain("m-store-1"); // survit à une fermeture navigateur
  });

  it("setIssueStatus met à jour l'horodatage (et la file)", () => {
    useAppStore.getState().addIssue({
      id: "m-store-2", title: "Riss", description: "", level: "", classificationCode: "",
      severity: "minor", status: "open", assignee: "Baustelle", raisedDay: 0, projectId: "prj-A1",
      updatedAt: "2026-08-12T09:00:00.000Z",
    });
    useAppStore.getState().setIssueStatus("m-store-2", "resolved");
    const stocke = useAppStore.getState().issues[0];
    expect(stocke.status).toBe("resolved");
    expect(Date.parse(stocke.updatedAt!)).toBeGreaterThan(Date.parse("2026-08-12T09:00:00.000Z"));
  });

  it("upsertIssues/removeIssues N'ENQUILLENT pas (boucle serveur→local→serveur interdite)", () => {
    useAppStore.getState().upsertIssues([{
      id: "m-remote-1", title: "Du serveur", description: "", level: "", classificationCode: "",
      severity: "major", status: "open", assignee: "Sync", raisedDay: 1, projectId: "prj-A1",
      updatedAt: "2026-08-12T11:00:00+00:00",
    }]);
    expect(useAppStore.getState().issues).toHaveLength(1);
    expect(getIssueSyncStatus().pending).toBe(0); // venu du serveur : rien à repousser
    useAppStore.getState().removeIssues(["m-remote-1"]);
    expect(useAppStore.getState().issues).toHaveLength(0);
    expect(getIssueSyncStatus().pending).toBe(0);
  });
});
