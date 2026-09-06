/**
 * §104 — Test composant de la page chantier (idée client).
 *
 * Le scénario métier complet, sans serveur ni faux : on importe deux JPEG
 * nommés comme le fait un téléphone → la page regroupe en « Besuch » avec
 * la bonne date → on coche le jour → on crée un vrai Mangel du store
 * (Tag = JOUR DE LA PHOTO, preuve datée) → les blobs photo restent
 * accessibles depuis l'Issue. Puis : Verwerfen supprime vraiment, et un
 * titre vide n'engendre rien.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act, createElement } from "react";

import Baustelle from "@/pages/dashboard/Baustelle";
import { useAppStore } from "@/store/AppStore";
import {
  clearMangelPhotoMemory,
  loadMangelPhoto,
} from "@/lib/mangelPhotos";

const PROJECT = {
  id: "p-1",
  code: "N-01",
  name: "Notärztin-Neubau Hannover",
  type: "office",
  location: "Hannover",
  client: "Bauherr GmbH",
  status: "active" as never,
  progress: 0,
  budget: 0,
  spent: 0,
  grossFloorArea: 0,
  floors: 1,
  startDate: "2026-06-01",
  endDate: "2027-06-01",
  team: [],
  classificationCode: "NMC-10",
  carbonBudgetKg: 0,
  health: 0,
  riskScore: 0,
  accent: "#f59e0b",
};

/** JPEG minimal sans EXIF (SOI+EOI) → la date vient du NOM, repli épinglé. */
function jpegFile(name: string): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], name, {
    type: "image/jpeg",
    lastModified: Date.UTC(2020, 0, 1),
  });
}

function seed() {
  useAppStore.setState({
    projects: [PROJECT],
    activeProjectId: "p-1",
    issues: [],
  });
}

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Baustelle)); });
  return { host, root };
}

function setField(host: HTMLElement, selector: string, value: string) {
  const el = host.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
  if (!el) throw new Error(`champ introuvable : ${selector}`);
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

/** Injecte des fichiers dans l'input et laisse finir la chaîne async. */
async function importFiles(host: HTMLElement, files: File[]) {
  const input = host.querySelector<HTMLInputElement>("#bm-import");
  if (!input) throw new Error("input d'import introuvable");
  Object.defineProperty(input, "files", { configurable: true, value: files });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

function button(host: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text);
  if (!found) throw new Error(`bouton introuvable : « ${text} »`);
  return found;
}

describe("§104 — page Baustelle (import bureau + tri EXIF + Mängel)", () => {
  beforeEach(() => {
    clearMangelPhotoMemory();
    seed();
  });

  it("montre les états vides et l'honnêteté « keine Bilderkennung », tout en allemand", async () => {
    const { host, root } = await mount();
    const text = host.textContent ?? "";
    expect(text).toContain("Baustelle");
    expect(text).toContain("Notärztin-Neubau Hannover");
    expect(text).toContain("Fotos importieren");
    expect(text).toContain("Noch keine Fotos importiert");
    expect(text).toContain("Bilderkennung"); // dit que l'IA de contenu n'existe PAS
    expect(text).toContain("Keine offenen Mängel im aktiven Projekt.");
    expect(text).toContain("Erst Fotos auswählen"); // bouton désarmé sans sélection
    act(() => root.unmount());
    host.remove();
  });

  it("import → groupement par date → Mangel réel dont le Tag = jour de la PHOTO", async () => {
    const { host, root } = await mount();
    await importFiles(host, [
      jpegFile("IMG_20260801_091200.jpg"),
      jpegFile("IMG_20260801_091800.jpg"), // +6 min → MÊME séance
    ]);

    let text = host.textContent ?? "";
    expect(text).toContain("Besuch vom 01.08.2026");
    expect(text).toContain("2 Fotos");                       // total jour
    expect(text).toContain("09:12–09:18");                   // séance groupée
    expect(text).toContain("2 × Dateiname");                 // source de date DITE

    // Coche le jour entier, puis crée le Mangel.
    await act(async () => { button(host, "Tag auswählen").click(); });
    expect(host.textContent).toContain("2 ausgewählt");

    setField(host, "#bm-title", "Riss in Treppenlauf OG 2");
    setField(host, "#bm-zone", "OG 2");
    const form = host.querySelector("form")!;
    await act(async () => { form.requestSubmit(); });

    // Vérité dans le STORE : une Issue, Tag 61 = 01.08.2026 (photo), pas 70 (saisie).
    const created = useAppStore.getState().issues.find((i) => i.projectId === "p-1");
    expect(created).toBeDefined();
    expect(created!.title).toBe("Riss in Treppenlauf OG 2");
    expect(created!.raisedDay).toBe(61);
    expect(created!.assignee).toBe("Baustelle");
    expect(created!.photoIds).toHaveLength(2);

    // Les blobs restent lisibles DEPUIS l'Issue (la preuve n'est pas un lien mort).
    const blob = await loadMangelPhoto(created!.photoIds![0]);
    expect(blob).not.toBeNull();
    expect(blob!.type).toBe("image/jpeg");

    text = host.textContent ?? "";
    expect(text).toContain("Mangel gespeichert — 2 Fotos angehängt");
    expect(text).toContain("Offene Mängel (1)");
    expect(text).toContain("Noch keine Fotos importiert"); // photos consommées
    act(() => root.unmount());
    host.remove();
  });

  it("« Verwerfen » détruit vraiment la photo (blob + vignette), aucun Mangel créé", async () => {
    const { host, root } = await mount();
    await importFiles(host, [jpegFile("IMG_20260810_101010.jpg")]);
    expect(host.textContent).toContain("Besuch vom 10.08.2026");

    await act(async () => {
      button(host, "×").click(); // aria-label « IMG_… verwerfen », libellé visuel ×
    });
    expect(host.textContent).toContain("Noch keine Fotos importiert");
    expect(useAppStore.getState().issues.filter((i) => i.projectId === "p-1")).toHaveLength(0);
    expect(await loadMangelPhoto("n'importe")).toBeNull();
    act(() => root.unmount());
    host.remove();
  });

  it("§105 — PNG accepté (source de date DITE), HEIC refusé et expliqué, texte ignoré", async () => {
    const { host, root } = await mount();
    await importFiles(host, [
      // Screenshot PNG sans EXIF (signature seule) → date du fichier, DITE.
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "scan.png", {
        type: "image/png",
        // Midi UTC : le jour local reste le 03.08 dans tout fuseau raisonnable.
        lastModified: Date.UTC(2026, 7, 3, 12, 0),
      }),
      new File(["procès-verbal"], "notizen.txt", { type: "text/plain" }),
      new File([new Uint8Array([0x00])], "IMG_3102.heic", { type: "" }),
    ]);

    const text = host.textContent ?? "";
    expect(text).toContain("1 Foto importiert");          // le PNG est entré
    expect(text).toContain("1 × Dateidatum");              // source honnêtement dite
    expect(text).toContain("Besuch vom 03.08.2026");       // regroupé quand même
    expect(text).toContain("1 übersprungen (kein unterstütztes Bild/Video)"); // le .txt (libellé §110)
    expect(text).toContain("HEIC");                        // refus explicité…
    expect(text).toContain("Maximale Kompatibilität");     // …avec la solution iPhone
    act(() => root.unmount());
    host.remove();
  });

  it("titre vide malgré une sélection : validation native, rien n'est créé", async () => {
    const { host, root } = await mount();
    await importFiles(host, [jpegFile("IMG_20260810_101010.jpg")]);
    await act(async () => { button(host, "Tag auswählen").click(); });
    const form = host.querySelector("form")!;
    await act(async () => { form.requestSubmit(); });
    expect(useAppStore.getState().issues.filter((i) => i.projectId === "p-1")).toHaveLength(0);
    act(() => root.unmount());
    host.remove();
  });
});

describe("§106 — bugs lus dans la capture du client, épinglés", () => {
  beforeEach(() => {
    clearMangelPhotoMemory();
    seed();
  });

  it("« Kein Projekt » + liste VIDE : bloqué, jamais silencieux, et le remède proposé est la CRÉATION (§106+§110+§111)", async () => {
    useAppStore.setState({ projects: [], activeProjectId: "" });
    const { host, root } = await mount();
    const text = host.textContent ?? "";
    // §111 — la vraie panne du client : liste vide → ancienne consigne
    // « oben links wählen » = cul-de-sac. La carte DIT la vérité.
    expect(text).toContain("Noch gar kein Projekt angelegt");
    expect(text).toContain("nichts zum Wählen");
    expect(text).toContain("Zuerst dein erstes Projekt anlegen (oben im gelben Kasten)");
    expect(text).toContain("Import gesperrt — kein Projekt");
    expect(text).not.toContain("Zuerst ein Projekt wählen (oben links)");
    const input = host.querySelector<HTMLInputElement>("#bm-import");
    expect(input).not.toBeNull();
    expect(input!.disabled).toBe(true);
    // …et un CLIC n'est plus une porte muette : raison + remède À JOUR
    // (création, pas choix) à côté de la zone.
    await act(async () => {
      host.querySelector('label[for="bm-import"]')!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(host.textContent).toContain("darum ist der Import gesperrt");
    expect(host.textContent).toContain("erstes Projekt anlegen");
    expect(host.textContent).toContain("danach funktioniert der Import sofort");
    // La garde, elle, ne bouge pas : même si l'événement part, rien n'entre.
    await importFiles(host, [jpegFile("IMG_20260810_101010.jpg")]);
    expect(host.textContent).toContain("Noch keine Fotos importiert");
    expect(useAppStore.getState().issues).toHaveLength(0);
    act(() => root.unmount());
    host.remove();
  });

  it("§111 — LE FIX : créer le premier projet DEPUIS la carte ambrée débloque l'import aussitôt (preuve bout-en-bout)", async () => {
    useAppStore.setState({ projects: [], activeProjectId: "" });
    const { host, root } = await mount();
    // Le client tape juste un nom (10 secondes, comme promis).
    setField(host, "#bm-first-project", "Anbau Familie Meyer");
    const guardForm = host.querySelector<HTMLInputElement>("#bm-first-project")!.closest("form")!;
    await act(async () => { guardForm.requestSubmit(); });
    // Le projet existe, il est CHOISI (addProject le fait), l'import est libre.
    const state = useAppStore.getState();
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0].name).toBe("Anbau Familie Meyer");
    expect(state.activeProjectId).toBe(state.projects[0].id);
    let text = host.textContent ?? "";
    expect(text).toContain("angelegt und automatisch gewählt");      // note verte de confirmation
    expect(text).not.toContain("Import gesperrt — kein Projekt");
    expect(text).toContain("Fotos & Videos hierher ziehen oder klicken");
    expect(host.querySelector<HTMLInputElement>("#bm-import")!.disabled).toBe(false);
    // Et l'import marche VRAIMENT maintenant — pas un déblocage cosmétique.
    await importFiles(host, [jpegFile("IMG_20260810_101010.jpg")]);
    text = host.textContent ?? "";
    expect(text).toContain("Besuch vom 10.08.2026");
    expect(text).toContain("1 Foto");
    act(() => root.unmount());
    host.remove();
  });

  it("§111 — un projet existe mais RIEN de choisi : la page choisit TOUTE SEULE (plus jamais le cul-de-sac « Kein Projekt »)", async () => {
    useAppStore.setState({ activeProjectId: "" }); // projets présents via seed(), choix vide
    const { host, root } = await mount();
    expect(useAppStore.getState().activeProjectId).toBe("p-1"); // choix automatique fait
    const text = host.textContent ?? "";
    expect(text).not.toContain("Import gesperrt — kein Projekt");
    expect(text).toContain("Notärztin-Neubau Hannover");
    expect(text).toContain("Fotos & Videos hierher ziehen oder klicken");
    await importFiles(host, [jpegFile("IMG_20260810_101010.jpg")]);
    expect(host.textContent).toContain("Besuch vom 10.08.2026");
    act(() => root.unmount());
    host.remove();
  });

  it("cohérence : badge « n Fotos » et agenda visibles ENSEMBLE ; après création, compteur = lignes", async () => {
    const { host, root } = await mount();
    await importFiles(host, [jpegFile("IMG_20260810_101010.jpg")]);
    let text = host.textContent ?? "";
    expect(text).toContain("1 Foto");               // badge Besuche
    expect(text).toContain("Besuch vom 10.08.2026"); // l'agenda existe EN MÊME TEMPS
    expect(text).not.toContain("Noch keine Fotos importiert");

    await act(async () => { button(host, "Tag auswählen").click(); });
    setField(host, "#bm-title", "TEST");
    const form = host.querySelector("form")!;
    await act(async () => { form.requestSubmit(); });

    text = host.textContent ?? "";
    expect(text).toContain("Offene Mängel (1)");     // compteur…
    expect(host.querySelectorAll("li")).toHaveLength(1); // …= lignes réelles
    expect(text).toContain("0 Fotos");               // badge retombé à zéro
    expect(text).toContain("Noch keine Fotos importiert");
    act(() => root.unmount());
    host.remove();
  });

  it("clic sur la photo d'un Mangel → visionneuse plein écran (réponse « aucune information »)", async () => {
    const { host, root } = await mount();
    await importFiles(host, [jpegFile("IMG_20260801_091200.jpg")]);
    await act(async () => { button(host, "Tag auswählen").click(); });
    setField(host, "#bm-title", "Riss in Treppenlauf");
    const form = host.querySelector("form")!;
    await act(async () => { form.requestSubmit(); });

    const thumb = host.querySelector<HTMLButtonElement>('[aria-label="Foto vergrößern"]');
    expect(thumb).not.toBeNull();
    await act(async () => { thumb!.click(); });
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("Riss in Treppenlauf");
    expect(dialog!.textContent).toContain("Tag 61");
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Visionneuse schließen"]')!.click();
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    act(() => root.unmount());
    host.remove();
  });

  it("le balayage des orphelines ne touche JAMAIS une photo référencée par un Mangel", async () => {
    const { saveMangelPhoto } = await import("@/lib/mangelPhotos");
    await saveMangelPhoto("foto-keep", new Blob(["keep"]));
    await saveMangelPhoto("foto-orphan", new Blob(["orphan"]));
    seed();
    useAppStore.setState({
      issues: [{
        id: "mgl-1", title: "Alt", level: "k. A.", classificationCode: "NMC-10",
        severity: "major", status: "open", assignee: "Baustelle", raisedDay: 5,
        description: "", projectId: "p-1", photoIds: ["foto-keep"],
      } as never],
    });
    const { host, root } = await mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(await loadMangelPhoto("foto-keep")).not.toBeNull();
    expect(await loadMangelPhoto("foto-orphan")).toBeNull();
    // Et la ligne montre « 1 Foto » en badge — l'info que le client réclamait.
    expect(host.textContent).toContain("1 Foto");
    expect(host.textContent).toContain("Erheblich");
    act(() => root.unmount());
    host.remove();
  });
});

describe("§107 — « aucune info ne s'affiche » ; §109 — zoom retiré de la page (retours client)", () => {
  beforeEach(() => {
    clearMangelPhotoMemory();
    seed();
    localStorage.clear();
  });

  it("la ligne de Mangel montre date de visite réelle, zone ET commentaire saisis", async () => {
    const { host, root } = await mount();
    await importFiles(host, [
      jpegFile("IMG_20260801_091200.jpg"),
      jpegFile("IMG_20260801_091800.jpg"),
    ]);
    await act(async () => { button(host, "Tag auswählen").click(); });
    setField(host, "#bm-title", "Riss in Treppenlauf OG 2");
    setField(host, "#bm-zone", "OG 2");
    setField(host, "#bm-desc", "ca. 30 cm lang, ruhig — bitte Statiker fragen");
    const form = host.querySelector("form")!;
    // Gravité en pastille (§105) : on clique « Kritisch » DANS le formulaire.
    const kritisch = Array.from(form.querySelectorAll("button")).find((b) => b.textContent === "Kritisch");
    expect(kritisch).toBeDefined();
    await act(async () => { kritisch!.click(); });
    await act(async () => { form.requestSubmit(); });

    const row = host.querySelector("li")!;
    const rowText = row.textContent ?? "";
    expect(rowText).toContain("Riss in Treppenlauf OG 2");
    expect(rowText).toContain("OG 2");                        // étage saisi
    expect(rowText).toContain("Besuch: 01.08.2026");         // vraie date de visite
    expect(rowText).toContain("ca. 30 cm lang, ruhig");      // commentaire enfin visible
    expect(rowText).toContain("Kritisch");                   // gravité choisie…
    act(() => root.unmount());
    host.remove();
  });

  it("§109 — le widget zoom a QUITTÉ la page : elle ne se zoome plus elle-même, pleine largeur", async () => {
    const { host, root } = await mount();
    const page = host.querySelector<HTMLElement>("#bm-page")!;
    expect(page.style.zoom).toBe("");                        // pas de zoom local (doublon §107 retiré)
    expect(page.className).not.toContain("max-w-3xl");       // « côtés vides » de la capture client
    // Aucun bouton de pourcentage ne traîne plus sur la page :
    const percentButtons = Array.from(host.querySelectorAll("button"))
      .filter((b) => /^\s*(70|85|100)\s*%\s*$/.test(b.textContent ?? ""));
    expect(percentButtons.length).toBe(0);
    // La densité est un réglage d'INTERFACE (barre du haut) — épingle :
    expect(localStorage.getItem("narchi:baustelle:zoom")).toBeNull();
    act(() => root.unmount());
    host.remove();
  });
});



/** §110 — Fabrique un mini MP4 dont la boîte mvhd porte la date de tournage. */
function mp4File(name: string, creationUtcMs: number): File {
  const creationS = Math.floor(creationUtcMs / 1000) + 2_082_844_800;
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const payload = [0, 0, 0, 0, ...u32(creationS), ...u32(creationS), ...u32(1000), ...u32(0)];
  const size = 8 + payload.length;
  const bytes = [...u32(size), 0x6d, 0x76, 0x68, 0x64, ...payload]; // taille + « mvhd »
  const exact: Uint8Array<ArrayBuffer> = new Uint8Array(bytes); // Buffer EXACT (TS ≥ 5.7)
  return new File([exact], name, { type: "video/mp4" });
}

describe("§110 — import VIDÉO (demande client) : réel, daté, rattaché", () => {
  beforeEach(() => {
    clearMangelPhotoMemory();
    seed();
    localStorage.clear();
  });

  it("photo + vidéo MP4 : groupées au jour de tournage, comptages DISTINCTS, Mangel garde la vidéo", async () => {
    const { host, root } = await mount();
    await importFiles(host, [
      jpegFile("IMG_20260801_091200.jpg"),
      mp4File("rundgang.mp4", Date.UTC(2026, 7, 1, 9, 30, 0)), // mvhd → video-meta
    ]);
    let text = host.textContent ?? "";
    expect(text).toContain("1 Foto + 1 Video importiert");
    expect(text).toContain("1 × Aufnahmedatum (Video-Metadaten)");  // source DITE
    expect(text).toContain("Besuch vom 01.08.2026");
    expect(text).toContain("1 Foto + 1 Video");                      // comptage distinct du jour

    await act(async () => { button(host, "Tag auswählen").click(); });
    expect(host.textContent).toContain("Mangel mit 1 Foto + 1 Video speichern");

    setField(host, "#bm-title", "Wasserschaden KG");
    const form = host.querySelector("form")!;
    await act(async () => { form.requestSubmit(); });

    const issues = useAppStore.getState().issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].photoIds).toHaveLength(2);
    expect(issues[0].videoIds).toHaveLength(1);                      // traçabilité persistée
    text = host.textContent ?? "";
    expect(text).toContain("Mangel gespeichert — 1 Foto + 1 Video angehängt");
    act(() => root.unmount());
    host.remove();
  });

  it("une vidéo AVI n'entre JAMAIS : refusée avec explication (même règle que HEIC)", async () => {
    const { host, root } = await mount();
    await importFiles(host, [
      new File([new Uint8Array([0x52, 0x49, 0x46, 0x46])], "alt.avi", { type: "video/x-msvideo" }),
    ]);
    const text = host.textContent ?? "";
    expect(text).toContain("nicht abspielbar im Browser");
    expect(text).toContain("bitte MP4/WebM/MOV vom Handy");
    expect(text).toContain("Noch keine Fotos importiert");           // rien d'importé en cachette
    expect(useAppStore.getState().issues).toHaveLength(0);
    act(() => root.unmount());
    host.remove();
  });
});
