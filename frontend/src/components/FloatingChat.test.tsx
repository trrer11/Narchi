/**
 * §109 — Dock de chat : UNE SEULE bulle noire (demande client, capture à
 * l'appui : « j'ai plusieurs bulles qui apparaissent, je dois juste avoir
 * la bulle noire avec des notifications »).
 *
 * Épinglé ici :
 *  - plus JAMAIS de rangée de bulles ambre (une par canal non lu) ;
 *  - la bulle unique porte le TOTAL des non lus ;
 *  - le détail par conversation n'est pas perdu : il vit dans le panneau
 *    « Unterhaltungen » (canaux ET directs, pastille par ligne) ;
 *  - au démarrage, aucune fenêtre de la session passée ne rouvre seule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act, createElement } from "react";

const h = vi.hoisted(() => {
  const CHANNELS = [
    { id: "ch-team-1", kind: "team" as const, name: "Projekt Süd", memberIds: ["u1", "u2"], createdAt: "2026-08-01T09:00:00.000Z" },
    { id: "ch-dm-1", kind: "direct" as const, name: "Anna Baumann", memberIds: ["u1", "u2"], createdAt: "2026-08-02T09:00:00.000Z" },
    { id: "ch-dm-2", kind: "direct" as const, name: "Ben Krüger", memberIds: ["u1", "u3"], createdAt: "2026-08-03T09:00:00.000Z" },
  ];
  const UNREADS: Record<string, number> = { "ch-team-1": 13, "ch-dm-1": 1, "ch-dm-2": 3 }; // total 17
  return {
    CHANNELS,
    UNREADS,
    unreadMock: vi.fn(async (_userId: string, channelId: string) => UNREADS[channelId] ?? 0),
    getMessagesMock: vi.fn(async () => []),
  };
});

vi.mock("@/lib/chatService", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/chatService")>();
  return {
    ...original,
    ensureChannels: vi.fn(async () => {}),
    getTeamUsers: vi.fn(async () => []),
    getChannels: vi.fn(async () => h.CHANNELS),
    getMessages: h.getMessagesMock,
    unreadCount: h.unreadMock,
    markRead: vi.fn(),
    sendMessage: vi.fn(async () => ({}) as never),
    subscribeChat: () => () => {},
    connectChannelSocket: () => () => {},
    ensureDirectChannel: vi.fn(async () => h.CHANNELS[1]),
  };
});

vi.mock("@/store/AuthStore", () => {
  const user = { id: "u1", name: "Halil Owner", email: "halil@buero.de", role: "owner" };
  const users: never[] = [];
  const value = { user, users, isOwner: true };
  return { useAuth: () => value };
});

vi.mock("@/store/AppStore", () => {
  const projects: never[] = [];
  const appValue = { projects };
  return {
    useAppStore: (sel?: (s: { route: { path: string } }) => unknown) =>
      typeof sel === "function" ? sel({ route: { path: "/app" } }) : { route: { path: "/app" } },
    useApp: () => appValue,
  };
});

import { FloatingChatManager } from "@/components/FloatingChat";

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
  localStorage.clear();
  h.unreadMock.mockClear();
  h.getMessagesMock.mockClear();
});

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(FloatingChatManager)); });
  // Laisse finir le refresh initial (ensure → canaux → non lus ×3).
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  mounted.push({ host, root });
  return { host, root };
}

/** Tous les boutons « bulle » du dock (cercles flottants en bas à droite). */
function bubbleButtons(host: HTMLElement): HTMLButtonElement[] {
  const dock = host.querySelector(".fixed");
  if (!dock) throw new Error("dock introuvable");
  return Array.from(dock.querySelectorAll<HTMLButtonElement>("button.rounded-full"));
}

describe("§109 — une seule bulle noire, détail dans le panneau", () => {
  it("avec 17 non lus sur 3 conversations : UNE bulle portant « 17 », zéro bulle ambre", async () => {
    const { host } = await mount();
    const bubbles = bubbleButtons(host);
    expect(bubbles.length).toBe(1);                       // LA bulle noire, point
    expect(bubbles[0].getAttribute("aria-label")).toBe("Teamkontakt öffnen");
    expect(bubbles[0].textContent).toContain("17");       // le TOTAL survit
    // Les anciens leurre-bulles (une par canal) ont disparu de l'écran :
    expect(host.querySelector('button[title="Projekt Süd"]')).toBeNull();
    expect(host.querySelector('button[title="Anna Baumann"]')).toBeNull();
  });

  it("le détail par conversation est dans le panneau (canaux ET directs), pas perdu", async () => {
    const { host } = await mount();
    await act(async () => { bubbleButtons(host)[0].click(); });

    expect(host.textContent).toContain("Unterhaltungen");
    expect(host.textContent).toContain("Projekt Süd");    // canal d'équipe listé
    expect(host.textContent).toContain("Anna Baumann");   // DM listée aussi
    expect(host.textContent).toContain("Ben Krüger");
    expect(host.textContent).toContain("13");             // pastille par ligne
    // L'annuaire reste dispo (placeholders = attributs, PAS du textContent —
    // mon 1er jet le cherchait dans le texte : assertion corrigée).
    expect(host.querySelector('input[aria-label="Kollege suchen"]')).toBeTruthy();

    // Ouvrir une conversation depuis le panneau : la VRAIE fenêtre apparaît.
    const row = Array.from(host.querySelectorAll("button")).find((b) => (b.textContent || "").includes("Anna Baumann"))!;
    await act(async () => { row.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    // La fenêtre s'est VRAIMENT ouverte (placeholder en attribut — même
    // erreur d'assertion que ci-dessus, corrigée) et ses messages chargés.
    expect(host.querySelector('input[placeholder^="Nachricht schreiben"]')).toBeTruthy();
    expect(h.getMessagesMock).toHaveBeenCalledWith("ch-dm-1");
  });

  it("démarrage : aucune fenêtre ne rouvre seule, l'ancienne clé de restauration est oubliée", async () => {
    // Vestige d'avant §109 : une session passée aurait laissé cette clé.
    localStorage.setItem("narchi:floatingChat:open", JSON.stringify(["ch-team-1", "ch-dm-1"]));
    const { host } = await mount();
    // Preuve RÉELLE qu'aucune fenêtre n'a rouvert : une fenêtre charge ses
    // messages au montage — ici getMessages n'a JAMAIS été appelé.
    expect(h.getMessagesMock).not.toHaveBeenCalled();
    expect(host.querySelector('input[placeholder^="Nachricht schreiben"]')).toBeNull();
    expect(bubbleButtons(host).length).toBe(1);                           // une bulle
    expect(localStorage.getItem("narchi:floatingChat:open")).toBeNull();  // nettoyée
  });
});
