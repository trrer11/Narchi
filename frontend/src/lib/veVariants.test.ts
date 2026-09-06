/** §160 — VE-Varianten : figer/comparer des scénarios de substitution. */
import { describe, expect, it } from "vitest";

import {
  compareVEVariants,
  loadVEVariants,
  removeVEVariant,
  saveVEVariant,
  snapshotFromWhatIf,
  VEVARIANT_LIMIT,
  type VEVariant,
} from "@/lib/veVariants";
import {
  buildVEOpportunities,
  computeVEWhatIf,
  substitutionKey,
  takeoffVolumeM3BySubstitution,
} from "@/lib/veEngine";

const summary = {
  byCategory: [
    { categoryId: "stahlbeton", massKg: 50_000 },
    { categoryId: "ziegel", massKg: 36_000 },
  ],
} as never;
const opps = buildVEOpportunities(takeoffVolumeM3BySubstitution(summary), 100_000);

// Un faux Storage en mémoire (testable sans DOM/localStorage).
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

describe("snapshotFromWhatIf (§160)", () => {
  it("fige la sélection et les totaux (aucun chiffre recalculé)", () => {
    const beton = opps.find((o) => o.rec.to.key === "beton_c20_25")!;
    const whatIf = computeVEWhatIf(opps, [substitutionKey(beton.rec)], 100_000, 180);
    const v = snapshotFromWhatIf(whatIf, "Variante B", "EFH", new Date("2026-08-17T10:00:00Z"));
    expect(v.projectName).toBe("EFH");
    expect(v.label).toBe("Variante B");
    expect(v.count).toBe(1);
    expect(v.selectedKeys).toEqual([substitutionKey(beton.rec)]);
    expect(v.totalCo2SavedKg).toBeCloseTo(whatIf.totalCo2SavedKg, 6);
    expect(v.newPerM2Kg).toBeCloseTo(whatIf.newPerM2Kg!, 6);
  });

  it("label vide → nom par défaut (jamais de variante sans nom)", () => {
    const v = snapshotFromWhatIf(computeVEWhatIf(opps, []), "  ", "EFH");
    expect(v.label).toContain("Variante");
  });
});

describe("persistance VE-Varianten (§160)", () => {
  it("sauvegarde, relit, plafonne à VEVARIANT_LIMIT et supprime", () => {
    const storage = memStorage();
    const base = computeVEWhatIf(opps, []);
    for (let i = 1; i <= VEVARIANT_LIMIT + 2; i++) {
      saveVEVariant(snapshotFromWhatIf(base, `V${i}`, "EFH"), storage);
    }
    let list = loadVEVariants(storage);
    expect(list.length).toBe(VEVARIANT_LIMIT); // plafonné
    expect(list[0].label).toBe(`V${VEVARIANT_LIMIT + 2}`); // plus récent d'abord

    // suppression par id
    list = removeVEVariant(list[0].id, storage);
    expect(list.length).toBe(VEVARIANT_LIMIT - 1);
    expect(list.some((v) => v.label === `V${VEVARIANT_LIMIT + 2}`)).toBe(false);
  });

  it("stockage indisponible → lecture vide, sauvegarde sans persistance (jamais d'erreur)", () => {
    expect(loadVEVariants(null)).toEqual([]);
    // La sauvegarde retourne la liste en mémoire (rien n'est persisté, mais
    // le contrat « retourne la liste à jour » tient — comme estimateScenarios).
    const saved = saveVEVariant(snapshotFromWhatIf(computeVEWhatIf(opps, []), "X", "EFH"), null);
    expect(saved.length).toBe(1);
    expect(loadVEVariants(null)).toEqual([]); // toujours rien en persistance
  });

  it("JSON corrompu → liste vide (résilience)", () => {
    const storage = memStorage();
    storage.setItem("narchi:ve-variants", "{pas du json");
    expect(loadVEVariants(storage)).toEqual([]);
  });
});

describe("compareVEVariants (§160)", () => {
  const mk = (label: string, keys: string[], co2: number, eur: number, perM2: number | null): VEVariant => ({
    id: label,
    label,
    savedAt: "2026-08-17",
    projectName: "EFH",
    selectedKeys: keys,
    totalCo2SavedKg: co2,
    totalEurDelta: eur,
    co2SavedPct: null,
    newPerM2Kg: perM2,
    count: keys.length,
  });

  it("calcule le delta entre deux variantes", () => {
    const a = mk("A", ["k1", "k2"], 1000, -500, 480);
    const b = mk("B", ["k2", "k3"], 1400, 200, 460);
    const d = compareVEVariants(a, b);
    expect(d.co2Delta).toBeCloseTo(400); // B économise 400 kg de plus
    expect(d.eurDelta).toBeCloseTo(700); // 200 - (-500)
    expect(d.perM2Delta).toBeCloseTo(-20); // 460 - 480
    expect(d.aOnly).toEqual(["k1"]);
    expect(d.bOnly).toEqual(["k3"]);
  });

  it("variantes identiques → delta nul et aucune substitution différente", () => {
    const a = mk("A", ["k1"], 1000, 100, 500);
    const d = compareVEVariants(a, a);
    expect(d.co2Delta).toBe(0);
    expect(d.eurDelta).toBe(0);
    expect(d.perM2Delta).toBe(0);
    expect(d.aOnly).toEqual([]);
    expect(d.bOnly).toEqual([]);
  });
});
