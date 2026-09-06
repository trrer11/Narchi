/**
 * §118 — étape 3, médias photo/vidéo : éprouvé pour de vrai (fetch moqué,
 * getBlob/putBlob INJECTÉS — le moteur ne connaît ni le store ni IDB).
 *
 * Épinglé :
 *  - saveMangelPhoto = écriture locale + MISE EN FILE persistée (hors-ligne,
 *    ça repart tout seul — la file survit à la fermeture du navigateur) ;
 *  - versement réussi = sorti de file ; REFUS DÉFINITIF 4xx = sorti de file
 *    MAIS gardé dans la liste « refusés » avec la RAISON serveur (jamais de
 *    boucle muette) ; 5xx/réseau = file CONSERVÉE, réessayé plus tard ;
 *  - blob local disparu entre-temps = refus honnêt « Datei lokal nicht
 *    (mehr) vorhanden », AUCUN octet réseau ;
 *  - pull-through à l'affichage : manque local → serveur → putBlob ; 404 =
 *    mémorisé en session (jamais redemandé à l'infini) ;
 *  - ANTI-BOUCLE : saveMangelPhotoSilent n'enfile JAMAIS (sinon chaque
 *    téléchargement repartirait en upload) ;
 *  - intégration réelle mangelPhotos (repli mémoire jsdom) : une photo qui
 *    n'existe que sur le serveur s'affiche, puis est servie du local.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetMediaSyncForTests,
  attachMediaSync,
  getMediaFailures,
  getMediaSyncStatus,
  markMediaForUpload,
  tryFetchMediaFromServer,
  uploadPendingMedia,
  type MediaSyncDeps,
} from "@/lib/mediaSync";
import {
  clearMangelPhotoMemory,
  loadMangelPhoto,
  loadMangelPhotoLocalOnly,
  saveMangelPhoto,
  saveMangelPhotoSilent,
} from "@/lib/mangelPhotos";

const h = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@/auth/SecuritySanitizer", () => ({ secureFetch: h.fetchMock }));

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function octets(status: number, bytes: number[], type: string): Response {
  return new Response(new Uint8Array(bytes), {
    status,
    headers: { "Content-Type": type },
  });
}

/** Deps dossier-en-mémoire : ce qu'IndexedDB fait en vrai (jsdom = repli). */
function dossier(seed: Record<string, Blob> = {}): { map: Map<string, Blob>; deps: MediaSyncDeps } {
  const map = new Map<string, Blob>(Object.entries(seed));
  return {
    map,
    deps: {
      getBlob: async (id) => map.get(id) ?? null,
      putBlob: async (id, blob) => { map.set(id, blob); },
    },
  };
}

describe("versement (upload)", () => {
  beforeEach(() => {
    _resetMediaSyncForTests();
    clearMangelPhotoMemory();
    h.fetchMock.mockReset();
  });
  afterEach(() => {
    _resetMediaSyncForTests();
    clearMangelPhotoMemory();
  });

  it("saveMangelPhoto : écrit le local ET enfile le versement (persisté sur disque)", async () => {
    // Sans moteur branché : la file est quand même tenue (redémarrage = reprise).
    const ok = await saveMangelPhoto("ph-1", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }));
    expect(ok).toBe(true);
    expect(getMediaSyncStatus().pendingUploads).toBe(1);
    expect(h.fetchMock).not.toHaveBeenCalled(); // rien ne part tout seul sans moteur
    const disque = JSON.parse(localStorage.getItem("narchi:media:upload-queue") ?? "[]") as string[];
    expect(disque).toContain("ph-1"); // survit à une fermeture navigateur
    expect(await loadMangelPhotoLocalOnly("ph-1")).not.toBeNull(); // affichable ICI tout de suite
  });

  it("versement réussi : POST multipart, sorti de file, statut propre", async () => {
    markMediaForUpload("ph-2"); // avant branchement : file tenue, pas de déclenchement
    const d = dossier({ "ph-2": new Blob([new Uint8Array([9, 9])], { type: "image/jpeg" }) });
    attachMediaSync(d.deps);
    h.fetchMock.mockResolvedValueOnce(json(200, { id: "ph-2", size: 2, mime: "image/jpeg" }));
    const n = await uploadPendingMedia();
    expect(n).toBe(1);
    expect(getMediaSyncStatus().pendingUploads).toBe(0);
    expect(getMediaSyncStatus().lastError).toBeNull();
    const [url, init] = h.fetchMock.mock.calls[0];
    expect(url).toBe("/api/v5/media/ph-2");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
  });

  it("REFUS DÉFINITIF 4xx : sorti de file, gardé à vue avec la RAISON serveur, jamais re-tenté", async () => {
    markMediaForUpload("ph-3");
    const d = dossier({ "ph-3": new Blob([new Uint8Array([1])], { type: "image/jpeg" }) });
    attachMediaSync(d.deps);
    h.fetchMock.mockResolvedValueOnce(json(422, { detail: "Dateityp nicht erlaubt" }));
    const n = await uploadPendingMedia();
    expect(n).toBe(0);
    const s = getMediaSyncStatus();
    expect(s.pendingUploads).toBe(0); // pas coincé en file
    expect(s.failedUploads).toBe(1);
    expect(getMediaFailures()).toEqual([{ id: "ph-3", reason: "Dateityp nicht erlaubt" }]);
    // Liste persistée elle aussi : le refus survit au redémarrage pour rester DIT.
    const disque = JSON.parse(localStorage.getItem("narchi:media:failed") ?? "[]") as Array<{ id: string }>;
    expect(disque.map((f) => f.id)).toContain("ph-3");
    // Un nouveau cycle ne re-tente PAS ce fichier (fin de boucle muette).
    await uploadPendingMedia();
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hors-ligne : AUCUN octet ne part, la file attend, pas de fausse erreur", async () => {
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    markMediaForUpload("ph-4");
    attachMediaSync(dossier({ "ph-4": new Blob([new Uint8Array([1])]) }).deps);
    const n = await uploadPendingMedia();
    expect(n).toBe(0);
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(getMediaSyncStatus().pendingUploads).toBe(1);
    expect(getMediaSyncStatus().lastError).toBeNull();
    spy.mockRestore();
  });

  it("5xx / panne : file CONSERVÉE (réessayé plus tard), erreur dite, rien classé refusé", async () => {
    markMediaForUpload("ph-5");
    attachMediaSync(dossier({ "ph-5": new Blob([new Uint8Array([1])]) }).deps);
    h.fetchMock.mockResolvedValueOnce(json(503, { detail: "maintenance" }));
    const n = await uploadPendingMedia();
    expect(n).toBe(0);
    const s = getMediaSyncStatus();
    expect(s.pendingUploads).toBe(1); // intact, repartira
    expect(s.failedUploads).toBe(0); // PAS un refus : serveur en panne ≠ fichier invalide
    expect(s.lastError).toBe("HTTP 503");
  });

  it("blob local disparu entre-temps : refus honnêt DIT, AUCUN appel réseau", async () => {
    markMediaForUpload("ph-6");
    attachMediaSync(dossier().deps); // dossier vide : le fichier a été effacé localement
    const n = await uploadPendingMedia();
    expect(n).toBe(0);
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(getMediaFailures()).toEqual([{ id: "ph-6", reason: "Datei lokal nicht (mehr) vorhanden" }]);
    expect(getMediaSyncStatus().pendingUploads).toBe(0); // jamais coincé
  });
});

describe("pull-through à l'affichage", () => {
  beforeEach(() => {
    _resetMediaSyncForTests();
    clearMangelPhotoMemory();
    h.fetchMock.mockReset();
  });
  afterEach(() => {
    _resetMediaSyncForTests();
    clearMangelPhotoMemory();
  });

  it("manque local → serveur → putBlob : la photo de l'autre appareil s'affiche", async () => {
    const d = dossier(); // rien ici
    attachMediaSync(d.deps);
    h.fetchMock.mockResolvedValueOnce(octets(200, [0xff, 0xd8, 0xff, 0x42], "image/jpeg"));
    const blob = await tryFetchMediaFromServer("ph-7");
    expect(blob).not.toBeNull();
    expect(blob!.size).toBe(4);
    expect(blob!.type).toBe("image/jpeg");
    expect(d.map.has("ph-7")).toBe(true); // rangé localement pour la prochaine fois
    expect(h.fetchMock.mock.calls[0][0]).toBe("/api/v5/media/ph-7");
  });

  it("404 serveur = n'existe nulle part : mémorisé, JAMAIS redemandé à l'infini", async () => {
    attachMediaSync(dossier().deps);
    h.fetchMock.mockResolvedValue(json(404, { detail: "inconnu" }));
    expect(await tryFetchMediaFromServer("ph-8")).toBeNull();
    expect(await tryFetchMediaFromServer("ph-8")).toBeNull();
    expect(h.fetchMock).toHaveBeenCalledTimes(1); // mémoire de session franche
  });

  it("panne serveur au pull-through : null honnête, erreur DITE, réessayable ensuite", async () => {
    attachMediaSync(dossier().deps);
    h.fetchMock.mockResolvedValueOnce(json(500, { detail: "boom" }));
    expect(await tryFetchMediaFromServer("ph-9")).toBeNull();
    expect(getMediaSyncStatus().lastError).toBe("HTTP 500");
    // Pas mémorisé comme « inexistant » : on peut réessayer.
    h.fetchMock.mockResolvedValueOnce(octets(200, [7, 7], "image/png"));
    expect(await tryFetchMediaFromServer("ph-9")).not.toBeNull();
  });

  it("intégration réelle mangelPhotos : import → versement AUTO ; affichage distant → local ensuite ; ANTI-BOUCLE", async () => {
    // Le VRAI collage du DashboardShell : le moteur lit/écrit mangelPhotos.
    // (Aveu de MON 1er jet de CE test : j'avais oublié que markMediaForUpload
    // DÉCLENCHE le versement quand le moteur est branché — comportement voulu
    // du produit : une photo importée part sans geste. Fixture refaite.)
    attachMediaSync({
      getBlob: loadMangelPhotoLocalOnly,
      putBlob: async (id, blob) => { await saveMangelPhotoSilent(id, blob); },
    });
    h.fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (init?.method === "POST") {
        return json(200, { id: u.split("/").pop(), size: 2, mime: "image/jpeg" });
      }
      if (u.includes("ph-nulle-part")) return json(404, { detail: "inconnu" });
      return octets(200, [0x89, 0x50, 0x4e, 0x47], "image/png");
    });

    // 1) Import ICI : la variante Silent n'enfile JAMAIS ; saveMangelPhoto
    //    enfile ET le versement part tout seul (rien à cliquer).
    await saveMangelPhotoSilent("ph-mute", new Blob([new Uint8Array([5])]));
    expect(getMediaSyncStatus().pendingUploads).toBe(0); // anti-boucle prouvée
    await saveMangelPhoto("ph-locale", new Blob([new Uint8Array([6, 6])]));
    await vi.waitFor(() => expect(getMediaSyncStatus().pendingUploads).toBe(0));
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(h.fetchMock.mock.calls[0][0]).toBe("/api/v5/media/ph-locale");
    expect((h.fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");

    // 2) Photo qui n'existe que sur le SERVEUR : affichée, rangée…
    const vue = await loadMangelPhoto("ph-lointaine");
    expect(vue).not.toBeNull();
    expect(vue!.type).toBe("image/png");
    // …et le téléchargement n'a RIEN re-mis en file (boucle interdite).
    expect(getMediaSyncStatus().pendingUploads).toBe(0);
    // Deuxième affichage : servi du LOCAL, plus d'appel réseau.
    const vue2 = await loadMangelPhoto("ph-lointaine");
    expect(vue2).not.toBeNull();
    expect(h.fetchMock).toHaveBeenCalledTimes(2); // 1 POST + 1 GET, rien de plus

    // 3) Inexistant PARTOUT : null franc (404 mémorisé, pas de 2e appel).
    expect(await loadMangelPhoto("ph-nulle-part")).toBeNull();
    expect(await loadMangelPhoto("ph-nulle-part")).toBeNull();
    expect(h.fetchMock).toHaveBeenCalledTimes(3);
  });
});
