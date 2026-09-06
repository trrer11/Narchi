/** §78 — helpers purs de présence/verrous (validation réelle : serveur Redis). */
import { describe, expect, it } from "vitest";
import { formatExpires, initialsOf, lockBanner, presenceSummary, type LockInfo } from "./collab";

describe("collab — helpers purs (§78)", () => {
  it("TEST-078-A : formatExpires arrondit au PLAFOND — jamais moins que la vérité", () => {
    expect(formatExpires(900)).toBe("ca. 15 Min.");
    expect(formatExpires(61)).toBe("ca. 2 Min.");   // 1 min 01 → « 2 Min. », honnête
    expect(formatExpires(60)).toBe("ca. 1 Min.");
    expect(formatExpires(59)).toBe("unter 1 Minute");
    expect(formatExpires(0)).toBe("unter 1 Minute");
  });

  it("TEST-078-B : lockBanner nomme le collègue, la cible et dit « weiches Schloss »", () => {
    const lock: LockInfo = {
      target: "preisbibliothek-import", owner_id: "u2", owner_name: "Ben",
      since: "2026-08-09T12:00:00+00:00", expires_in_s: 840,
    };
    const text = lockBanner(lock);
    expect(text).toContain("Ben");
    expect(text).toContain("preisbibliothek-import");
    expect(text).toContain("14 Min.");
    expect(text).toContain("Weiches Schloss");      // la sémantique DOUCE est affichée
  });

  it("TEST-078-C : presenceSummary exact (soi-même inclus) + initiales", () => {
    expect(presenceSummary(1)).toBe("Nur du online");
    expect(presenceSummary(2)).toBe("Du + 1 Kollege");
    expect(presenceSummary(4)).toBe("Du + 3 Kollegen");
    expect(initialsOf("Anna Chef")).toBe("AC");
    expect(initialsOf("madonna")).toBe("M");
    expect(initialsOf("Hans Peter Meier")).toBe("HP");
  });

  it("TEST-078-D : aucune chaîne CJK dans les libellés générés", () => {
    const all = [
      lockBanner({ target: "t", owner_id: "u", owner_name: "Ben", since: "", expires_in_s: 65 }),
      presenceSummary(3),
      initialsOf("Anna Chef"),
      formatExpires(30),
    ].join(" ");
    expect(all).not.toMatch(/[\u4e00-\u9fff\u3040-\u30ff]/);
  });
});
