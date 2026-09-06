/**
 * §81 — tests des helpers purs CRDT : delta de frappe (avec umlauts/emojis,
 * le quotidien allemand), URL same-origin, pastilles de présence.
 * La convergence RÉELLE A↔B est prouvée côté backend (pycrdt↔pycrdt) —
 * ici on verrouille le contrat que le navigateur applique au serveur.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyTextDelta,
  buildCollabWsBase,
  cursorLineCol,
  NOTIZ_ROOM,
  peersFromStates,
  peerChipLabel,
  peerChipText,
  restoreResultOf,
  snapshotOf,
  textDelta,
} from "./collabDoc";

describe("buildCollabWsBase", () => {
  it("http → ws, https → wss, même origine, chemin gravé", () => {
    expect(buildCollabWsBase({ protocol: "http:", host: "localhost:8080" })).toBe(
      "ws://localhost:8080/api/v5/collab/ws",
    );
    expect(buildCollabWsBase({ protocol: "https:", host: "app.example.de" })).toBe(
      "wss://app.example.de/api/v5/collab/ws",
    );
    expect(NOTIZ_ROOM).toBe("notiz-buero");
  });
});

describe("textDelta", () => {
  it("identique → null ; ajout en fin", () => {
    expect(textDelta("abc", "abc")).toBeNull();
    expect(textDelta("abc", "abcd")).toEqual({ index: 3, deleteLen: 0, insert: "d" });
  });
  it("insertion au milieu, umlauts et suppression", () => {
    // « straße » → « große Straße » : le S majuscule impose un remplacement
    // (s↦…S), le delta minimal calcule exactement ça — prévisible et juste.
    expect(textDelta("Müllerstraße", "Müller große Straße")).toEqual({
      index: 6,
      deleteLen: 1,
      insert: " große S",
    });
    expect(textDelta("Büroarbeit", "Büro")).toEqual({
      index: 4,
      deleteLen: 6,
      insert: "",
    });
  });
  it("remplacement en tête", () => {
    expect(textDelta("ABCdef", "XYZdef")).toEqual({ index: 0, deleteLen: 3, insert: "XYZ" });
  });
  it("emoji : les unités UTF-16 de Yjs sont respectées (pas de paire coupée)", () => {
    // « 🏗️ » tient sur plusieurs unités UTF-16 : le préfixe commun protège.
    expect(textDelta("🏗️bau", "🏗️bau!")).toEqual({
      index: "🏗️bau".length,
      deleteLen: 0,
      insert: "!",
    });
  });
});

describe("applyTextDelta (vraie réplique Yjs)", () => {
  it("une transaction minimale converge exactement comme le serveur", () => {
    const doc = new Y.Doc();
    const ytext = doc.getText("notiz");
    doc.transact(() => ytext.insert(0, "Straße"));
    applyTextDelta(doc, ytext, textDelta("Straße", "Alle Straße")!);
    expect(ytext.toString()).toBe("Alle Straße");
    applyTextDelta(doc, ytext, textDelta("Alle Straße", "Allee")!);
    expect(ytext.toString()).toBe("Allee");
  });
});

describe("peersFromStates", () => {
  it("soi exclu, doublons fusionnés, tape… prioritaire, tri allemand", () => {
    const states = [
      { user: { name: "Ich", color: "#111", typing: true } },       // soi-même
      { user: { name: "Özlem", color: "#222", typing: false } },
      { user: { name: "Anna", color: "#333", typing: false } },
      { user: { name: "Anna", color: "#333", typing: true } },      // 2e onglet
      { user: { color: "#999" } },                                   // sans nom
      {},
    ];
    const peers = peersFromStates(states, "Ich");
    expect(peers.map((p) => p.name)).toEqual(["Anna", "Özlem"]);
    expect(peers[0].typing).toBe(true);
    expect(peers[1].color).toBe("#222");
  });
});

describe("peerChipLabel", () => {
  it("libellés exacts, allemand honnête", () => {
    expect(peerChipLabel(0)).toBe("Nur Sie hier");
    expect(peerChipLabel(1)).toBe("1 Kollege live");
    expect(peerChipLabel(3)).toBe("3 Kollegen live");
  });
});

/* ------------------------------- §86 ---------------------------------- */

describe("§86 — cursorLineCol (ligne réelle, pas d'affichage décoratif)", () => {
  it("texte mono-ligne : ligne 1, colonne bornée au texte", () => {
    expect(cursorLineCol("Hallo", 0)).toEqual({ line: 1, column: 1 });
    expect(cursorLineCol("Hallo", 3)).toEqual({ line: 1, column: 4 });
    expect(cursorLineCol("Hallo", 999)).toEqual({ line: 1, column: 6 }); // borné
  });
  it("multi-lignes : le saut « \\n » fait basculer la ligne", () => {
    const text = "Zeile 1\nZeile 2\nEnde";
    expect(cursorLineCol(text, 7)).toEqual({ line: 1, column: 8 });
    expect(cursorLineCol(text, 8)).toEqual({ line: 2, column: 1 });
    expect(cursorLineCol(text, 19)).toEqual({ line: 3, column: 4 });
  });
});

describe("§86 — pastilles pairs : curseur transporté, tippt prioritaire", () => {
  it("le curseur du pair arrive entier ; forfaits hostiles exclus", () => {
    const peers = peersFromStates(
      [
        { user: { name: "Anna", color: "#111", typing: false, cursor: 42 } },
        { user: { name: "Anna", typing: true, cursor: 7 } },      // 2e onglet
        { user: { name: "Max", cursor: -3 } },                    // hostile → null
        { user: { name: "Ich", cursor: 5 } },                     // soi → exclu
      ],
      "Ich",
    );
    expect(peers).toHaveLength(2);
    expect(peers[0].name).toBe("Anna");
    expect(peers[0].typing).toBe(true);   // fusion « tape… » gagne (§81)
    expect(peers[0].cursor).toBe(7);      // le curseur le plus RÉCENT gagne
                                          // (2e onglet — l'état awareness le plus frais)
    expect(peers[1]).toEqual({ name: "Max", color: "#64748b", typing: false, cursor: null });
  });

  it("peerChipText : tippt… > Z. n > nom seul (aucune info inventée)", () => {
    const text = "Zeile 1\nZeile 2";
    expect(peerChipText({ name: "Anna", color: "#111", typing: true, cursor: 3 }, text))
      .toBe("Anna · tippt…");
    expect(peerChipText({ name: "Anna", color: "#111", typing: false, cursor: 8 }, text))
      .toBe("Anna · Z. 2");
    expect(peerChipText({ name: "Anna", color: "#111", typing: false, cursor: null }, text))
      .toBe("Anna");
  });
});

describe("§86 — mappers snapshots (aucune donnée aveugle affichée)", () => {
  it("snapshotOf : ligne serveur valide transformée, hostile → null", () => {
    const good = snapshotOf({
      id: "ab12", created_at: "2026-08-09T10:00:00Z", trigger: "auto",
      label: null, created_by_name: null, bytes: 512, chars: 87, preview: "Protokoll…",
    });
    expect(good).toEqual({
      id: "ab12", createdAt: "2026-08-09T10:00:00Z", trigger: "auto",
      label: null, createdByName: null, bytes: 512, chars: 87, preview: "Protokoll…",
    });
    expect(snapshotOf({ id: 1, created_at: null, trigger: "hack" })).toBeNull();
    expect(snapshotOf("pas un objet")).toBeNull();
  });
  it("restoreResultOf : verrouille les deux modes honnêtes", () => {
    expect(restoreResultOf({ mode: "live", changed: true })).toEqual({ mode: "live", changed: true });
    expect(restoreResultOf({ mode: "stored", changed: false })).toEqual({ mode: "stored", changed: false });
    expect(restoreResultOf({ mode: "magic", changed: true })).toBeNull();
    expect(restoreResultOf(null)).toBeNull();
  });
});
