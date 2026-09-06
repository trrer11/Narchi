// §180 — Projektstunden → Deckungsbeitrag : « est-ce que CE projet rapporte ? »
//
// Point de douleur mesuré (benchmark A&E 2025 : « 41 % don't track realization
// or aren't sure how much time is actually billed » ; « lost revenue from
// untracked hours ») : les architectes ne savent PAS, projet par projet, si le
// travail fourni est couvert par les honoraires. Ce moteur relie les heures
// saisies (par projet × Leistungsphase HOAI) au honorar calculé (calcHoai) :
//
//   - saisie des heures par projet et par LP (rapide : < 1 minute/jour) ;
//   - Stundensatz (taux horaire du bureau) configurable ;
//   - Deckungsbeitrag = Honorar netto − (heures × Stundensatz) :
//       > 0 → le projet GAGNE de l'argent ; < 0 → il en PERD.
//
// C'est LE signal de rentabilité que les outils génériques (sevDesk/Lexware)
// ne donnent pas, et que les grands (Factor/Monograph) réservent aux gros
// bureaux.
//
// HONNÊTETÉ (charta §36) : le Stundensatz est une donnée du BUREAU (à saisir),
// jamais inventée ; le Deckungsbeitrag est un signal d'orientation, pas une
// comptabilité (il ne couvre pas les frais généraux, seulement les heures).

import { LEISTUNGSPHASEN } from "@/data/hoai";

export interface StundenEintrag {
  id: string;
  projektId: string;
  /** Leistungsphase HOAI (1..8). */
  lp: number;
  /** Heures (nombre décimal, ex. 2.5). */
  stunden: number;
  /** Date ISO « YYYY-MM-DD ». */
  datum: string;
}

export const STUNDEN_STORAGE_KEY = "narchi:projektstunden";
export const STUNDENSATZ_KEY = "narchi:stundensatz";
export const STUNDENSATZ_DEFAULT = 75; // €/h — Richtwert, à saisir par le bureau

/** §229 — alte UI schrieb alles unter diesem Schlüssel (ein Eimer für alle Projekte). */
export const LEGACY_STUNDEN_PROJEKT = "aktiv";

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function ladeStunden(storage: Storage | null = defaultStorage()): StundenEintrag[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STUNDEN_STORAGE_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    return Array.isArray(p)
      ? p.filter(
          (x): x is StundenEintrag =>
            typeof x === "object" &&
            x !== null &&
            typeof (x as StundenEintrag).id === "string" &&
            typeof (x as StundenEintrag).stunden === "number",
        )
      : [];
  } catch {
    return [];
  }
}

function persist(list: StundenEintrag[], storage: Storage | null): void {
  if (!storage) return;
  try {
    storage.setItem(STUNDEN_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // quota / mode privé : dégradation silencieuse.
  }
}

export function addStunden(
  e: Omit<StundenEintrag, "id">,
  storage: Storage | null = defaultStorage(),
): StundenEintrag[] {
  const entry: StundenEintrag = {
    ...e,
    id: `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  };
  const next = [entry, ...ladeStunden(storage)];
  persist(next, storage);
  return next;
}

export function ersetzeStunden(
  list: StundenEintrag[],
  storage: Storage | null = defaultStorage(),
): StundenEintrag[] {
  persist(list, storage);
  return list;
}

export function removeStunden(
  id: string,
  storage: Storage | null = defaultStorage(),
): StundenEintrag[] {
  const next = ladeStunden(storage).filter((e) => e.id !== id);
  persist(next, storage);
  return next;
}

export function ladeStundensatz(storage: Storage | null = defaultStorage()): number {
  if (!storage) return STUNDENSATZ_DEFAULT;
  try {
    const raw = storage.getItem(STUNDENSATZ_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : STUNDENSATZ_DEFAULT;
  } catch {
    return STUNDENSATZ_DEFAULT;
  }
}

export function setzeStundensatz(
  satz: number,
  storage: Storage | null = defaultStorage(),
): number {
  const s = Number.isFinite(satz) && satz > 0 ? satz : STUNDENSATZ_DEFAULT;
  if (storage) {
    try {
      storage.setItem(STUNDENSATZ_KEY, String(s));
    } catch {
      // dégradation silencieuse.
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Agrégats (pur, testable).
// ---------------------------------------------------------------------------

export interface ProjektStunden {
  projektId: string;
  /** Heures par LP (1..8). */
  perLp: Record<number, number>;
  /** Total d'heures. */
  totalStunden: number;
}

/** Schreibt alte « aktiv »-Zeilen auf die echte Projekt-ID. Andere Projekte bleiben. */
export function migriereStundenProjektId(
  list: StundenEintrag[],
  nachId: string,
): { list: StundenEintrag[]; geaendert: number } {
  if (!nachId || nachId === LEGACY_STUNDEN_PROJEKT) return { list, geaendert: 0 };
  let geaendert = 0;
  const next = list.map((e) => {
    if (e.projektId !== LEGACY_STUNDEN_PROJEKT) return e;
    geaendert += 1;
    return { ...e, projektId: nachId };
  });
  return { list: next, geaendert };
}

/** Entfernt nur die Stunden DIESES Projekts — andere bleiben. */
export function stundenOhneProjekt(
  list: StundenEintrag[],
  projektId: string,
): StundenEintrag[] {
  return list.filter((e) => e.projektId !== projektId);
}

export function stundenFuerProjekt(
  eintraege: StundenEintrag[],
  projektId: string,
): ProjektStunden {
  const perLp: Record<number, number> = {};
  let totalStunden = 0;
  for (const e of eintraege) {
    if (e.projektId !== projektId) continue;
    const h = Number.isFinite(e.stunden) ? e.stunden : 0;
    perLp[e.lp] = (perLp[e.lp] ?? 0) + h;
    totalStunden += h;
  }
  return { projektId, perLp, totalStunden };
}

export interface Deckungsbeitrag {
  /** Honorar netto (calcHoai.total). */
  honorarNetto: number;
  /** Heures × Stundensatz. */
  aufwandEuro: number;
  /** Honorar − Aufwand (positif = gagne). */
  deckungsbeitrag: number;
  /** Part de l'honorar consommée par les heures (%). */
  realisationPct: number | null;
  /** Nombre d'heures. */
  totalStunden: number;
  stundensatz: number;
}

export function deckungsbeitrag(
  honorarNetto: number,
  totalStunden: number,
  stundensatz: number,
): Deckungsbeitrag {
  const aufwandEuro = totalStunden * stundensatz;
  const deckungsbeitrag = honorarNetto - aufwandEuro;
  const realisationPct =
    honorarNetto > 0 ? (aufwandEuro / honorarNetto) * 100 : null;
  return {
    honorarNetto,
    aufwandEuro,
    deckungsbeitrag,
    realisationPct,
    totalStunden,
    stundensatz,
  };
}

/** Répartition des heures par LP, ordonnée (LP 1..8) avec les noms. */
export function stundenNachLp(perLp: Record<number, number>): { lp: number; name: string; stunden: number }[] {
  return LEISTUNGSPHASEN.map((p) => ({
    lp: p.nr,
    name: p.name,
    stunden: perLp[p.nr] ?? 0,
  })).filter((x) => x.stunden > 0);
}
