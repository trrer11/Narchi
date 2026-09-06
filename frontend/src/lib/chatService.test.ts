/**
 * §84 — chatService : helper anti-tempête + régression composant.
 *
 * CAUSE RÉELLE remontée par le client (« la bulle va et vient ~2×/s ») :
 * FloatingChatWindow/Messages appelaient markRead() à CHAQUE cycle de
 * rafraîchissement. Or markRead déclenche l'événement global
 * « narchi-chat-read », et subscribeChat y répond IMMÉDIATEMENT
 * (attempt=0 + cb() instantané) → nouveau cycle → nouveau markRead…
 * boucle auto-entretenue tant qu'une conversation est suivie.
 *
 * Verrou : markRead ne doit être émis QUE si un message PLUS RÉCENT que
 * le dernier acquitté est présent (horodatage le plus récent connu).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  newestActivityTimestamp,
  shouldMarkReadNow,
  type ChatMessage,
} from "@/lib/chatService";

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "m0",
  channelId: "ch1",
  authorId: "u2",
  authorName: "Anna",
  text: "Hallo",
  createdAt: "2026-08-09T10:00:00.000Z",
  ...over,
});

describe("newestActivityTimestamp / shouldMarkReadNow (verrou §84)", () => {
  it("retourne l'horodatage le plus récent (clientCreatedAt prioritaire)", () => {
    const list = [
      msg({ id: "a", createdAt: "2026-08-09T10:00:00.000Z" }),
      msg({ id: "b", createdAt: "2026-08-08T09:00:00.000Z", clientCreatedAt: "2026-08-09T11:30:00.000Z" }),
      msg({ id: "c", createdAt: "2026-08-07T10:00:00.000Z" }),
    ];
    expect(newestActivityTimestamp(list)).toBe("2026-08-09T11:30:00.000Z");
    expect(newestActivityTimestamp([])).toBeNull();
  });

  it("acquitte seulement si PLUS RÉCENT que le dernier acquittement", () => {
    const list = [msg({ createdAt: "2026-08-09T10:00:00.000Z" })];
    // Premier passage : acquitté, horodatage mémorisé.
    expect(shouldMarkReadNow("", list)).toBe("2026-08-09T10:00:00.000Z");
    // Même liste (re-poll, événement en cascade) : SILENCE — fin de la boucle.
    expect(shouldMarkReadNow("2026-08-09T10:00:00.000Z", list)).toBeNull();
    // Nouveau message : acquittement de nouveau légitime.
    const grown = [...list, msg({ id: "m2", createdAt: "2026-08-09T10:05:00.000Z" })];
    expect(shouldMarkReadNow("2026-08-09T10:00:00.000Z", grown)).toBe("2026-08-09T10:05:00.000Z");
  });
});

/* ------------------- régression composant (dock flottant) ------------------- */

const CHANNEL = {
  id: "ch1",
  kind: "team" as const,
  name: "# Général",
  memberIds: ["u1", "u2"],
  createdAt: "2026-08-09T09:00:00.000Z",
};
const MESSAGE = msg({ id: "m1", createdAt: "2026-08-09T10:00:00.000Z" });

// markRead simulé avec le COMPORTEMENT RÉEL qui compte ici : l'événement
// global qui ré-arme instantanément tous les subscribeChat. vi.hoisted car
// ce fichier importe chatService en tête (la factory de mock s'exécute
// pendant l'évaluation des imports).
const h = vi.hoisted(() => ({
  markReadMock: vi.fn(() => {
    window.dispatchEvent(new Event("narchi-chat-read"));
  }),
}));
const markReadMock = h.markReadMock;

vi.mock("@/lib/chatService", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/chatService")>();
  return {
    ...original,
    ensureChannels: vi.fn(async () => {}),
    getChannels: vi.fn(async () => [CHANNEL]),
    getMessages: vi.fn(async () => [MESSAGE]),
    getTeamUsers: vi.fn(async () => []),
    unreadCount: vi.fn(async () => 1),
    markRead: h.markReadMock,
    // subscribeChat = l'ORIGINAL (poller réel piloté par les timers simulés).
  };
});

// Identités STABLES comme en production (AuthStore value est memoïsée,
// Zustand useShallow renvoie la même référence) — sinon le test mesure un
// artefact au lieu de la vraie boucle événementielle §84.
vi.mock("@/store/AuthStore", () => {
  const user = { id: "u1", name: "Halil", email: "halil@buero.de", role: "owner" };
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

describe("§84 — dock de chat : zéro tempête markRead (régression)", () => {
  beforeEach(() => {
    localStorage.clear();
    // §109 : les fenêtres ne sont PLUS restaurées depuis localStorage
    // (démarrage propre demandé par le client) — le test ouvre donc la
    // fenêtre par la VRAIE voie (bus événement openFloatingChat).
    markReadMock.mockClear();
  });

  it(
    "fenêtre ouverte : markRead borné sur 5 s réelles (avant §84 : ~2×/s en continu)",
    async () => {
      const { FloatingChatManager, openFloatingChat } = await import("@/components/FloatingChat");
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      const prev = console.error;
      console.error = (...args: unknown[]) => {
        if (String(args[0] ?? "").includes("act(")) return; // bruit React test env
        prev(...args);
      };
      try {
        await act(async () => {
          root.render(createElement(FloatingChatManager));
        });
        // Laisse le premier refresh charger les canaux, puis ouvre la
        // fenêtre par le bus événement — la condition exacte de la boucle
        // constatée par le client (fenêtre ouverte + messages non lus).
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
        });
        await act(async () => {
          openFloatingChat("ch1");
        });
        // 5 s de VRAI temps (les timers fake bloqueraient act() de React) :
        // avant §84, chaque markRead ré-armait subscribeChat immédiatement
        // → tempête auto-entretenue (~10+ acquittements sur cette fenêtre).
        for (let i = 0; i < 25; i++) {
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
          });
        }
        expect(markReadMock.mock.calls.length).toBeLessThanOrEqual(3);
      } finally {
        console.error = prev;
        try { act(() => root.unmount()); } catch { /* noop */ }
        host.remove();
      }
    },
    25_000,
  );
});
