/** §179 — Mahnwesen : recouvrement (pur, testé). */
import { describe, expect, it } from "vitest";

import {
  ladeZahlungen,
  mahnstufeFuer,
  mahnstatus,
  mahnungText,
  setzeZahlung,
  summeOffen,
  ueberfaelligeRechnungen,
  verzugszins,
  type MahnbareRechnung,
} from "@/lib/mahnwesen";

const NOW = new Date("2026-08-21T12:00:00");

const r = (id: string, due: string | null, brut: string): MahnbareRechnung => ({
  id,
  rechnungsnummer: `RE-${id}`,
  buyer_name: "Familie Meyer",
  buyer_street: "Musterstr. 1",
  buyer_zip: "10115",
  buyer_city: "Berlin",
  total_brut: brut,
  due_date: due,
  issued_at: "2026-07-01",
});

describe("mahnstufeFuer (§179)", () => {
  it("pas échue → null ; puis 1 / 2 / 3", () => {
    expect(mahnstufeFuer(0)).toBeNull();
    expect(mahnstufeFuer(-5)).toBeNull();
    expect(mahnstufeFuer(1)).toBe(1);
    expect(mahnstufeFuer(14)).toBe(1);
    expect(mahnstufeFuer(15)).toBe(2);
    expect(mahnstufeFuer(29)).toBe(2);
    expect(mahnstufeFuer(30)).toBe(3);
    expect(mahnstufeFuer(999)).toBe(3);
  });
});

describe("mahnstatus (§179)", () => {
  it("échue de 20 jours → stufe 2, jours exacts", () => {
    const s = mahnstatus(r("a", "2026-08-01", "1000.00"), {}, NOW);
    expect(s.tageUeberfaellig).toBe(20);
    expect(s.stufe).toBe(2);
    expect(s.betragBrut).toBe(1000);
    expect(s.status).toBe("offen");
  });
  it("payée → jamais échue", () => {
    const s = mahnstatus(r("a", "2026-08-01", "1000.00"), { a: "bezahlt" }, NOW);
    expect(s.status).toBe("bezahlt");
    expect(s.stufe).toBeNull();
    expect(s.tageUeberfaellig).toBe(0);
  });
  it("sans due_date → pas échue", () => {
    const s = mahnstatus(r("b", null, "500.00"), {}, NOW);
    expect(s.stufe).toBeNull();
  });
});

describe("ueberfaelligeRechnungen + summeOffen (§179)", () => {
  it("ne remonte que les impayées échues, triées", () => {
    const list = [
      r("a", "2026-08-01", "1000.00"), // 20 j
      r("b", "2026-08-15", "2000.00"), // 6 j
      r("c", "2026-09-01", "5000.00"), // pas échue
      r("d", "2026-08-10", "3000.00"), // 11 j (payée)
    ];
    const zahlungen = { d: "bezahlt" as const };
    const ueber = ueberfaelligeRechnungen(list, zahlungen, NOW);
    expect(ueber.map((x) => x.rechnung.id)).toEqual(["a", "b"]); // plus en retard d'abord
    expect(summeOffen(ueber)).toBe(3000);
  });
});

describe("verzugszins (§179)", () => {
  it("0 si pas de retard ou montant nul ; sinon proportionnel", () => {
    expect(verzugszins(1000, 0)).toBe(0);
    expect(verzugszins(0, 30)).toBe(0);
    const z = verzugszins(1000, 30); // 1000 * 12.62% * 30/365 ≈ 10.37
    expect(z).toBeGreaterThan(10);
    expect(z).toBeLessThan(11);
  });
});

describe("mahnungText (§179)", () => {
  it("contient stufe, montant, jours, et l'avertissement honnête", () => {
    const s = mahnstatus(r("a", "2026-08-01", "1234.56"), {}, NOW);
    const t = mahnungText(s, NOW);
    expect(t).toContain("2. Mahnung"); // 20 j → stufe 2
    expect(t).toContain("1.234,56 €");
    expect(t).toContain("20 Tage überfällig");
    expect(t).toContain("§ 288 BGB");
    expect(t).toContain("kein Rechtsrat");
  });
});

describe("persistance des paiements (§179)", () => {
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
  it("marque et relit ; stockage absent → jamais d'erreur", () => {
    const s = memStorage();
    expect(ladeZahlungen(s)).toEqual({});
    setzeZahlung("r1", "bezahlt", s);
    expect(ladeZahlungen(s)).toEqual({ r1: "bezahlt" });
    expect(ladeZahlungen(null)).toEqual({});
    setzeZahlung("r2", "offen", null); // pas de crash
  });
});
