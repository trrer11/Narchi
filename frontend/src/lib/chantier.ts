/**
 * §104 — Logique PURE de la nouvelle page « Baustelle » (idée client) :
 * import des photos AU BUREAU + regroupement automatique par vraies dates
 * de prise de vue (EXIF d'abord), puis création de Mängel depuis les
 * groupes cochés. Aucune analyse de contenu, aucune promesse de synchro
 * serveur : tout reste en IndexedDB de CE poste — et l'écran le dit.
 */

import type { Issue, IssueSeverity, Project } from "@/data/types";
import type { PhotoDateSource } from "@/lib/exif";

export interface ChanPhoto {
  id: string;
  name: string;
  /** ms epoch — vraie date de prise de vue quand EXIF/mvhd/nom la livrent. */
  takenAt: number;
  source: PhotoDateSource;
  /** §110 — photo OU vidéo (import vidéo, demande client) : les vignettes
   *  et la visionneuse rendent différemment, le comptage le dit distinct. */
  kind: "photo" | "video";
}

export interface VisitSession {
  key: string;
  from: number;
  to: number;
  photoIds: string[];
}

export interface VisitDay {
  dayKey: string;        // « 2026-08-10 » (heure locale du poste)
  label: string;         // « 10.08.2026 » — jour de la visite
  photoCount: number;
  sessions: VisitSession[];
}

/** Rupture de série : plus de 10 minutes sans photo = nouvelle séance
 *  (à 10 minutes pile, ça reste la MÊME séance — borne épinglée). */
export const SESSION_GAP_MS = 10 * 60 * 1000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function dayKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function formatDayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split("-");
  return `${d}.${m}.${y}`;
}

export function formatTimeOf(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** « 09:12–10:03 » (tiret demi-cadratin U+2013) ; une seule heure si la
 *  séance tient dans une minute (jamais « 09:12–09:12 » ridicule). */
export function formatTimeRange(from: number, to: number): string {
  const a = formatTimeOf(from);
  const b = formatTimeOf(to);
  return a === b ? a : `${a}–${b}`;
}

export function formatPhotoCount(n: number): string {
  return n === 1 ? "1 Foto" : `${n} Fotos`;
}

/** §110 — comptage vidéo affiché distinctement (jamais « 3 Fotos » quand
 *  l'une était une vidéo : ce serait imprécis). */
export function formatVideoCount(n: number): string {
  return n === 1 ? "1 Video" : `${n} Videos`;
}

/**
 * Regroupe les photos en visites datées : tri par prise de vue, découpe
 * par JOUR puis par séance (rupture > 10 min). Les séances antique/naive
 * ne réordonnent jamais l'histoire : elles se lisent chronologiquement.
 */
export function groupVisits(photos: ChanPhoto[]): VisitDay[] {
  const sorted = [...photos].sort(
    (a, b) => a.takenAt - b.takenAt || a.id.localeCompare(b.id),
  );
  const days: VisitDay[] = [];
  let day: VisitDay | null = null;
  let session: VisitSession | null = null;
  let lastTs = 0;
  let sequence = 0;
  for (const photo of sorted) {
    const key = dayKeyOf(photo.takenAt);
    if (!day || day.dayKey !== key) {
      day = { dayKey: key, label: formatDayLabel(key), photoCount: 0, sessions: [] };
      days.push(day);
      session = null;
    }
    if (!session || photo.takenAt - lastTs > SESSION_GAP_MS) {
      sequence += 1;
      session = { key: `${key}#${sequence}`, from: photo.takenAt, to: photo.takenAt, photoIds: [] };
      day.sessions.push(session);
    }
    session.photoIds.push(photo.id);
    session.to = photo.takenAt;
    lastTs = photo.takenAt;
    day.photoCount += 1;
  }
  return days;
}

export interface SourceCounts {
  exif: number;
  /** §110 — dates lues dans la boîte mvhd des vidéos MP4/MOV. */
  meta: number;
  nom: number;
  date: number;
}

/** Transparence d'import : « d'où vient chaque date », affiché tel quel. */
export function countPhotoSources(photos: ChanPhoto[]): SourceCounts {
  const counts: SourceCounts = { exif: 0, meta: 0, nom: 0, date: 0 };
  for (const photo of photos) {
    if (photo.source === "exif") counts.exif += 1;
    else if (photo.source === "video-meta") counts.meta += 1;
    else if (photo.source === "fichier-nom") counts.nom += 1;
    else counts.date += 1;
  }
  return counts;
}

/** Jours entiers écoulés depuis le début du projet (vérité calendaire
 *  §102 conservée : bornée à 0, jamais de négatif ni de NaN discret). */
export function daysSinceProjectStart(startDate: string, now: Date): number {
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86_400_000));
}

export interface PhotoMangelInput {
  title: string;
  description: string;
  severity: IssueSeverity;
  classificationCode: string;
  /** Ebene/Zone libre (« k. A. » si vide — jamais d'invention). */
  level: string;
  photoIds: string[];
  /** §110 — sous-ensemble vidéo de la sélection (connu à la création). */
  videoIds?: string[];
  /** Plus ancienne prise de vue de la sélection (ms). Le Mangel existait
   *  au plus tard CE jour-là : le « Tag N » de l'Issue est celui de la
   *  photo, pas celui de la saisie au bureau — preuve datée, pas date de
   *  frappe. Sans sélection datée, repli au jour de saisie. */
  earliestTakenAt?: number;
}

/**
 * Construit l'Issue chantier depuis une sélection de photos. Identifiant
 * injecté (pas de Date.now() caché — les tests l'épinglent), provenance
 * « Baustelle » lisible dans l'assignee pour la page Issues du cockpit.
 */
export function buildPhotoMangel(
  input: PhotoMangelInput,
  project: Pick<Project, "id" | "startDate">,
  now: Date,
  id: string,
): Issue {
  const raisedDay = input.earliestTakenAt !== undefined
    ? daysSinceProjectStart(project.startDate, new Date(input.earliestTakenAt))
    : daysSinceProjectStart(project.startDate, now);
  return {
    id,
    title: input.title.trim(),
    description: input.description.trim(),
    severity: input.severity,
    classificationCode: input.classificationCode,
    level: input.level.trim() || "k. A.",
    assignee: "Baustelle",
    raisedDay,
    status: "open",
    projectId: project.id,
    ...(input.photoIds.length > 0 ? { photoIds: input.photoIds } : {}),
    ...(input.videoIds && input.videoIds.length > 0 ? { videoIds: input.videoIds } : {}),
    // §107 — la vraie date de visite reste collée au Mangel (« Besuch vom
    // 01.08.2026 »), pas seulement le « Tag N » qui ne parle à personne.
    ...(input.earliestTakenAt !== undefined
      ? { visitDate: dayKeyOf(input.earliestTakenAt) }
      : {}),
  };
}
