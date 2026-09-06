/**
 * §109 — ansicht.ts : la densité est UN réglage d'INTERFACE (plus un
 * widget de page), avec reprise honnête de l'ancienne clé §107.
 */
import { describe, expect, it } from "vitest";
import {
  ANSICHT_LEVELS,
  ANSICHT_KEY,
  DEFAULT_ANSICHT,
  LEGACY_ANSICHT_KEY,
  isAnsichtLevel,
  readAnsicht,
  saveAnsicht,
  type StorageLike,
} from "@/lib/ansicht";

function memStorage(initial: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe("§109 — densité d'interface (Ansicht)", () => {
  it("défaut 70 % sans réglage mémorisé (la demande « −30 % » du client)", () => {
    expect(DEFAULT_ANSICHT).toBe(0.7);
    expect(readAnsicht(memStorage())).toBe(0.7);
  });

  it("trois niveaux SEULEMENT : 70 / 85 / 100 %", () => {
    expect([...ANSICHT_LEVELS]).toEqual([0.7, 0.85, 1]);
    expect(isAnsichtLevel(0.7)).toBe(true);
    expect(isAnsichtLevel(0.85)).toBe(true);
    expect(isAnsichtLevel(1)).toBe(true);
    expect(isAnsichtLevel(0.5)).toBe(false);
    expect(isAnsichtLevel(1.25)).toBe(false);
  });

  it("reprend l'ancienne clé page-Baustelle une fois (le réglage §107 n'est pas perdu)…", () => {
    expect(readAnsicht(memStorage({ [LEGACY_ANSICHT_KEY]: "0.85" }))).toBe(0.85);
  });

  it("…puis un nouveau choix fait OUBLIER l'ancienne clé (une seule vérité)", () => {
    const storage = memStorage({ [LEGACY_ANSICHT_KEY]: "0.85" });
    saveAnsicht(storage, 1);
    expect(readAnsicht(storage)).toBe(1);
    expect(storage.getItem(LEGACY_ANSICHT_KEY)).toBeNull();
    // Repartir d'un stockage neuf avec la seule nouvelle clé : même valeur.
    expect(readAnsicht(memStorage({ [ANSICHT_KEY]: "1" }))).toBe(1);
  });

  it("valeur stockée invalide → défaut, jamais de zoom fantasme", () => {
    expect(readAnsicht(memStorage({ [ANSICHT_KEY]: "0.42" }))).toBe(0.7);
    expect(readAnsicht(memStorage({ [ANSICHT_KEY]: "abc" }))).toBe(0.7);
    // La nouvelle clé invalide ne masque pas une vieille clé saine —
    // l'ancienne reprise n'a lieu que si la nouvelle est ABSENTE :
    expect(readAnsicht(memStorage({ [ANSICHT_KEY]: "0.42", [LEGACY_ANSICHT_KEY]: "1" }))).toBe(0.7);
  });
});
