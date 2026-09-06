/**
 * §103 — Tests du stockage photos Mängel (mangelPhotos.ts), conservé à la
 * suppression de l'ancienne page « Baustelle » §102 : cette infrastructure
 * IndexedDB reste le socle de la nouvelle page chantier (idée client,
 * §104). Un module gardé garde ses tests — jamais de code nu.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearMangelPhotoMemory,
  listMangelPhotoIds,
  loadMangelPhoto,
  saveMangelPhoto,
  supportsIdb,
  sweepOrphanPhotos,
} from "@/lib/mangelPhotos";

describe("§102/§103 — photos Mangel (IndexedDB → repli mémoire)", () => {
  beforeEach(() => clearMangelPhotoMemory());

  it("sauvegarde et recharge le même contenu", async () => {
    expect(supportsIdb()).toBe(false); // jsdom : repli mémoire épinglé
    const saved = await saveMangelPhoto("mgl-1-foto", new Blob(["px"], { type: "image/jpeg" }));
    expect(saved).toBe(true);
    const blob = await loadMangelPhoto("mgl-1-foto");
    expect(blob).not.toBeNull();
    expect(blob!.size).toBe(2);
    expect(blob!.type).toBe("image/jpeg");
  });

  it("photo inconnue → null, jamais d'erreur ni de Blob vide fabriqué", async () => {
    expect(await loadMangelPhoto("inconnu")).toBeNull();
  });
});

describe("§104 — balayage honnête des orphelines", () => {
  beforeEach(() => clearMangelPhotoMemory());

  it("liste les clés réellement posées", async () => {
    await saveMangelPhoto("foto-a", new Blob(["a"]));
    await saveMangelPhoto("mgl-old-foto", new Blob(["o"]));
    const ids = await listMangelPhotoIds();
    expect(ids.sort()).toEqual(["foto-a", "mgl-old-foto"]);
  });

  it("ne touche QU'aux « foto- » non référencées — jamais aux photos d'Issues", async () => {
    await saveMangelPhoto("foto-gardee", new Blob(["g"]));
    await saveMangelPhoto("foto-orpheline", new Blob(["o"]));
    await saveMangelPhoto("mgl-ancien-foto", new Blob(["h"])); // autre préfixe : intouchable
    const removed = await sweepOrphanPhotos(new Set(["foto-gardee"]), "foto-");
    expect(removed).toBe(1);
    expect(await loadMangelPhoto("foto-gardee")).not.toBeNull();
    expect(await loadMangelPhoto("foto-orpheline")).toBeNull();
    expect(await loadMangelPhoto("mgl-ancien-foto")).not.toBeNull();
    // Deuxième passage : plus rien à balayer (idempotent, pas d'erreur).
    expect(await sweepOrphanPhotos(new Set(["foto-gardee"]), "foto-")).toBe(0);
  });
});
