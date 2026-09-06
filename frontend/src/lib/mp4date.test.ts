/**
 * §110 — mp4date : la date de tournage d'une vidéo est lue dans la boîte
 * mvhd du conteneur (octets fabriqués à la main ici, zéro fichier
 * d'exemple), avec refus nets des faux positifs — puis replis nom/date
 * HONNÊTEMENT étiquetés, exactement comme les photos.
 */
import { describe, expect, it } from "vitest";
import { findMvhdDate, videoTakenAt } from "@/lib/mp4date";

const MP4_EPOCH = 2_082_844_800;
/** 01.08.2026 09:12:00 UTC — instant fixe, parlant. */
const SHOT_UTC_MS = Date.UTC(2026, 7, 1, 9, 12, 0);

function u32be(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function box(type: string, payload: number[]): number[] {
  return [
    ...u32be(8 + payload.length),
    ...type.split("").map((char) => char.charCodeAt(0)),
    ...payload,
  ];
}

/** mvhd version 0 : version+flags, creation u32, modification, timescale, duration. */
function mvhdV0(creationS: number): number[] {
  const payload = [0, 0, 0, 0, ...u32be(creationS), ...u32be(creationS), ...u32be(1000), ...u32be(0)];
  return box("mvhd", payload);
}

/** mvhd version 1 : champs 64 bits, comme le font certains exporteurs. */
function mvhdV1(creationS: number): number[] {
  const big = BigInt(creationS);
  const u64 = Array.from({ length: 8 }, (_, i) => Number((big >> BigInt((7 - i) * 8)) & 255n));
  const payload = [1, 0, 0, 0, ...u64, ...u64, ...u32be(1000), ...u32be(0)];
  return box("mvhd", payload);
}

function mp4Bytes(creationS: number, version: 0 | 1 = 0): Uint8Array<ArrayBuffer> {
  const ftyp = box("ftyp", [...("isom".split("").map((c) => c.charCodeAt(0))), ...u32be(0), ...("isom".split("").map((c) => c.charCodeAt(0)))]);
  const moov = box("moov", version === 0 ? mvhdV0(creationS) : mvhdV1(creationS));
  return new Uint8Array([...ftyp, ...moov]);
}

describe("§110 — findMvhdDate (octets fabriqués au test)", () => {
  it("lit la date de tournage d'un MP4 v0 (moov en tête)", () => {
    const bytes = mp4Bytes(Math.floor(SHOT_UTC_MS / 1000) + MP4_EPOCH);
    expect(findMvhdDate(bytes)?.getTime()).toBe(SHOT_UTC_MS);
  });

  it("lit aussi la variante v1 64 bits", () => {
    const bytes = mp4Bytes(Math.floor(SHOT_UTC_MS / 1000) + MP4_EPOCH, 1);
    expect(findMvhdDate(bytes)?.getTime()).toBe(SHOT_UTC_MS);
  });

  it("un faux motif « mvhd » ne fabrique pas de date (version inconnue, date hors 1990…2100)", () => {
    const bogusVersion = mvhdV0(0);
    bogusVersion[8] = 9; // version 9 : inconnue → refus
    expect(findMvhdDate(new Uint8Array(bogusVersion))).toBeNull();
    expect(findMvhdDate(new Uint8Array(mvhdV0(0)))).toBeNull(); // an 1904 : hors bornes
    expect(findMvhdDate(new Uint8Array(mvhdV0(MP4_EPOCH * 3)))).toBeNull(); // an 2102 : hors bornes
    expect(findMvhdDate(new Uint8Array([1, 2, 3, 4]))).toBeNull(); // tronqué
  });
});

describe("§110 — videoTakenAt (chaîne de vérité : mvhd > nom > date fichier)", () => {
  it("mvhd en TÊTE : source « video-meta »", async () => {
    const file = new File([mp4Bytes(Math.floor(SHOT_UTC_MS / 1000) + MP4_EPOCH)], "clip.mp4", { type: "video/mp4" });
    const dating = await videoTakenAt(file);
    expect(dating.source).toBe("video-meta");
    expect(dating.takenAt.getTime()).toBe(SHOT_UTC_MS);
  });

  it("moov en FIN de fichier (> sonde 256 Kio) : retrouvée par la sonde de queue", async () => {
    const padding = new Uint8Array(300_000); // vide, comme un long flux vidéo
    const tail = mp4Bytes(Math.floor(SHOT_UTC_MS / 1000) + MP4_EPOCH);
    const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(padding.length + tail.length);
    bytes.set(padding, 0);
    bytes.set(tail, padding.length);
    const file = new File([bytes], "clip.mp4", { type: "video/mp4" });
    const dating = await videoTakenAt(file);
    expect(dating.source).toBe("video-meta");
    expect(dating.takenAt.getTime()).toBe(SHOT_UTC_MS);
  });

  it("sans mvhd (WebM) : le NOM horodaté du téléphone est utilisé, source dite", async () => {
    const ebml: Uint8Array<ArrayBuffer> = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
    const file = new File([ebml], "VID_20260801_091200.webm", { type: "video/webm" });
    const dating = await videoTakenAt(file);
    expect(dating.source).toBe("fichier-nom");
    expect(dating.takenAt.getFullYear()).toBe(2026);
    expect(dating.takenAt.getMonth()).toBe(7); // août
    expect(dating.takenAt.getDate()).toBe(1);
  });

  it("ni métadonnée ni nom horodaté : date de fichier, AFFICHÉE comme dernier recours", async () => {
    const file = new File([new Uint8Array([0, 0, 0, 0]).buffer as ArrayBuffer], "aufnahme.mp4", {
      type: "video/mp4",
      lastModified: Date.UTC(2020, 0, 1),
    });
    const dating = await videoTakenAt(file);
    expect(dating.source).toBe("fichier-date");
    expect(dating.takenAt.getTime()).toBe(Date.UTC(2020, 0, 1));
  });
});
