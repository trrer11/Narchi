// §181 — Bauteil-Standard-Bibliothek : ne plus JAMAIS réinventer un détail.
//
// Point de douleur cité par les architectes (Reddit/veille) : « je réinvente
// des détails que j'ai déjà faits cent fois » — le temps perdu à refaire un
// détail de raccord, une composition de paroi, un U-Wert, à chaque projet.
// Les grands bureaux ont une « Detailbibliothek » ; les petits réinventent à
// la main. Ce module donne au petit bureau la MÊME arme : enregistrer un
// BAUTEIL STANDARD une fois (composition, U-Wert, coût, note), et le réutiliser
// projet après projet.
//
// HONNÊTETÉ (charta §36) : la bibliothèque stocke ce que L'ARCHITECTE saisit
// (sa connaissance métier), jamais des données inventées. C'est un carnet
// de standards du bureau, pas un catalogue fournisseur. Les U-Werte/coûts
// saisis sont des RICHTWERTE du bureau (à vérifier par le planificateur).

export type BauteilKategorie = "wand" | "dach" | "decke" | "boden" | "fenster" | "anschluss";

export interface BauteilStandard {
  id: string;
  name: string;
  kategorie: BauteilKategorie;
  /** Description courte de la composition (« KS 17,5 + WDVS EPS 160 mm »). */
  aufbau: string;
  /** U-Wert en W/(m²K) — Richtwert du bureau (facultatif). */
  uWert: number | null;
  /** Coût indicatif €/m² — Richtwert du bureau (facultatif). */
  kosten: number | null;
  /** Note libre (retour d'expérience). */
  notiz: string;
  createdAt: string;
}

export const KATEGORIE_LABEL: Record<BauteilKategorie, string> = {
  wand: "Wand",
  dach: "Dach",
  decke: "Decke",
  boden: "Boden / Bodenplatte",
  fenster: "Fenster / Öffnung",
  anschluss: "Anschluss / Detail",
};

export const DETAIL_STORAGE_KEY = "narchi:bauteil-bibliothek";

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function ladeBauteile(storage: Storage | null = defaultStorage()): BauteilStandard[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(DETAIL_STORAGE_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    return Array.isArray(p)
      ? p.filter(
          (x): x is BauteilStandard =>
            typeof x === "object" &&
            x !== null &&
            typeof (x as BauteilStandard).id === "string" &&
            typeof (x as BauteilStandard).name === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function persist(list: BauteilStandard[], storage: Storage | null): void {
  if (!storage) return;
  try {
    storage.setItem(DETAIL_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // quota / mode privé : dégradation silencieuse.
  }
}

export function addBauteil(
  input: Omit<BauteilStandard, "id" | "createdAt">,
  storage: Storage | null = defaultStorage(),
): BauteilStandard[] {
  const bauteil: BauteilStandard = {
    ...input,
    id: `bt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
  };
  const next = [bauteil, ...ladeBauteile(storage)];
  persist(next, storage);
  return next;
}

export function ersetzeBauteile(
  list: BauteilStandard[],
  storage: Storage | null = defaultStorage(),
): BauteilStandard[] {
  persist(list, storage);
  return list;
}

export function removeBauteil(
  id: string,
  storage: Storage | null = defaultStorage(),
): BauteilStandard[] {
  const next = ladeBauteile(storage).filter((b) => b.id !== id);
  persist(next, storage);
  return next;
}

/** Recherche par mot-clé (nom + aufbau), insensible à la casse. */
export function sucheBauteile(list: BauteilStandard[], q: string): BauteilStandard[] {
  const s = q.trim().toLowerCase();
  if (!s) return list;
  return list.filter(
    (b) =>
      b.name.toLowerCase().includes(s) ||
      b.aufbau.toLowerCase().includes(s) ||
      b.notiz.toLowerCase().includes(s),
  );
}

/** Statistiques honnêtes : combien de standards, par catégorie. */
export function bibliothekStats(list: BauteilStandard[]): {
  total: number;
  perKategorie: Record<string, number>;
} {
  const perKategorie: Record<string, number> = {};
  for (const b of list) {
    perKategorie[b.kategorie] = (perKategorie[b.kategorie] ?? 0) + 1;
  }
  return { total: list.length, perKategorie };
}
