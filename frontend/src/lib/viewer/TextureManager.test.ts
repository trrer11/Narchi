/**
 * TEST ANTI-REGRESSION "Chargement de la geometrie IFC reelle..." infini.
 * Cause : pipeline KTX2 sans transcodeur Basis ni textures PBR sur le
 * serveur -> promesses suspendues -> setLoading(false) jamais atteint.
 * Le circuit-breaker doit : (1) sonder le transcodeur UNE fois,
 * (2) ne JAMAIS retenter un chemin en echec, (3) toujours resoudre vite.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { TextureManager } from "./TextureManager";

function fakeRenderer(): THREE.WebGLRenderer {
  const fake = {
    capabilities: { getMaxAnisotropy: () => 4, isWebGL2: true },
    extensions: { has: () => false },
  };
  return fake as unknown as THREE.WebGLRenderer;
}

describe("TextureManager - circuit-breaker KTX2", () => {
  beforeEach(() => {
    // Reinitialise l'etat statique du breaker entre les tests.
    const tm = TextureManager as unknown as {
      failedPaths: Set<string>;
      transcoderState: string;
      transcoderProbe: Promise<boolean> | null;
      instance: TextureManager | undefined;
    };
    tm.failedPaths.clear();
    tm.transcoderState = "unknown";
    tm.transcoderProbe = null;
  });

  it("resout en < 1s avec transcodeur absent (plus de chargement infini)", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const manager = TextureManager.getInstance(fakeRenderer());
    const started = Date.now();
    const result = await manager.loadPBRSet({
      albedo: "/textures/pbr/walls_albedo.ktx2",
      normal: "/textures/pbr/walls_normal.ktx2",
      roughness: "/textures/pbr/walls_rough.ktx2",
      metalness: "/textures/pbr/walls_metal.ktx2",
    });

    expect(Date.now() - started).toBeLessThan(1000);
    // Aucune texture -> le materiau retombera sur la couleur IFC native.
    expect(result.albedo).toBeUndefined();
    expect(result.normal).toBeUndefined();
    // Une SEULE requete : la sonde du transcodeur. Zero requete texture.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCallUrl = String((fetchMock.mock.calls as unknown as [RequestInfo | URL][])[0]?.[0] ?? "");
    expect(firstCallUrl).toContain("/ifc/basis/");
    vi.unstubAllGlobals();
  });

  it("ne re-sonde JAMAIS le transcodeur sur les geometries suivantes", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const manager = TextureManager.getInstance(fakeRenderer());
    // Simule 50 geometries dedupliquees chargeant chacune son set PBR.
    for (let i = 0; i < 50; i++) {
      await manager.loadPBRSet({ albedo: `/textures/pbr/layer${i % 7}_albedo.ktx2` });
    }
    // 1 seule sonde pour 50 sets : le breaker global court-circuite tout.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("marque un chemin 404 en echec definitif (zero nouvelle requete)", async () => {
    // Transcodeur OK, mais texture absente.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/ifc/basis/")
        ? new Response(null, { status: 200 })
        : new Response(null, { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const manager = TextureManager.getInstance(fakeRenderer());
    await manager.loadPBRSet({ albedo: "/textures/pbr/slabs_albedo.ktx2" });
    const callsAfterFirst = fetchMock.mock.calls.length; // sonde + 1 HEAD texture

    await manager.loadPBRSet({ albedo: "/textures/pbr/slabs_albedo.ktx2" });
    await manager.loadPBRSet({ albedo: "/textures/pbr/slabs_albedo.ktx2" });
    // Chemin en echec => AUCUNE requete supplementaire.
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
    vi.unstubAllGlobals();
  });
});
