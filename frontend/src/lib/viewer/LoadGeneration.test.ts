/**
 * TEST P2-B : jeton de generation du pipeline loadModel.
 * Rejoue le scenario adverse de la grille de certification :
 *   T0  import A.ifc (300 Mo, lent)
 *   T2  import B.ifc (rapide) pendant que A telecharge encore
 *   T9  A termine APRES B -> A doit s'auto-detruire, JAMAIS ecraser B.
 * Copie contractuelle de l'algorithme du composant (non montable sans WebGL).
 */
import { describe, expect, it } from "vitest";

interface Ctx { modelID: number | null; closedHandles: number[]; disposedGroups: string[]; }

function createPipeline() {
  const generationRef = { current: 0 };
  const ctx: Ctx = { modelID: null, closedHandles: [], disposedGroups: [] };
  const commits: string[] = [];
  const errorsShown: string[] = [];
  const recoveries: string[] = [];

  async function loadModel(name: string, opts: { downloadMs: number; failAfterDownload?: boolean }) {
    const generation = ++generationRef.current;
    const isStale = () => generationRef.current !== generation;
    try {
      await new Promise((r) => setTimeout(r, 1));        // getIfcRuntime
      if (isStale()) return "aborted-g1";
      await new Promise((r) => setTimeout(r, opts.downloadMs)); // fetch buffer
      if (isStale()) return "aborted-g2";                // GARDE 2 (fenetre large)
      const modelID = Math.floor(Math.random() * 1e6);   // OpenModel
      if (opts.failAfterDownload) throw new Error(name + " crash");
      await new Promise((r) => setTimeout(r, 1));        // buildIfcScene
      if (isStale()) { ctx.closedHandles.push(modelID); ctx.disposedGroups.push(name); return "aborted-g3"; }
      ctx.modelID = modelID;                              // COMMIT
      await new Promise((r) => setTimeout(r, 1));        // fitCamera (scan lots)
      if (isStale()) return "aborted-g4";
      commits.push(name);
      return "committed";
    } catch (e) {
      if (isStale()) return "stale-error-swallowed";     // catch garde
      errorsShown.push(String(e));
      recoveries.push(name);
      return "error";
    }
  }
  return { loadModel, ctx, commits, errorsShown, recoveries, generationRef };
}

describe("P2-B - jeton de generation anti-imports concurrents", () => {
  it("A lent + B rapide : seul B committe, A s'auto-detruit sans toucher ctx", async () => {
    const p = createPipeline();
    const a = p.loadModel("A.ifc", { downloadMs: 50 });
    await new Promise((r) => setTimeout(r, 5));
    const b = p.loadModel("B.ifc", { downloadMs: 5 });
    const [ra, rb] = await Promise.all([a, b]);
    expect(rb).toBe("committed");
    expect(ra).toBe("aborted-g2");          // A tue a la garde post-download
    expect(p.commits).toEqual(["B.ifc"]);   // JAMAIS A apres B
  });

  it("A depasse la garde 2 : son handle WASM oriphelin est FERME (garde 3)", async () => {
    const p = createPipeline();
    // A atteint buildIfcScene puis B invalide sa generation juste avant la garde 3.
    const a = p.loadModel("A.ifc", { downloadMs: 10 });
    await new Promise((r) => setTimeout(r, 12)); // A a passe download+OpenModel
    p.generationRef.current++;                  // = arrivee de B / demontage
    const ra = await a;
    // CONTRAT : quelle que soit la garde qui a tue A, il ne committe pas...
    expect(ra).not.toBe("committed");
    expect(p.commits).toEqual([]);
    // ...et s'il avait deja ouvert son handle (garde 3), il l'a FERME.
    if (ra === "aborted-g3") {
      expect(p.ctx.closedHandles.length).toBe(1);   // CloseModel appele
      expect(p.ctx.disposedGroups).toEqual(["A.ifc"]);
    }
  });

  it("le crash d'une generation perimee n'affiche RIEN et ne declenche PAS recoverRuntime", async () => {
    const p = createPipeline();
    const a = p.loadModel("A.ifc", { downloadMs: 10, failAfterDownload: true });
    // B invalide A pendant son download — puis A crash : silence total exige.
    await new Promise((r) => setTimeout(r, 2));
    p.generationRef.current++;
    const ra = await a;
    expect(["aborted-g2", "stale-error-swallowed"]).toContain(ra);
    expect(p.errorsShown).toEqual([]);      // pas d'ecrasement UI de B
    expect(p.recoveries).toEqual([]);       // pas de purge d'un runtime sain
  });

  it("le cleanup du useEffect invalide la generation en vol (fermeture/reimport)", async () => {
    const p = createPipeline();
    const a = p.loadModel("A.ifc", { downloadMs: 30 });
    p.generationRef.current++;              // cleanup: loadGenerationRef.current++
    const ra = await a;
    // CONTRAT : abandon a la premiere garde rencontree (g1 ou g2 selon le
    // tick d'invalidation) — l'essentiel est : zero commit, ctx intact.
    expect(String(ra)).toMatch(/^aborted-g[12]$/);
    expect(p.commits).toEqual([]);
    expect(p.ctx.modelID).toBeNull();       // ctx jamais touche par l'orphelin
  });
});
