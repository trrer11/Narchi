/** §163 — la synchro VE-Varianten (conversions + fusion) est éprouvée. */
import { describe, expect, it } from "vitest";

import {
  reconcileVEVariants,
  remoteToVariant,
  variantToItem,
} from "@/lib/veVariantSync";
import type { VEVariant } from "@/lib/veVariants";

const mk = (id: string, savedAt: string, label = `V${id}`): VEVariant => ({
  id,
  label,
  savedAt,
  projectName: "EFH",
  selectedKeys: [`${id}->clt`],
  totalCo2SavedKg: 100,
  totalEurDelta: 50,
  co2SavedPct: null,
  newPerM2Kg: 480,
  count: 1,
});

describe("variantToItem / remoteToVariant (§163)", () => {
  it("aller-retour fidèle (aucune perte)", () => {
    const v = mk("ve-1", "2026-08-17T10:00:00.000Z", "Holzbau");
    const item = variantToItem(v);
    expect(item.name).toBe("Holzbau");
    expect(item.payload.selectedKeys).toEqual(["ve-1->clt"]);
    const back = remoteToVariant({
      id: item.id,
      name: item.name,
      payload: item.payload,
      created_by: "arch-1",
      created_at: null,
      updated_at: item.updated_at,
      deleted_at: null,
    });
    expect(back).toEqual(v);
  });

  it("payload corrompu → reconstruction tolérante (jamais de crash)", () => {
    const r = remoteToVariant({
      id: "ve-x",
      name: "X",
      payload: { selectedKeys: [1, "a->b"], totalCo2SavedKg: "pas un nombre" },
      created_by: "a",
      created_at: null,
      updated_at: "2026-08-17T10:00:00.000Z",
      deleted_at: null,
    });
    expect(r.selectedKeys).toEqual(["a->b"]); // les non-textes sont filtrés
    expect(r.totalCo2SavedKg).toBe(0);
    expect(r.newPerM2Kg).toBeNull();
  });
});

describe("reconcileVEVariants (§163)", () => {
  it("union + LWW par id (le plus récent gagne)", () => {
    const local = [mk("ve-1", "2026-08-17T12:00:00Z"), mk("ve-2", "2026-08-17T09:00:00Z")];
    const remote = [mk("ve-2", "2026-08-17T10:00:00Z"), mk("ve-3", "2026-08-17T08:00:00Z")];
    const merged = reconcileVEVariants(local, remote);
    expect(merged.map((v) => v.id).sort()).toEqual(["ve-1", "ve-2", "ve-3"]);
    // ve-2 : local (09:00) vs remote (10:00) → remote gagne.
    expect(merged.find((v) => v.id === "ve-2")!.label).toBe("Vve-2");
    // ve-1 : seulement local, conservé.
    expect(merged.find((v) => v.id === "ve-1")).toBeTruthy();
  });

  it("local plus récent → conservé (il re-poussera)", () => {
    const local = [mk("ve-1", "2026-08-17T12:00:00Z")];
    const remote = [mk("ve-1", "2026-08-17T10:00:00Z")];
    const merged = reconcileVEVariants(local, remote);
    expect(merged[0].savedAt).toBe("2026-08-17T12:00:00Z");
  });

  it("tri : plus récent d'abord", () => {
    const merged = reconcileVEVariants(
      [mk("a", "2026-08-17T08:00:00Z")],
      [mk("b", "2026-08-17T10:00:00Z")],
    );
    expect(merged[0].id).toBe("b");
  });
});
