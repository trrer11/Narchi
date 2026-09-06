/**
 * §104 — Date de prise de vue RÉELLE d'une photo (page chantier, idée
 * client : « Narchi sélectionne intelligemment »). L'intelligence ici =
 * la VÉRITÉ des métadonnées, jamais une pseudo-IA d'analyse d'image :
 *
 *   1. EXIF embarqué — ce que l'appareil a écrit au déclenchement :
 *      JPEG (APP1 « Exif\0\0 »), PNG (chunk « eXIf », §105 — les captures
 *      d'écran sont des PNG !), WebP (chunk « EXIF » du conteneur RIFF,
 *      §105) — DateTimeOriginal 0x9003, repli DateTimeDigitized 0x9004,
 *      puis DateTime 0x0132 de l'IFD0 ;
 *   2. nom de fichier horodaté (IMG_20260810_143052.jpg, PXL_…, VID_…,
 *      « WhatsApp Image 2026-08-10 at 14.30.52.jpeg ») ;
 *   3. date de modification du fichier — dernier recours, AFFICHÉ comme tel.
 *
 * Parseur écrit main, zéro dépendance (TIFF little/big endian). Tout est
 * borné : un blob tronqué ou malicieux rend null, jamais une exception qui
 * interromprait l'import des AUTRES photos.
 */

/** §110 — « video-meta » : date de tournage lue dans le conteneur MP4/MOV
 *  (boîte mvhd, parseur maison zéro-dépendance src/lib/mp4date.ts) —
 *  affichée telle quelle, distincte de l'EXIF photo. */
export type PhotoDateSource = "exif" | "video-meta" | "fichier-nom" | "fichier-date";

export interface PhotoDating {
  takenAt: Date;
  source: PhotoDateSource;
}

/** Combien d'octets lire en tête de fichier pour trouver l'EXIF
 *  (l'APP1 vit au tout début du JPEG ; 256 Kio sont très au-delà du besoin). */
const EXIF_PROBE_BYTES = 256 * 1024;

function makeValidDate(
  y: number, mo: number, d: number, h: number, mi: number, s: number,
): Date | null {
  if (y < 1990 || y > 2100) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (h > 23 || mi > 59 || s > 60) return null;
  const date = new Date(y, mo - 1, d, h, mi, Math.min(s, 59));
  // Garde-fou calendaire : « 2026:02:31 » deviendrait un 3 mars silencieux.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

/** « 2026:08:10 14:30:52 » (format EXIF) → Date locale, ou null. */
export function parseExifDateString(raw: string): Date | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  return makeValidDate(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
}

interface TiffEntry {
  tag: number;
  type: number;
  count: number;
  /** Offset du champ valeur (4 octets) dans le TIFF. */
  fieldAt: number;
  /** Valeur u32 du champ (offset vers les données si la donnée tient pas). */
  value: number;
}

/** Lit un IFD TIFF borné ; null si les offsets sortent du segment. */
function readIfd(view: DataView, length: number, offset: number, little: boolean): Map<number, TiffEntry> | null {
  if (offset < 0 || offset + 2 > length) return null;
  const count = view.getUint16(offset, little);
  const map = new Map<number, TiffEntry>();
  for (let i = 0; i < count; i++) {
    const at = offset + 2 + i * 12;
    if (at + 12 > length) return null;
    map.set(view.getUint16(at, little), {
      tag: view.getUint16(at, little),
      type: view.getUint16(at + 2, little),
      count: view.getUint32(at + 4, little),
      fieldAt: at + 8,
      value: view.getUint32(at + 8, little),
    });
  }
  return map;
}

/** Chaîne ASCII d'une entrée TIFF : en ligne si ≤ 4 octets, sinon par offset. */
function readTiffAscii(view: DataView, length: number, entry: TiffEntry): string | null {
  if (entry.type !== 2 || entry.count <= 0) return null; // ASCII
  const at = entry.count <= 4 ? entry.fieldAt : entry.value;
  if (at < 0 || at + entry.count > length) return null;
  let out = "";
  for (let i = 0; i < entry.count; i++) {
    const byte = view.getUint8(at + i);
    if (byte === 0) break;
    out += String.fromCharCode(byte);
  }
  return out;
}

/** Repère le segment APP1 « Exif\0\0 » et en rend le contenu TIFF. */
function findExifTiff(bytes: Uint8Array): Uint8Array | null {
  let pos = 2; // après SOI (vérifié par l'appelant)
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return null;
    const marker = bytes[pos + 1];
    // Sans longueur : RSTn/TEM (jamais avant APP1 en pratique), SOS, EOI.
    if (marker === 0xda || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      return null;
    }
    const len = (bytes[pos + 2] << 8) | bytes[pos + 3];
    if (len < 2 || pos + 2 + len > bytes.length) return null;
    if (
      marker === 0xe1 && len >= 10 &&
      bytes[pos + 4] === 0x45 && bytes[pos + 5] === 0x78 && // « Ex »
      bytes[pos + 6] === 0x69 && bytes[pos + 7] === 0x66 && // « if »
      bytes[pos + 8] === 0 && bytes[pos + 9] === 0
    ) {
      return bytes.subarray(pos + 10, pos + 2 + len);
    }
    pos += 2 + len;
  }
  return null;
}

/**
 * Date EXIF d'un segment TIFF déjà isolé (little- ou big-endian), ou null.
 * C'est le cœur partagé : JPEG, PNG et WebP ne changent que la façon
 * d'EXTRAIRE ce segment.
 */
function parseTiffDate(tiff: Uint8Array): Date | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;   // « II »
  const bigEndian = tiff[0] === 0x4d && tiff[1] === 0x4d; // « MM »
  if (!little && !bigEndian) return null;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (view.getUint16(2, little) !== 42) return null;

  const ifd0 = readIfd(view, tiff.length, view.getUint32(4, little), little);
  if (!ifd0) return null;

  // Priorité : ExifIFD (pointeur 0x8769, type LONG) → DateTimeOriginal,
  // repli DateTimeDigitized — les vraies dates de déclenchement.
  const pointer = ifd0.get(0x8769);
  if (pointer && pointer.type === 4) {
    const exifIfd = readIfd(view, tiff.length, pointer.value, little);
    for (const tag of [0x9003, 0x9004]) {
      const entry = exifIfd?.get(tag);
      const raw = entry ? readTiffAscii(view, tiff.length, entry) : null;
      const date = raw ? parseExifDateString(raw) : null;
      if (date) return date;
    }
  }
  // Dernier recours EXIF : DateTime (0x0132) de l'IFD0 (souvent la date
  // de retouche — mieux que rien, mais après les dates de déclenchement).
  const dt = ifd0.get(0x0132);
  const raw = dt ? readTiffAscii(view, tiff.length, dt) : null;
  return raw ? parseExifDateString(raw) : null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** §105 — PNG : chunks {len u32 BE · type 4c · data · crc} ; EXIF = chunk
 *  « eXIf » contenant le segment TIFF directement (sans en-tête Exif). */
function findPngExifTiff(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 8 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const len =
      ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    if (pos + 12 + len > bytes.length) return null;
    if (type === "eXIf") return bytes.subarray(pos + 8, pos + 8 + len);
    if (type === "IEND") return null;
    pos += 12 + len;
  }
  return null;
}

/** §105 — WebP : conteneur RIFF (« RIFF »+taille LE+« WEBP »), chunks
 *  {fourcc · taille u32 LE · data, alignés pair} ; EXIF = chunk « EXIF ». */
function findWebpExifTiff(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 12) return null;
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "RIFF") return null;
  if (String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) !== "WEBP") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const four = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    const size = view.getUint32(pos + 4, true);
    if (pos + 8 + size > bytes.length) return null;
    if (four === "EXIF") {
      let data = bytes.subarray(pos + 8, pos + 8 + size);
      // Tolérance : certains encodeurs préfixent « Exif\0\0 » — on l'enlève.
      if (
        data.length >= 6 &&
        data[0] === 0x45 && data[1] === 0x78 && data[2] === 0x69 && data[3] === 0x66 &&
        data[4] === 0 && data[5] === 0
      ) {
        data = data.subarray(6);
      }
      return data;
    }
    pos += 8 + size + (size % 2); // chunks alignés sur 2 octets
  }
  return null;
}

/**
 * Date de prise de vue embarquée, quel que soit le conteneur supporté
 * (magic bytes d'abord — jamais le type MIME déclaré, qui peut mentir) :
 * JPEG FF D8 · PNG 89 50 « eXIf » · RIFF/WEBP chunk « EXIF ». Sinon null.
 */
export function embeddedPhotoDate(bytes: Uint8Array): Date | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const tiff = findExifTiff(bytes);
    return tiff ? parseTiffDate(tiff) : null;
  }
  if (bytes.length >= 2 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const tiff = findPngExifTiff(bytes);
    return tiff ? parseTiffDate(tiff) : null;
  }
  const tiff = findWebpExifTiff(bytes);
  return tiff ? parseTiffDate(tiff) : null;
}

/**
 * Date EXIF d'un JPEG (en-tête suffit), ou null si absente/invalide.
 * Gardée pour les tests qui épinglent le format JPEG en particulier.
 */
export function parseExifDateTaken(bytes: Uint8Array): Date | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  return embeddedPhotoDate(bytes);
}

/**
 * Nom de fichier horodaté → Date locale, ou null.
 * Couvre : IMG_20260810_143052, PXL_20260810_143052123, VID_20260810_143052,
 * Screenshot_2026-08-10-14-30-52, « WhatsApp Image 2026-08-10 at 14.30.52 ».
 */
export function parseDateFromFilename(name: string): Date | null {
  const base = name.split(/[\\/]/).pop() ?? name;
  let m = /(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/.exec(base);
  if (m) return makeValidDate(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
  m = /(\d{4})-(\d{2})-(\d{2})\D+(\d{2})\D(\d{2})\D(\d{2})/.exec(base);
  if (m) return makeValidDate(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
  return null;
}

async function readHead(file: File): Promise<Uint8Array | null> {
  const slice = file.slice(0, EXIF_PROBE_BYTES);
  if (typeof slice.arrayBuffer === "function") {
    return new Uint8Array(await slice.arrayBuffer());
  }
  // Vieux jsdom sans Blob.arrayBuffer : FileReader (jamais d'exception fatale).
  return await new Promise<Uint8Array | null>((resolvePromise) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolvePromise(reader.result instanceof ArrayBuffer ? new Uint8Array(reader.result) : null);
    reader.onerror = () => resolvePromise(null);
    reader.readAsArrayBuffer(slice);
  });
}

/**
 * Chaîne de vérité complète pour UN fichier : EXIF embarqué d'abord
 * (JPEG/PNG/WebP selon les magic bytes), nom ensuite, `lastModified` en
 * dernier — la source revient au caller qui l'AFFICHE (jamais une date
 * présentée comme EXIF qui n'en serait pas une).
 */
export async function photoTakenAt(file: File): Promise<PhotoDating> {
  try {
    const head = await readHead(file);
    const exif = head ? embeddedPhotoDate(head) : null;
    if (exif) return { takenAt: exif, source: "exif" };
  } catch {
    /* lecture impossible → replis ci-dessous, source dite */
  }
  const fromName = parseDateFromFilename(file.name);
  if (fromName) return { takenAt: fromName, source: "fichier-nom" };
  const fallback = Number.isFinite(file.lastModified) ? new Date(file.lastModified) : new Date();
  return { takenAt: fallback, source: "fichier-date" };
}

/* ---------------------- §105/§110 — quels fichiers importer ---------------------- */

export type ImportFileKind = "image" | "video" | "heic" | "video-incompatible" | "other";

/** Formats que le NAVIGATEUR sait afficher en <img> — importables. */
const RENDERABLE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
]);
const RENDERABLE_EXT = /\.(jpe?g|png|webp|gif|bmp)$/i;

/** §110 — vidéos que le NAVIGATEUR sait lire en <video> : MP4/M4V/MOV
 *  (H.264, ce que filme un téléphone) et WebM. */
const PLAYABLE_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const PLAYABLE_VIDEO_EXT = /\.(mp4|m4v|webm|mov)$/i;
/** Conteneurs QU'AUCUN navigateur ne lit → refus expliqué (comme HEIC),
 *  jamais importés puis vignette/lecture cassées : ce serait du fake. */
const UNPLAYABLE_VIDEO_EXT = /\.(avi|mkv|wmv|flv|m2ts)$/i;

export const IMPORT_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,image/bmp," +
  "video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov";

/**
 * Tri d'entrée, honnête : « image »/« video » = le navigateur sait les
 * MONTRER ; « heic » (iPhone natif) et « video-incompatible » (AVI, MKV…)
 * = illisibles par lui, donc REFUSÉS expliqués ; « other » = ni image ni
 * vidéo. Jamais d'import « réussi » dont la vignette serait cassée.
 */
export function classifyImportFile(file: File): ImportFileKind {
  const name = file.name || "";
  if (/\.hei[cf]$/i.test(name) || file.type === "image/heic" || file.type === "image/heif") {
    return "heic";
  }
  if (PLAYABLE_VIDEO_TYPES.has(file.type) || PLAYABLE_VIDEO_EXT.test(name)) return "video";
  if (file.type.startsWith("video/") || UNPLAYABLE_VIDEO_EXT.test(name)) return "video-incompatible";
  if (RENDERABLE_TYPES.has(file.type)) return "image";
  if (!file.type && RENDERABLE_EXT.test(name)) return "image";
  return "other";
}
