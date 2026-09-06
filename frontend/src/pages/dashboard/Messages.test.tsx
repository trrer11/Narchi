/**
 * §108 — Gestion des conversations par CLIC DROIT (demande client :
 * « supprimer ou modifier le nom des conversations, uniquement owner et
 * admin »). Le SERVEUR fait foi (403 sinon — tests backend dédiés) ; ici
 * on épingle le contrat UI :
 *
 *  - owner/admin : clic droit sur une ligne de canal ouvre le menu ;
 *  - conversation DIRECTE : « Löschen » actif, « Umbenennen » désactivé
 *    ET expliqué (une DM porte le nom du contact) ; la modale DIT la
 *    perte définitive des messages avant l'appel ;
 *  - canal ÉQUIPE/PROJET : « Umbenennen » ET « Löschen » actifs (§110 —
 *    demande client : suppression de toute discussion ; le serveur pose
 *    une pierre tombale, le canal ne renaît JAMAIS d'une synchro) ;
 *    la modale DIT que pour un canal c'est « pour toute l'équipe » ;
 *  - architecte (ni owner ni admin) : preventDefault JAMAIS appelé → le
 *    menu natif du navigateur est conservé, aucune promesse d'action.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act, createElement } from "react";

import Messages from "@/pages/dashboard/Messages";

const h = vi.hoisted(() => {
  const CHANNELS = [
    { id: "ch-team-1", kind: "team" as const, name: "# Allgemein", memberIds: ["u1", "u2"], createdAt: "2026-08-01T09:00:00.000Z" },
    { id: "ch-project-p1", kind: "project" as const, name: "Notärztin-Neubau", memberIds: ["u1", "u2"], createdAt: "2026-08-02T09:00:00.000Z" },
    { id: "ch-dm-1", kind: "direct" as const, name: "Anna Baumann", memberIds: ["u1", "u2"], createdAt: "2026-08-03T09:00:00.000Z" },
  ];
  const TEAMMATES = [{ id: "u2", name: "Anna Baumann", email: "anna@buero.de", role: "architect" }];
  const ownerAuth = {
    user: { id: "u1", name: "Halil Owner", email: "halil@buero.de", role: "owner" as string },
    users: TEAMMATES,
    isOwner: true as boolean,
  };
  return {
    CHANNELS,
    ownerAuth,
    // Réassigné par test (owner / admin / architecte) — la factory lit la
    // valeur AU MOMENT du rendu, comme le vrai AuthStore memoïsé.
    auth: { ...ownerAuth },
    getChannelsMock: vi.fn(async () => CHANNELS),
    renameMock: vi.fn(async (channelId: string, name: string) => ({ ...CHANNELS[0], id: channelId, name })),
    deleteMock: vi.fn(async () => ({ deletedMessages: 4 })),
  };
});

vi.mock("@/lib/chatService", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/chatService")>();
  return {
    ...original,
    ensureChannels: vi.fn(async () => {}),
    getTeamUsers: vi.fn(async () => []),
    getChannels: h.getChannelsMock,
    getMessages: vi.fn(async () => []),
    unreadCount: vi.fn(async () => 0),
    markRead: vi.fn(),
    sendMessage: vi.fn(async () => ({}) as never),
    subscribeChat: () => () => {},
    connectChannelSocket: () => () => {},
    ensureDirectChannel: vi.fn(async () => h.CHANNELS[2]),
    renameChannel: h.renameMock,
    deleteChannel: h.deleteMock,
  };
});

vi.mock("@/store/AuthStore", () => ({ useAuth: () => h.auth }));

vi.mock("@/store/AppStore", () => {
  const projects: Array<{ id: string; name: string }> = [];
  const appValue = { projects };
  return {
    useAppStore: (sel?: (s: { route: { path: string } }) => unknown) =>
      typeof sel === "function" ? sel({ route: { path: "/app" } }) : { route: { path: "/app" } },
    useApp: () => appValue,
  };
});

let mounted: Array<{ host: HTMLElement; root: ReturnType<typeof createRoot> }> = [];

afterEach(() => {
  for (const m of mounted) {
    try { act(() => m.root.unmount()); } catch { /* noop */ }
    m.host.remove();
  }
  mounted = [];
  document.body.innerHTML = "";
});

beforeEach(() => {
  h.auth = { ...h.ownerAuth };
  h.getChannelsMock.mockClear();
  h.renameMock.mockClear();
  h.deleteMock.mockClear();
});

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Messages)); });
  // Laisse finir la chaîne refreshChannels (ensure→users→channels).
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  const entry = { host, root };
  mounted.push(entry);
  return entry;
}

/** Premier bouton dont le texte contient `text` (ligne canal, item, action). */
function rowOf(host: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(host.querySelectorAll("button")).find((b) => (b.textContent || "").includes(text));
  if (!btn) throw new Error(`bouton introuvable : ${text}`);
  return btn;
}

async function rightClick(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 220 }));
  });
}

async function click(el: HTMLElement) {
  await act(async () => { el.click(); });
}

/** Champ contrôlé React : setter natif + événement (pattern §104). */
function setField(host: HTMLElement, selector: string, value: string) {
  const el = host.querySelector<HTMLInputElement>(selector);
  if (!el) throw new Error(`champ introuvable : ${selector}`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("§108 — clic droit sur les conversations (owner/admin)", () => {
  it("owner sur une DM : Löschen actif, Umbenennen désactivé-expliqué, modale qui DIT la perte, deleteChannel appelé", async () => {
    const { host } = await mount();
    expect(host.textContent).toContain("Anna Baumann");

    await rightClick(rowOf(host, "Anna Baumann"));
    const menu = host.querySelector('[role="menu"]');
    expect(menu).toBeTruthy();
    expect(menu?.getAttribute("aria-label")).toBe("Kanal: Anna Baumann");

    // Une DM porte le NOM DU CONTACT : renommer serait du fake → désactivé + raison.
    const renameItem = rowOf(menu as HTMLElement, "Umbenennen");
    expect(renameItem.disabled).toBe(true);
    expect(renameItem.title).toContain("Namen des Kontakts");

    await click(rowOf(menu as HTMLElement, "Löschen"));
    expect(host.querySelector('[role="menu"]')).toBeNull(); // menu refermé au choix
    const dialog = host.querySelector('[role="dialog"][aria-label="Kanal löschen"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.textContent).toContain("endgültig gelöscht"); // la perte est DITE avant l'acte
    expect(dialog?.textContent).toContain("Anna Baumann");

    await click(rowOf(dialog as HTMLElement, "Endgültig löschen"));
    expect(h.deleteMock).toHaveBeenCalledTimes(1);
    expect(h.deleteMock).toHaveBeenCalledWith("ch-dm-1");
    // Liste rechargée après suppression (montage + rafraîchissement) et modale refermée.
    expect(h.getChannelsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("owner sur un canal projet : Umbenennen enregistre « Neubau Süd », Löschen désormais ACTIF (§110)", async () => {
    const { host } = await mount();
    await rightClick(rowOf(host, "Notärztin-Neubau"));
    const menu = host.querySelector('[role="menu"]');
    expect(menu).toBeTruthy();

    // §110 — suppression possible aussi sur les canaux auto-gérés
    // (pierre tombale serveur : ils ne renaissent plus — voir test suivant).
    const deleteItem = rowOf(menu as HTMLElement, "Löschen");
    expect(deleteItem.disabled).toBe(false);

    await click(rowOf(menu as HTMLElement, "Umbenennen"));
    const dialog = host.querySelector('[role="dialog"][aria-label="Kanal umbenennen"]');
    expect(dialog).toBeTruthy();
    const input = dialog!.querySelector<HTMLInputElement>("#ch-rename-input");
    expect(input?.value).toBe("Notärztin-Neubau"); // nom actuel pré-rempli

    setField(dialog as HTMLElement, "#ch-rename-input", "Neubau Süd");
    await click(rowOf(dialog as HTMLElement, "Speichern"));
    expect(h.renameMock).toHaveBeenCalledTimes(1);
    expect(h.renameMock).toHaveBeenCalledWith("ch-project-p1", "Neubau Süd");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("§110 — owner supprime un CANAL PROJET : la modale dit « toute l'équipe + jamais recréé », deleteChannel appelé", async () => {
    const { host } = await mount();
    await rightClick(rowOf(host, "Notärztin-Neubau"));
    await click(rowOf(host.querySelector('[role="menu"]') as HTMLElement, "Löschen"));

    const dialog = host.querySelector('[role="dialog"][aria-label="Kanal löschen"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.textContent).toContain("Notärztin-Neubau");
    // La VÉRITÉ du cas canal : tout le monde est concerné, pas de retour
    // automatique (pierre tombale serveur) — jamais de « supprimé » qui revient.
    expect(dialog?.textContent).toContain("für das ganze Team");
    expect(dialog?.textContent).toContain("nicht automatisch neu erstellt");

    await click(rowOf(dialog as HTMLElement, "Endgültig löschen"));
    expect(h.deleteMock).toHaveBeenCalledTimes(1);
    expect(h.deleteMock).toHaveBeenCalledWith("ch-project-p1");
  });

  it("architecte (ni owner ni admin) : preventDefault JAMAIS appelé, menu natif conservé, aucun menu Narchi", async () => {
    h.auth = {
      user: { id: "u3", name: "Max Architekt", email: "max@buero.de", role: "architect" },
      users: h.ownerAuth.users,
      isOwner: false,
    };
    const { host } = await mount();

    const row = rowOf(host, "Notärztin-Neubau");
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    let allowed: boolean | undefined;
    await act(async () => { allowed = row.dispatchEvent(event); });
    // dispatchEvent renvoie false SEULEMENT si preventDefault a été appelé.
    expect(allowed).toBe(true); // menu natif du navigateur conservé
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("admin (sans être owner) : menu ouvert comme l'owner, Échap le referme, zéro appel réseau sans confirmation", async () => {
    h.auth = {
      user: { id: "u4", name: "Ayse Admin", email: "ayse@buero.de", role: "admin" },
      users: h.ownerAuth.users,
      isOwner: false,
    };
    const { host } = await mount();

    await rightClick(rowOf(host, "Anna Baumann"));
    expect(host.querySelector('[role="menu"]')).toBeTruthy();

    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(h.deleteMock).not.toHaveBeenCalled();
    expect(h.renameMock).not.toHaveBeenCalled();
  });
});
