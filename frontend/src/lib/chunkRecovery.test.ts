import { describe, expect, it } from "vitest";
import { isChunkLoadError, shouldAttemptChunkRecovery } from "./chunkRecovery";

describe("chunk recovery", () => {
  it("reconnaît une erreur de module dynamique obsolète", () => {
    expect(
      isChunkLoadError(
        new TypeError(
          "Failed to fetch dynamically imported module: http://localhost/assets/Dashboard.js",
        ),
      ),
    ).toBe(true);
  });

  it("ne traite pas une erreur métier comme un chunk obsolète", () => {
    expect(isChunkLoadError(new Error("Projet introuvable"))).toBe(false);
  });

  it("bloque toute deuxième actualisation pendant trente secondes", () => {
    expect(shouldAttemptChunkRecovery(0, 10_000)).toBe(true);
    expect(shouldAttemptChunkRecovery(10_000, 10_500)).toBe(false);
    expect(shouldAttemptChunkRecovery(10_000, 40_001)).toBe(true);
  });
});
