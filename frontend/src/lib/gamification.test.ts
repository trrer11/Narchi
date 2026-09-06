/** §175 — gamification : getLevel + unlock (XP, niveaux, idempotence). */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { getLevel, unlock, ACHIEVEMENT_DEFS } from "@/lib/gamification";

// localStorage factice (le moteur lit/écrit dedans).
function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

beforeEach(() => {
  const s = memStorage();
  s.clear();
  vi.stubGlobal("localStorage", s);
  vi.stubGlobal("window", { ...window, dispatchEvent: () => {} });
});

describe("getLevel (§175)", () => {
  it("franchit les seuils de niveau", () => {
    expect(getLevel(0).level).toBe(1);
    expect(getLevel(99).level).toBe(1);
    expect(getLevel(100).level).toBe(2);
    expect(getLevel(299).level).toBe(2);
    expect(getLevel(300).level).toBe(3);
    expect(getLevel(1500).level).toBe(5);
  });
  it("dernier niveau → nextXp null, progress 1", () => {
    const top = getLevel(99999);
    expect(top.nextXp).toBeNull();
    expect(top.progress).toBe(1);
  });
});

describe("unlock (§175)", () => {
  it("débloque une fois, ajoute l'XP, et détecte le level-up", () => {
    // 2 succès : first_cost (50 XP) puis streak_3 (100 XP) → 150 XP = niveau 2.
    const r1 = unlock("first_cost");
    expect(r1.newlyUnlocked?.id).toBe("first_cost");
    expect(r1.leveledUp).toBe(false); // 50 XP < 100
    const r2 = unlock("streak_3");
    expect(r2.newlyUnlocked?.id).toBe("streak_3");
    expect(r2.leveledUp).toBe(true); // 150 XP ≥ 100 → niveau 2
  });
  it("idempotent : un succès déjà débloqué ne re-compte pas", () => {
    unlock("first_cost");
    const r2 = unlock("first_cost");
    expect(r2.newlyUnlocked).toBeNull();
    expect(r2.leveledUp).toBe(false);
  });
  it("id inconnu → aucun effet", () => {
    expect(unlock("nimporte")).toEqual({ newlyUnlocked: null, leveledUp: false });
  });
});

describe("catalogue de succès (§175)", () => {
  it("chaque définition a un id unique et un emoji", () => {
    const ids = ACHIEVEMENT_DEFS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ACHIEVEMENT_DEFS) {
      expect(a.emoji.length).toBeGreaterThan(0);
      expect(a.xp).toBeGreaterThan(0);
    }
  });
});
