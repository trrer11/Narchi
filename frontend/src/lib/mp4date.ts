/**
 * §110 — Date de tournage d'une VIDÉO (import chantier au bureau, demande
 * client « ajouter importation de vidéo »). Pas d'EXIF dans une vidéo :
 * les MP4/MOV portent une boîte « mvhd » (movie header) avec un
 * `creation_time` en secondes depuis le 1er janvier 1904 UTC.
 *
 * Méthode, honnête et bornée :
 *  - on balaie les octets à la recherche du motif « mvhd » en tête ET en
 *    queue (beaucoup de mobiles écrivent la « moov » en FIN de fichier) ;
 *  - chaque candidat est VALIDÉ (taille de boîte plausible, version 0/1,
 *    date dans une fourchette 1990…2100) — un faux positif « mvhd » dans
 *    des données compressées ne peut pas produire une date bidon : il ne
 *    passe tout simplement pas les gardes ;
 *  - WebM n'a pas d'équivalent portable → replis nom de fichier puis date
 *    de modification, avec la SOURCE toujours affichée (même règle que
 *    les photos §104 : jamais une date présentée comme métadonnée si elle
 *    vient d'ailleurs).
 *
 * Zéro dépendance, jamais d'exception : blob tronqué → null.
 */

import { parseDateFromFilename, type PhotoDating } from "@/lib/exif";

/** Secondes entre l'époque MP4 (1904-01-01) et l'époque Unix (1970-01-01). */
const MP4_EPOCH_OFFSET_S = 2_082_844_800;
const PROBE_BYTES = 256 * 1024;

function mvhdFrom(view: DataView, pos: number, available: number): Date | null {
  // pos = index du motif « mvhd » ; les 4 octets avant = taille de la boîte.
  if (pos < 4 || pos + 8 > available) return null;
  const boxSize = view.getUint32(pos - 4); // big-endian, imposé par le format
  if (boxSize < 20 || pos - 4 + boxSize > available) return null;
  const content = pos + 4;
  if (content + 8 > available) return null;
  const version = view.getUint8(content);
  let creationS: number;
  if (version === 0) {
    creationS = view.getUint32(content + 4);
  } else if (version === 1) {
    if (content + 16 > available) return null;
    creationS = Number(view.getBigUint64(content + 4));
  } else {
    return null;
  }
  // Garde-fous calendaires : un `creation_time` invalide ne fabrique
  // jamais une date (années 1990…2100, comme le parseur EXIF).
  const unixS = creationS - MP4_EPOCH_OFFSET_S;
  const year = new Date(unixS * 1000).getUTCFullYear();
  if (!Number.isFinite(unixS) || year < 1990 || year > 2100) return null;
  return new Date(unixS * 1000);
}

/**
 * `creation_time` mvhd dans un tampon quelconque (tête ou queue de
 * fichier), ou null. Complexité O(n) sur des sondes de 256 Kio : anodin.
 */
export function findMvhdDate(bytes: Uint8Array): Date | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let pos = 4; pos + 8 <= bytes.length; pos++) {
    if (
      bytes[pos] === 0x6d && // « m »
      bytes[pos + 1] === 0x76 && // « v »
      bytes[pos + 2] === 0x68 && // « h »
      bytes[pos + 3] === 0x64 // « d »
    ) {
      const date = mvhdFrom(view, pos, bytes.length);
      if (date) return date;
    }
  }
  return null;
}

async function readSlice(file: File, from: number, to: number): Promise<Uint8Array | null> {
  const slice = file.slice(from, to);
  if (typeof slice.arrayBuffer === "function") {
    return new Uint8Array(await slice.arrayBuffer());
  }
  return await new Promise<Uint8Array | null>((resolvePromise) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolvePromise(reader.result instanceof ArrayBuffer ? new Uint8Array(reader.result) : null);
    reader.onerror = () => resolvePromise(null);
    reader.readAsArrayBuffer(slice);
  });
}

/**
 * Chaîne de vérité complète pour UNE vidéo : métadonnée mvhd (tête puis
 * queue de fichier), nom horodaté (VID_20260801_091200.mp4…), date de
 * modification en dernier recours — la source revient au caller qui
 * l'AFFICHE. Jamais d'exception.
 */
export async function videoTakenAt(file: File): Promise<PhotoDating> {
  try {
    const head = await readSlice(file, 0, Math.min(file.size, PROBE_BYTES));
    const headDate = head ? findMvhdDate(head) : null;
    if (headDate) return { takenAt: headDate, source: "video-meta" };
    // La « moov » peut vivre en FIN de fichier (mobiles non ré-encodés) :
    // seconde sonde en queue, sinon replis nom/date affichés honnêtement.
    if (file.size > PROBE_BYTES) {
      const tail = await readSlice(file, Math.max(0, file.size - PROBE_BYTES), file.size);
      const tailDate = tail ? findMvhdDate(tail) : null;
      if (tailDate) return { takenAt: tailDate, source: "video-meta" };
    }
  } catch {
    /* lecture impossible → replis ci-dessous, source dite */
  }
  const fromName = parseDateFromFilename(file.name);
  if (fromName) return { takenAt: fromName, source: "fichier-nom" };
  const fallback = Number.isFinite(file.lastModified) ? new Date(file.lastModified) : new Date();
  return { takenAt: fallback, source: "fichier-date" };
}
