/**
 * §104 — Tests du parseur EXIF maison : on FABRIQUE de vrais JPEG binaires
 * (SOI + APP1 « Exif\0\0 » + TIFF little ET big endian) et on épingle la
 * date lue. Aucune photo du web, aucune dépendance — la preuve est dans
 * les octets du test.
 */
import { describe, expect, it } from "vitest";

import {
  classifyImportFile,
  embeddedPhotoDate,
  parseDateFromFilename,
  parseExifDateTaken,
  photoTakenAt,
} from "@/lib/exif";

/* ---------------- Fabricant de JPEG EXIF synthétiques ---------------- */

type TiffEntrySpec = { tag: number; ascii: string } | { tag: number; long: number };

const ASCII_DATA_LEN = (entries: TiffEntrySpec[]): number =>
  entries.reduce(
    (n, e) => n + ("ascii" in e && e.ascii.length + 1 > 4 ? e.ascii.length + 1 : 0),
    0,
  );

/** Construit un TIFF valide (BOM, 42, IFD0, données, ExifIFD optionnel). */
function buildTiff(little: boolean, ifd0: TiffEntrySpec[], exifIfd?: TiffEntrySpec[]): Uint8Array {
  const entries0: TiffEntrySpec[] = exifIfd ? [...ifd0, { tag: 0x8769, long: 0 }] : [...ifd0];
  const ifd0DataStart = 8 + 2 + entries0.length * 12 + 4;
  const exifAt = ifd0DataStart + ASCII_DATA_LEN(entries0);
  if (exifIfd) entries0[entries0.length - 1] = { tag: 0x8769, long: exifAt };

  const total = exifIfd
    ? exifAt + 2 + exifIfd.length * 12 + 4 + ASCII_DATA_LEN(exifIfd)
    : ifd0DataStart + ASCII_DATA_LEN(entries0);
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  if (little) { buf[0] = 0x49; buf[1] = 0x49; } else { buf[0] = 0x4d; buf[1] = 0x4d; }
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);

  const writeIfd = (at: number, entries: TiffEntrySpec[]) => {
    let dataAt = at + 2 + entries.length * 12 + 4;
    view.setUint16(at, entries.length, little);
    entries.forEach((entry, i) => {
      const field = at + 2 + i * 12;
      view.setUint16(field, entry.tag, little);
      if ("ascii" in entry) {
        const bytes = [...entry.ascii].map((c) => c.charCodeAt(0));
        bytes.push(0);
        view.setUint16(field + 2, 2, little);            // type ASCII
        view.setUint32(field + 4, bytes.length, little); // count (avec NUL)
        if (bytes.length <= 4) {
          bytes.forEach((b, j) => view.setUint8(field + 8 + j, b));
        } else {
          view.setUint32(field + 8, dataAt, little);
          bytes.forEach((b, j) => view.setUint8(dataAt + j, b));
          dataAt += bytes.length;
        }
      } else {
        view.setUint16(field + 2, 4, little);            // type LONG
        view.setUint32(field + 4, 1, little);
        view.setUint32(field + 8, entry.long, little);
      }
    });
    view.setUint32(at + 2 + entries.length * 12, 0, little); // next = 0
  };

  writeIfd(8, entries0);
  if (exifIfd) writeIfd(exifAt, exifIfd);
  return buf;
}

/** Enveloppe JPEG minimale : SOI + APP1(Exif) — suffisante pour le parseur. */
function buildJpeg(tiff: Uint8Array): Uint8Array {
  const app1Len = 2 + 6 + tiff.length;
  const out = new Uint8Array(2 + 2 + 2 + 6 + tiff.length);
  out[0] = 0xff; out[1] = 0xd8;                 // SOI
  out[2] = 0xff; out[3] = 0xe1;                 // APP1
  out[4] = (app1Len >> 8) & 0xff; out[5] = app1Len & 0xff;
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6);   // « Exif\0\0 »
  out.set(tiff, 12);
  return out;
}

const DTO = "2026:08:10 14:30:52";

function expectLocalParts(date: Date | null) {
  expect(date).not.toBeNull();
  expect(date!.getFullYear()).toBe(2026);
  expect(date!.getMonth()).toBe(7); // août
  expect(date!.getDate()).toBe(10);
  expect(date!.getHours()).toBe(14);
  expect(date!.getMinutes()).toBe(30);
  expect(date!.getSeconds()).toBe(52);
}

/* ---------------------------------- tests ---------------------------------- */

describe("§104 — parseExifDateTaken (JPEG fabriqué au test)", () => {
  it("lit DateTimeOriginal en TIFF little-endian (« II »)", () => {
    const jpeg = buildJpeg(buildTiff(true, [], [{ tag: 0x9003, ascii: DTO }]));
    expectLocalParts(parseExifDateTaken(jpeg));
  });

  it("lit DateTimeOriginal en TIFF big-endian (« MM »)", () => {
    const jpeg = buildJpeg(buildTiff(false, [], [{ tag: 0x9003, ascii: DTO }]));
    expectLocalParts(parseExifDateTaken(jpeg));
  });

  it("sans Original, la date Numérisée (0x9004) fait foi", () => {
    const jpeg = buildJpeg(buildTiff(true, [], [{ tag: 0x9004, ascii: DTO }]));
    expectLocalParts(parseExifDateTaken(jpeg));
  });

  it("sans ExifIFD, repli sur DateTime (0x0132) de l'IFD0", () => {
    const jpeg = buildJpeg(buildTiff(true, [{ tag: 0x0132, ascii: DTO }]));
    expectLocalParts(parseExifDateTaken(jpeg));
  });

  it("non-JPEG (PNG) → null ; SOI+EOI seuls → null", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(parseExifDateTaken(png)).toBeNull();
    expect(parseExifDateTaken(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
  });

  it("segment tronqué → null (jamais d'exception ni de date inventée)", () => {
    const full = buildJpeg(buildTiff(true, [], [{ tag: 0x9003, ascii: DTO }]));
    expect(parseExifDateTaken(full.subarray(0, 20))).toBeNull(); // APP1 amputé
    // Offset IFD0 qui pointe hors du segment :
    const bogus = buildJpeg(buildTiff(true, [{ tag: 0x0132, ascii: DTO }]));
    bogus[12 + 4] = 0xff; bogus[12 + 7] = 0xff; // offset IFD0 → ≈16 M (hors bornes)
    expect(parseExifDateTaken(bogus)).toBeNull();
  });

  it("calendrier invalide dans la chaîne EXIF → null (mois 13, 25 h)", () => {
    const jpeg = buildJpeg(buildTiff(true, [], [{ tag: 0x9003, ascii: "2026:13:40 25:61:00" }]));
    expect(parseExifDateTaken(jpeg)).toBeNull();
  });
});

describe("§104 — parseDateFromFilename (repli honnête)", () => {
  it("reconnaît IMG_/PXL_/VID_, WhatsApp et Screenshot", () => {
    const cases: Array<[string, Date | null]> = [
      ["IMG_20260810_143052.jpg", new Date(2026, 7, 10, 14, 30, 52)],
      ["PXL_20260810_143052123.jpg", new Date(2026, 7, 10, 14, 30, 52)],
      ["VID_20260810_143052.jpeg", new Date(2026, 7, 10, 14, 30, 52)],
      ["WhatsApp Image 2026-08-10 at 14.30.52.jpeg", new Date(2026, 7, 10, 14, 30, 52)],
      ["Screenshot_2026-08-10-14-30-52 (1).jpg", new Date(2026, 7, 10, 14, 30, 52)],
      ["photo de vacances.jpg", null],
      ["IMG_20261310_143052.jpg", null], // mois 13 : refusé
    ];
    for (const [name, expected] of cases) {
      const parsed = parseDateFromFilename(name);
      if (expected === null) expect(parsed, name).toBeNull();
      else expect(parsed!.getTime(), name).toBe(expected.getTime());
    }
  });
});

/* ---------------- §105 — PNG & WebP synthétiques (chunks fabriqués) ---------------- */

function pngChunk(type: string, data: Uint8Array): number[] {
  const bytes: number[] = [];
  bytes.push((data.length >>> 24) & 0xff, (data.length >>> 16) & 0xff, (data.length >>> 8) & 0xff, data.length & 0xff);
  for (const c of type) bytes.push(c.charCodeAt(0));
  for (const b of data) bytes.push(b);
  bytes.push(0, 0, 0, 0); // CRC volontairement faux — notre parseur ne le lit pas
  return bytes;
}

function buildPng(withExif?: Uint8Array): Uint8Array {
  const bytes = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature PNG
    ...pngChunk("IHDR", new Uint8Array(13)),
  ];
  if (withExif) bytes.push(...pngChunk("eXIf", withExif));
  bytes.push(...pngChunk("IEND", new Uint8Array(0)));
  return new Uint8Array(bytes);
}

function buildWebp(tiff: Uint8Array): Uint8Array {
  const chunk: number[] = [];
  for (const c of "EXIF") chunk.push(c.charCodeAt(0));
  chunk.push(tiff.length & 0xff, (tiff.length >>> 8) & 0xff, (tiff.length >>> 16) & 0xff, (tiff.length >>> 24) & 0xff);
  for (const b of tiff) chunk.push(b);
  if (tiff.length % 2 === 1) chunk.push(0); // alignement pair
  const riffSize = 4 + chunk.length;
  const out = [0x52, 0x49, 0x46, 0x46, riffSize & 0xff, (riffSize >>> 8) & 0xff, (riffSize >>> 16) & 0xff, (riffSize >>> 24) & 0xff];
  for (const c of "WEBP") out.push(c.charCodeAt(0));
  return new Uint8Array([...out, ...chunk]);
}

describe("§105 — EXIF au-delà du JPEG (screenshots PNG, exports WebP)", () => {
  it("lit le chunk « eXIf » d'un PNG (TIFF direct, sans en-tête Exif)", () => {
    const png = buildPng(buildTiff(true, [], [{ tag: 0x9003, ascii: DTO }]));
    expectLocalParts(embeddedPhotoDate(png));
  });

  it("lit le chunk « EXIF » d'un WebP (RIFF, big-endian pour varier)", () => {
    const webp = buildWebp(buildTiff(false, [], [{ tag: 0x9003, ascii: DTO }]));
    expectLocalParts(embeddedPhotoDate(webp));
  });

  it("PNG sans « eXIf » → null (la page repliera sur nom/date, en le disant)", () => {
    expect(embeddedPhotoDate(buildPng())).toBeNull();
  });

  it("import honnête : image affichable / HEIC refusé-expliqué / autre ignoré", () => {
    const cases: Array<[string, string, ReturnType<typeof classifyImportFile>]> = [
      ["photo.jpg", "image/jpeg", "image"],
      ["scan.png", "image/png", "image"],
      ["export.webp", "image/webp", "image"],
      ["plan.gif", "image/gif", "image"],
      ["alt.bmp", "image/bmp", "image"],
      ["capture.PNG", "", "image"], // type vide (copie disque) : l'extension parle
      ["IMG_3102.heic", "", "heic"],
      ["IMG_3102.HEIF", "image/heif", "heic"],
      ["notizen.txt", "text/plain", "other"],
      ["plan.dwg", "", "other"],
    ];
    for (const [name, type, expected] of cases) {
      expect(classifyImportFile(new File(["x"], name, { type })), name).toBe(expected);
    }
  });
});

describe("§104 — photoTakenAt (chaîne de vérité : EXIF > nom > date fichier)", () => {
  it("l'EXIF prime sur le nom de fichier", async () => {
    const jpeg = buildJpeg(buildTiff(true, [], [{ tag: 0x9003, ascii: DTO }]));
    // BlobPart strict (TS ≥ 5.7) : on passe l'ArrayBuffer exact du fabricant.
    const file = new File([jpeg.buffer as ArrayBuffer], "IMG_20250101_000000.jpg", {
      type: "image/jpeg",
      lastModified: Date.UTC(2024, 0, 1),
    });
    const dating = await photoTakenAt(file);
    expect(dating.source).toBe("exif");
    expectLocalParts(dating.takenAt);
  });

  it("sans EXIF, le nom horodaté fait foi", async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "IMG_20260810_143052.jpg", {
      type: "image/jpeg",
      lastModified: Date.UTC(2024, 0, 1),
    });
    const dating = await photoTakenAt(file);
    expect(dating.source).toBe("fichier-nom");
    expect(dating.takenAt.getFullYear()).toBe(2026);
    expect(dating.takenAt.getMonth()).toBe(7);
    expect(dating.takenAt.getDate()).toBe(10);
  });

  it("sans EXIF ni nom parlant : lastModified, source DITE « fichier-date »", async () => {
    const stamp = Date.UTC(2026, 7, 5, 9, 0, 0);
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "photo.jpg", {
      type: "image/jpeg",
      lastModified: stamp,
    });
    const dating = await photoTakenAt(file);
    expect(dating.source).toBe("fichier-date");
    expect(dating.takenAt.getTime()).toBe(stamp);
  });
});

describe("§110 — classification vidéo (demande client « ajouter importation de vidéo »)", () => {
  const file = (name: string, type = "") => new File([new Uint8Array([0])], name, { type });

  it("MP4/M4V/WebM/MOV acceptés (type OU extension), AVI/MKV/WMV refusés marqués", () => {
    expect(classifyImportFile(file("VID_20260801_091200.mp4", "video/mp4"))).toBe("video");
    expect(classifyImportFile(file("rundgang.webm", "video/webm"))).toBe("video");
    expect(classifyImportFile(file("clip.mov", "video/quicktime"))).toBe("video");
    expect(classifyImportFile(file("clip.MP4"))).toBe("video"); // sans MIME déclaré
    expect(classifyImportFile(file("altbau.avi", "video/x-msvideo"))).toBe("video-incompatible");
    expect(classifyImportFile(file("film.mkv", "video/x-matroska"))).toBe("video-incompatible");
    expect(classifyImportFile(file("film.mkv"))).toBe("video-incompatible"); // même sans MIME
    expect(classifyImportFile(file("notizen.txt", "text/plain"))).toBe("other"); // inchangé
  });

  it("IMPORT_ACCEPT annonce les vidéos LISIBLES — jamais AVI/MKV (un navigateur ne les lit pas)", async () => {
    const { IMPORT_ACCEPT } = await import("@/lib/exif");
    expect(IMPORT_ACCEPT).toContain("video/mp4");
    expect(IMPORT_ACCEPT).toContain("video/webm");
    expect(IMPORT_ACCEPT).toContain("video/quicktime");
    expect(IMPORT_ACCEPT).not.toContain(".avi");
    expect(IMPORT_ACCEPT).not.toContain(".mkv");
  });
});
