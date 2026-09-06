// NARCHI — Ordre professionnel universel des listes (demande 2026-08-06) :
// « chaque tableau ou liste doit être organisé PAR NIVEAU puis ORDRE
// ALPHABÉTIQUE ». Ce module est la source unique de cet ordre : toutes les
// listes (Éléments, Quantités, Clashs, exports…) l'utilisent.
//
// Ordre des niveaux (bas → haut, convention bureau allemand) :
//   2. UG (−2) < 1. UG / KG (−1) < EG (0) < 1. OG (1) < … < n. OG
//   < inconnus (par alphabétique) < Dach/Attika (tout en haut).
// Alias reconnus : « Niveau -1 », « Level 2 », « Ebene 3 », « OG1 », « 2.OG »,
// « 1UG », « KG », numéros purs « 3 ».

const RE_UG_N = /(\d+)\s*\.?\s*(?:\.\s*)?(ug|kg)\b/i;
const RE_OG_N = /(\d+)\s*\.?\s*(?:\.\s*)?og\b|\bog\s*(\d+)\b/i;
const RE_NIV = /(?:niveau|level|ebene|geschoss)\s*(-?\d+)/i;
const RE_PURE_NUM = /^\s*(-?\d+)\s*$/;
const RE_ROOF = /^(dach|dg\b|attika|r\b|rf\b|spitzboden)/i;
const RE_BASEMENT_WORD = /^(ug\b|kg\b|keller|untergeschoss|souterrain)/i;
const RE_GROUND = /^(eg\b|erdgeschoss|g\b|rez|parterre\b|ground)/i;

export interface LevelKey {
  /** Rang de tri (bas → haut). 500 = inconnu (alphabétique), 900 = toiture. */
  rank: number;
  /** Libellé normalisé pour regroupement (ex. en-têtes d'export). */
  label: string;
}

/// Classe une chaîne de niveau pour le tri bas → haut.
export function levelKey(raw: string | null | undefined): LevelKey {
  const s = (raw ?? "").trim();
  if (!s || s === "—" || s === "-") return { rank: 500, label: "—" };

  const ogN = s.match(RE_OG_N);
  if (ogN) {
    const n = Number(ogN[1] ?? ogN[2]);
    if (Number.isFinite(n) && n > 0) return { rank: Math.min(n, 499), label: `${n}. OG` };
  }
  const ugN = s.match(RE_UG_N);
  if (ugN) {
    const n = Number(ugN[1]);
    if (Number.isFinite(n) && n > 0) return { rank: -Math.min(n, 99), label: `${n}. UG` };
  }
  if (RE_ROOF.test(s)) return { rank: 900, label: "Dach" };
  if (RE_BASEMENT_WORD.test(s)) {
    // « UG 2 » sans point, ou « Kellerschoss » → −1 par défaut.
    const tail = s.match(/\b(\d+)\b/);
    const n = tail ? Math.min(Number(tail[1]), 99) : 1;
    return { rank: -n, label: `${n}. UG` };
  }
  if (RE_GROUND.test(s)) return { rank: 0, label: "EG" };
  const niv = s.match(RE_NIV);
  if (niv) {
    const n = Number(niv[1]);
    if (Number.isFinite(n)) {
      if (n < 0) return { rank: Math.max(n, -99), label: `${Math.abs(n)}. UG` };
      if (n === 0) return { rank: 0, label: "EG" };
      return { rank: Math.min(n, 499), label: `${n}. OG` };
    }
  }
  const pure = s.match(RE_PURE_NUM);
  if (pure) {
    const n = Number(pure[1]);
    if (Number.isFinite(n)) {
      if (n < 0) return { rank: Math.max(n, -99), label: `${Math.abs(n)}. UG` };
      if (n === 0) return { rank: 0, label: "EG" };
      return { rank: Math.min(n, 499), label: `${n}. OG` };
    }
  }
  return { rank: 500, label: s };
}

const ALPHA = (a: string, b: string) =>
  a.localeCompare(b, "de", { numeric: true, sensitivity: "base" });

/// Comparateur universel : niveau d'abord (bas → haut), puis alphabétique
/// « naturel » allemand (OG 2 avant OG 10). Stable par clé tertiaire index.
export function compareByLevelThenName(
  aLevel: string | null | undefined,
  aName: string | null | undefined,
  bLevel: string | null | undefined,
  bName: string | null | undefined,
): number {
  const ka = levelKey(aLevel);
  const kb = levelKey(bLevel);
  let d = ka.rank - kb.rank;
  if (d !== 0) return d;
  d = ALPHA(ka.label, kb.label);
  if (d !== 0) return d;
  return ALPHA(aName ?? "", bName ?? "");
}

/// Tri prêt à l'emploi : retourne une NOUVELLE liste triée niveau puis nom.
export function sortByLevelName<T>(
  items: readonly T[],
  level: (t: T) => string | null | undefined,
  name: (t: T) => string | null | undefined,
): T[] {
  return items
    .map((t, index) => ({ t, index }))
    .sort((x, y) => {
      const d = compareByLevelThenName(
        level(x.t), name(x.t),
        level(y.t), name(y.t),
      );
      return d !== 0 ? d : x.index - y.index;
    })
    .map(({ t }) => t);
}

/// Ordre alphabétique « naturel » seul (listes sans notion de niveau).
export function compareAlpha(a: string | null | undefined, b: string | null | undefined): number {
  return ALPHA(a ?? "", b ?? "");
}
