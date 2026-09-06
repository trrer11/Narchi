/**
 * TEST AXE 3 : G-Set du chat (fusion, dedoublonnage, ordre stable).
 * Verrouille le contrat anti-doublon / anti-inversion chronologique.
 */
import { describe, expect, it } from "vitest";
import { mergeMessages, chatSortKey, type ChatMessage } from "./chatService";

function msg(p: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    channelId: "ch-1", authorId: "u1", authorName: "Anna",
    text: "x", createdAt: "2026-07-07T12:00:00Z", ...p,
  };
}

describe("Axe 3 - G-Set chat (mergeMessages / chatSortKey)", () => {
  it("dedoublonne par clientId : rejeu outbox + trame WS = 1 seule bulle", () => {
    const fromPost = msg({ id: "srv-1", clientId: "c-aaa", clientCreatedAt: "2026-07-07T10:00:00Z" });
    const fromWs   = msg({ id: "srv-1", clientId: "c-aaa", clientCreatedAt: "2026-07-07T10:00:00Z" });
    const merged = mergeMessages([fromPost], [fromWs]);
    expect(merged.length).toBe(1);
  });

  it("le message serveur remplace l optimiste local (id tmp-)", () => {
    const optimistic = msg({ id: "tmp-123", clientId: "c-bbb", text: "brouillon" });
    const persisted  = msg({ id: "srv-9", clientId: "c-bbb", text: "brouillon" });
    const merged = mergeMessages([optimistic], [persisted]);
    expect(merged.length).toBe(1);
    expect(merged[0].id).toBe("srv-9");
  });

  it("ZERO inversion : un message rejoue 40s plus tard garde sa place de SAISIE", () => {
    // Alice tape a 10:00 pendant une coupure ; Bob envoie a 10:00:20 ;
    // l outbox d Alice rejoue a 10:00:40 -> created_at serveur = 10:00:40.
    const alice = msg({ id: "srv-2", clientId: "c-alice",
      clientCreatedAt: "2026-07-07T10:00:00Z", createdAt: "2026-07-07T10:00:40Z" });
    const bob = msg({ id: "srv-1", clientId: "c-bob",
      clientCreatedAt: "2026-07-07T10:00:20Z", createdAt: "2026-07-07T10:00:20Z" });
    // Arrivee dans le "mauvais" ordre (Bob d abord) :
    const merged = mergeMessages([bob], [alice]);
    expect(merged[0].clientId).toBe("c-alice");  // Alice AVANT Bob : ordre de saisie
    expect(merged[1].clientId).toBe("c-bob");
  });

  it("convergence : meme resultat quel que soit l ordre de fusion (propriete CRDT)", () => {
    const a = msg({ id: "s1", clientId: "c1", clientCreatedAt: "2026-07-07T09:00:00Z" });
    const b = msg({ id: "s2", clientId: "c2", clientCreatedAt: "2026-07-07T09:00:01Z" });
    const c = msg({ id: "s3", clientId: "c3", clientCreatedAt: "2026-07-07T09:00:02Z" });
    const left  = mergeMessages(mergeMessages([a], [c]), [b]);
    const right = mergeMessages(mergeMessages([c], [b]), [a]);
    expect(left.map((m) => m.clientId)).toEqual(right.map((m) => m.clientId));
    expect(left.map((m) => m.clientId)).toEqual(["c1", "c2", "c3"]);
  });

  it("compatibilite V3 : messages sans clientId retombent sur (createdAt, id)", () => {
    const legacy = msg({ id: "old-1", createdAt: "2026-07-07T08:00:00Z" });
    const modern = msg({ id: "new-1", clientId: "c9", clientCreatedAt: "2026-07-07T08:00:01Z" });
    const merged = mergeMessages([legacy], [modern]);
    expect(merged.length).toBe(2);
    expect(chatSortKey(legacy) < chatSortKey(modern)).toBe(true);
  });
});
