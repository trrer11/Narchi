/**
 * levelSort — l'ordre « bureau d'architecture » de TOUTES les listes :
 * niveau d'abord (cave → toit), puis alphabétique naturel allemand.
 */
import { describe, expect, it } from "vitest";
import { compareAlpha, compareByLevelThenName, levelKey, sortByLevelName } from "@/lib/levelSort";

describe("levelKey — rangs bas → haut", () => {
  it("caves < rez-de-chaussée < étages < inconnus < toiture", () => {
    expect(levelKey("2. UG").rank).toBeLessThan(levelKey("1. UG").rank);
    expect(levelKey("1. UG").rank).toBeLessThan(levelKey("EG").rank);
    expect(levelKey("EG").rank).toBeLessThan(levelKey("1. OG").rank);
    expect(levelKey("1. OG").rank).toBeLessThan(levelKey("13. OG").rank);
    expect(levelKey("13. OG").rank).toBeLessThan(levelKey("Fancy Tower").rank);
    expect(levelKey("Fancy Tower").rank).toBeLessThan(levelKey("Dach").rank);
  });

  it("alias allemands et IFC : KG, Keller, Niveau -1, Level 2, OG1, 2UG", () => {
    expect(levelKey("KG").rank).toBe(levelKey("1. UG").rank);
    expect(levelKey("Keller").rank).toBeLessThan(levelKey("EG").rank);
    expect(levelKey("Niveau -1").rank).toBe(levelKey("1. UG").rank);
    expect(levelKey("Niveau -2").rank).toBeLessThan(levelKey("Niveau -1").rank);
    expect(levelKey("Level 2").rank).toBe(levelKey("2. OG").rank);
    expect(levelKey("Ebene 3").rank).toBe(levelKey("3. OG").rank);
    expect(levelKey("OG1").rank).toBe(levelKey("1. OG").rank);
    expect(levelKey("2UG").rank).toBe(levelKey("2. UG").rank);
    expect(levelKey("3").rank).toBe(levelKey("3. OG").rank);
  });

  it("libellés normalisés pour regroupement", () => {
    expect(levelKey("  1.ug ").label).toBe("1. UG");
    expect(levelKey("ohbengobi").label).toBe("ohbengobi");
    expect(levelKey("").rank).toBe(500);
    expect(levelKey(null).rank).toBe(500);
  });
});

describe("compareByLevelThenName — niveau puis alphabétique naturel", () => {
  it("« OG 2 » avant « OG 10 » (numérique naturel, pas lexicographique)", () => {
    expect(compareByLevelThenName("2. OG", "Wand A", "10. OG", "Wand A")).toBeLessThan(0);
  });

  it("à niveau égal : alphabétique sur le nom (a < b, accents tolérés)", () => {
    expect(compareByLevelThenName("EG", "Aufzug", "EG", "Brandschutztür")).toBeLessThan(0);
    expect(compareByLevelThenName("EG", "Äußere Wand", "EG", "Boden")).toBeLessThan(0);
  });

  it("liste complète dans l'ordre bureau : cave → EG → étages → Dach", () => {
    const rows = [
      { level: "Dach", name: "Dachhaut" },
      { level: "1. OG", name: "Zimmerdecke" },
      { level: "EG", name: "Fundament" },
      { level: "2. UG", name: "Tiefgarage" },
      { level: "1. UG", name: "Lager" },
      { level: "EG", name: "Atrium" },
      { level: "1. OG", name: "Balkon" },
    ];
    const sorted = sortByLevelName(rows, (r) => r.level, (r) => r.name);
    expect(sorted.map((r) => `${r.level}|${r.name}`)).toEqual([
      "2. UG|Tiefgarage",
      "1. UG|Lager",
      "EG|Atrium",
      "EG|Fundament",
      "1. OG|Balkon",
      "1. OG|Zimmerdecke",
      "Dach|Dachhaut",
    ]);
  });

  it("stabilité : l'ordre d'entrée est conservé en cas d'égalité parfaite", () => {
    const rows = [
      { level: "EG", name: "A", tag: 1 },
      { level: "EG", name: "A", tag: 2 },
    ];
    expect(sortByLevelName(rows, (r) => r.level, (r) => r.name).map((r) => r.tag)).toEqual([1, 2]);
  });

  it("compareAlpha : ordre alphabétique isolé pour listes sans niveau", () => {
    expect(compareAlpha("Beton C30/37", "Stahl S355")).toBeLessThan(0);
    expect(["c", "Ä", "b"].sort(compareAlpha)).toEqual(["Ä", "b", "c"]);
  });
});
