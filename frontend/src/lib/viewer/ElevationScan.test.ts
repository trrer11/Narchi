/**
 * TEST ANTI-GEL "getGroundFloorElevation" (import IFC en boucle infinie).
 * Reproduit les deux chemins :
 *  1. GetLineIDsWithType disponible => O(nb etages), aucune iteration aveugle.
 *  2. Repli par lots => le thread est cede regulierement (les timers
 *     s'executent PENDANT le scan) et le scan est borne a 20 000 IDs.
 * NOTE : la fonction est interne a RealIfcViewer.tsx ; on teste ici une
 * copie contractuelle du meme algorithme pour verrouiller le comportement.
 */
import { describe, expect, it } from "vitest";

interface FakeVector { size(): number; get(i: number): number; delete?: () => void; }
interface FakeApi {
  GetLineIDsWithType?(modelID: number, type: number): FakeVector;
  GetLine(modelID: number, id: number): { type?: number; Elevation?: number } | null;
}

const STOREY = 42;

/** Copie contractuelle de l'algorithme corrige (chemin rapide + repli par lots). */
async function scan(api: FakeApi): Promise<{ elevation: number | null; getLineCalls: number; yields: number }> {
  let getLineCalls = 0;
  let yields = 0;
  const wrapped: FakeApi = {
    GetLineIDsWithType: api.GetLineIDsWithType?.bind(api),
    GetLine: (m, i) => { getLineCalls++; return api.GetLine(m, i); },
  };

  let closest: number | null = null;
  let minDiff = Infinity;
  const consider = (e: number | null | undefined): boolean => {
    if (typeof e !== "number") return false;
    if (e === 0) { closest = 0; return true; }
    if (Math.abs(e) < minDiff) { minDiff = Math.abs(e); closest = e; }
    return false;
  };

  if (typeof wrapped.GetLineIDsWithType === "function") {
    const ids = wrapped.GetLineIDsWithType(1, STOREY);
    for (let i = 0; i < ids.size(); i++) {
      if (consider(wrapped.GetLine(1, ids.get(i))?.Elevation)) return { elevation: 0, getLineCalls, yields };
    }
    return { elevation: closest, getLineCalls, yields };
  }

  const MAX_SCAN = 20_000, BATCH = 2_000;
  let nullCount = 0;
  for (let start = 1; start < MAX_SCAN; start += BATCH) {
    for (let i = start; i < Math.min(start + BATCH, MAX_SCAN); i++) {
      const entity = wrapped.GetLine(1, i);
      if (!entity) { nullCount++; if (nullCount > 1000) return { elevation: closest, getLineCalls, yields }; continue; }
      nullCount = 0;
      if (entity.type === STOREY && consider(entity.Elevation)) return { elevation: 0, getLineCalls, yields };
    }
    yields++;
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  return { elevation: closest, getLineCalls, yields };
}

describe("Scan d'elevation - anti-gel du thread principal", () => {
  it("chemin rapide : GetLineIDsWithType => O(nb etages), pas 100 000 GetLine", async () => {
    const storeys = [301, 502, 903];
    const api: FakeApi = {
      GetLineIDsWithType: () => ({ size: () => storeys.length, get: (i) => storeys[i] }),
      GetLine: (_m, id) => ({ type: STOREY, Elevation: id === 502 ? 0 : id / 100 }),
    };
    const r = await scan(api);
    expect(r.elevation).toBe(0);
    expect(r.getLineCalls).toBeLessThanOrEqual(storeys.length);
  });

  it("repli : scan borne a 20 000 et cede le thread entre les lots", async () => {
    const api: FakeApi = {
      GetLine: (_m, i) => ({ type: i === 15_000 ? STOREY : 7, Elevation: i === 15_000 ? 2.8 : undefined }),
    };
    const r = await scan(api);
    expect(r.elevation).toBe(2.8);
    expect(r.getLineCalls).toBeLessThanOrEqual(20_000); // BORNE (avant: 100 000)
    expect(r.yields).toBeGreaterThanOrEqual(7);          // le thread a ete cede
  });

  it("repli : fichier vide => sortie rapide via compteur de nulls", async () => {
    const api: FakeApi = { GetLine: () => null };
    const r = await scan(api);
    expect(r.elevation).toBeNull();
    expect(r.getLineCalls).toBeLessThanOrEqual(1100); // sortie apres ~1000 nulls
  });
});
