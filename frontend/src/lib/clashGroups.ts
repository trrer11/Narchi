// NARCHI V6.7 — Befundgruppen du radar de collision.
// Inspiration open-source (§36) : les outils façon « clash grouping »
// (Solibri / Navisworks / clashero) NE listent JAMAIS des milliers de
// PAIRES brutes — ils regroupent les collisions en CONSTATS exploitables
// (« Befund ») par signature de classes + foyer spatial. C'est exactement
// ce que fait ce module :
//
//   1) SIGNATURE — les deux classes IFC canonisées (WAND × DECKE, …) :
//      un « mur traverse une dalle dans la cage d'escalier » = UN constat,
//      pas 47 lignes.
//   2) FOYER — union-find spatial : les collisions de même signature dont
//      les hotspots exacts distent de moins de `linkRadius` fondent en un
//      seul groupe (chaînage transitif : le long d'un mur, tout fusionne).
//   3) WHITELIST « Anschluss » — les recouvrements INTENTIONNELS d'un
//      export IFC bien modélisé (fenêtre posée dans SON mur, Stütze qui
//      porte la dalle, joint d'angle mur/mur de ≤ 30 cm) sont des
//      connexions, pas des collisions. Elles sont mises à part, comptées
//      et ré-affichables en un clic — JAMAIS supprimées en silence.
//
// Valeur bureau : 17 162 paires → ~quelques dizaines de constats triés
// (sévérité → nombre → alphabétique), chacun cliquable vers le focus 3D
// chirurgical (hotspot rouge + murs teintés, §33).

import type { BuildingElement } from "@/data/types";
import type { Clash } from "@/lib/planpruefung";
import { levelKey } from "@/lib/levelSort";

// ---------------------------------------------------------------------------
// Classes canoniques (affichage allemand — marché visé)
// ---------------------------------------------------------------------------

export type ClashClass =
  | "WAND"
  | "DECKE"
  | "STUETZE"
  | "TRAEGER"
  | "TREPPE"
  | "FENSTER"
  | "TUER"
  | "DACH"
  | "ROHRLEITUNG"
  | "LUFTKANAL"
  | "ELEKTRO"
  | "SONSTIGES";

export const CLASH_CLASS_LABEL: Record<ClashClass, string> = {
  WAND: "Wand",
  DECKE: "Decke/Gründung",
  STUETZE: "Stütze",
  TRAEGER: "Träger/Unterzug",
  TREPPE: "Treppe/Rampe",
  FENSTER: "Fenster",
  TUER: "Tür",
  DACH: "Dach",
  ROHRLEITUNG: "Rohrleitung",
  LUFTKANAL: "Luftkanal",
  ELEKTRO: "Elektrotrasse",
  SONSTIGES: "Sonstiges Bauteil",
};

/// Canonise un type IFC (« IfcWallStandardCase », « IFCFLOWSEGMENT »…) en
/// classe de constat. Tolérant à la casse, jamais d'exception.
export function canonicalClass(rawType: string | null | undefined): ClashClass {
  const t = (rawType ?? "").toUpperCase();
  // Ordre des tests significatif (CURTAINWALL avant WALL).
  if (t.includes("CURTAINWALL") || t.includes("WALL")) return "WAND";
  if (t.includes("COLUMN")) return "STUETZE";
  if (t.includes("BEAM") || t.includes("MEMBER")) return "TRAEGER";
  if (t.includes("SLAB") || t.includes("FOOTING") || t.includes("FOUNDATION") || t.includes("PILE") || t.includes("PLATE")) return "DECKE";
  if (t.includes("STAIR") || t.includes("RAMP")) return "TREPPE";
  if (t.includes("WINDOW")) return "FENSTER";
  if (t.includes("DOOR")) return "TUER";
  if (t.includes("ROOF")) return "DACH";
  if (t.includes("DUCT") || t.includes("AIRTERMINAL")) return "LUFTKANAL";
  if (t.includes("PIPE") || t.includes("FLOWSEGMENT") || t.includes("FLOWFITTING") || t.includes("SANITARY")) return "ROHRLEITUNG";
  if (t.includes("CABLE") || t.includes("ELECTRIC") || t.includes("SWITCH") || t.includes("LIGHT") || t.includes("OUTLET")) return "ELEKTRO";
  return "SONSTIGES";
}

// ---------------------------------------------------------------------------
// Whitelist « Anschluss » — recouvrements intentionnels d'une maquette IFC
// ---------------------------------------------------------------------------

export interface ConnectionFilter {
  /** Whitelist active (défaut oui, désactivation en un clic). */
  enabled: boolean;
  /** Pénétration maximale (m) d'un « flacher Anschluss » structural. */
  maxJoinDepthM: number;
}

export const DEFAULT_CONNECTION_FILTER: ConnectionFilter = {
  enabled: true,
  // 30 cm : couvre les dalles usuelles (18–30 cm) et joints mur/mur courants.
  // Réglable au bureau (curseur 0,10–0,60 m) ; le compteur reste visible.
  maxJoinDepthM: 0.3,
};

export type ConnectionKind = "oeffnung" | "anschluss" | null;

export interface ConnectionVerdict {
  /** Le clash est-il une connexion intentionnelle (à mettre à part) ? */
  isConnection: boolean;
  /** Raison documentée pour le badge/UI (jamais silencieux). */
  kind: ConnectionKind;
  reason: string | null;
}

/// Paires « Öffnung » : une Fenster/Tür recouvre SON mur ou SA dalle —
/// c'est la définition d'une ouverture de bâtiment, pas une collision.
function isOpeningPair(a: ClashClass, b: ClashClass): boolean {
  const opening = a === "FENSTER" || a === "TUER" || b === "FENSTER" || b === "TUER";
  const host = a === "WAND" || a === "DECKE" || b === "WAND" || b === "DECKE";
  return opening && host;
}

/// Paires structurelles dont un ANCRAGE PLAT (joint, appui) est le cas
/// normal : Stütze porte Decke, mur sous dalle, angle mur/mur…
const STRUCTURAL_JOIN_PAIRS = new Set([
  "DECKE×STUETZE",
  "DECKE×TRAEGER",
  "DECKE×TREPPE",
  "DECKE×WAND",
  "DECKE×DECKE",
  "STUETZE×TRAEGER",
  "STUETZE×WAND",
  "TRAEGER×WAND",
  "TRAEGER×TRAEGER",
  "WAND×WAND",
]);

function joinPairKey(a: ClashClass, b: ClashClass): string {
  return [a, b].sort((x, y) => x.localeCompare(y)).join("×");
}

/**
 * Classe un clash : collision réelle (à traiter) ou connexion intentionnelle
 * (à mettre à part). Règles publiques, conservatrices :
 *   - fenêtre/porte dans mur/dalle → TOUJOURS une ouverture ;
 *   - paire structurale ET pénétration la plus fine ≤ maxJoinDepthM →
 *     « flacher Anschluss » (une tuyauterie qui traverse une dalle reste une
 *     VRAIE collision : la paire n'est pas structurale) ;
 *   - tout le reste → collision.
 */
export function classifyConnection(
  clash: Clash,
  classA: ClashClass,
  classB: ClashClass,
  filter: ConnectionFilter = DEFAULT_CONNECTION_FILTER,
): ConnectionVerdict {
  if (clash.type === "clearance") return { isConnection: false, kind: null, reason: null };
  if (!filter.enabled) return { isConnection: false, kind: null, reason: null };

  if (isOpeningPair(classA, classB)) {
    return {
      isConnection: true,
      kind: "oeffnung",
      reason: `${CLASH_CLASS_LABEL[classA]} × ${CLASH_CLASS_LABEL[classB]} — vorgesehene Öffnung`,
    };
  }

  if (STRUCTURAL_JOIN_PAIRS.has(joinPairKey(classA, classB))) {
    const minPenetration = Math.min(clash.overlap[0], clash.overlap[1], clash.overlap[2]);
    if (minPenetration <= filter.maxJoinDepthM) {
      return {
        isConnection: true,
        kind: "anschluss",
        reason: `Flacher Anschluss ${Math.round(minPenetration * 1000)} mm ≤ ${Math.round(filter.maxJoinDepthM * 1000)} mm`,
      };
    }
  }

  return { isConnection: false, kind: null, reason: null };
}

/// Sépare un radar brut : { real, connections } — les connexions restent
/// comptées et listables (honnêteté), elles ne disparaissent pas.
export function splitConnections(
  clashes: Clash[],
  classOf: (clash: Clash) => [ClashClass, ClashClass],
  filter: ConnectionFilter = DEFAULT_CONNECTION_FILTER,
): { real: Clash[]; connections: { clash: Clash; verdict: ConnectionVerdict }[] } {
  const real: Clash[] = [];
  const connections: { clash: Clash; verdict: ConnectionVerdict }[] = [];
  for (const clash of clashes) {
    const [a, b] = classOf(clash);
    const verdict = classifyConnection(clash, a, b, filter);
    if (verdict.isConnection) connections.push({ clash, verdict });
    else real.push(clash);
  }
  return { real, connections };
}

// ---------------------------------------------------------------------------
// Regroupement en Befundgruppen (signature × foyer spatial)
// ---------------------------------------------------------------------------

export interface ClashGroup {
  /** Identifiant stable après tri : « BG-01 », « BG-02 »… */
  id: string;
  /** Titre de constat, ex. « Wand × Decke/Gründung ». */
  title: string;
  classes: [ClashClass, ClashClass];
  /** Sévérité MAXIMALE du groupe (règle Solibri : le pire pilote). */
  severity: Clash["severity"];
  /** Nombre de paires de collision fondues dans ce constat. */
  count: number;
  clashes: Clash[];
  collisionIds: string[];
  /** Étages touchés, triés règle bureau (cave → EG → OG → Dach). */
  levels: string[];
  /** Barycentre des hotspots — centre du foyer 3D. */
  centroid: [number, number, number];
  /** Pénétration typique (médiane par axe, en m). */
  typicalOverlap: [number, number, number];
  /** Collision « porte-parole » : la pire, puis la plus volumineuse. */
  representative: Clash;
}

export interface GroupOptions {
  /** Rayon de foyers (m) : deux hotspots à moins de cette distance = même constat. */
  linkRadius?: number;
}

const SEVERITY_RANK: Record<Clash["severity"], number> = { critical: 0, major: 1, minor: 2 };

/// Fabrique le `classOf` standard depuis la liste des Bauteiles (QC page) :
/// clash.elementA/B sont les ids internes, el.type porte la classe IFC.
export function classOfElements(
  elementOf: (id: string) => BuildingElement | undefined,
): (clash: Clash) => [ClashClass, ClashClass] {
  return (clash) => [
    canonicalClass(elementOf(clash.elementA)?.type),
    canonicalClass(elementOf(clash.elementB)?.type),
  ];
}

/// Clé de foyer : cellule spatiale du hotspot (hash grille 3 m).
function cellOf(p: [number, number, number], cell: number): string {
  return `${Math.floor(p[0] / cell)}|${Math.floor(p[1] / cell)}|${Math.floor(p[2] / cell)}`;
}

/**
 * Regroupe les collisions réelles en constats exploitables.
 * Algorithme : bucket par signature, puis union-find spatial (grille hash —
 * O(n), tient 20 000+ collisions à l'aise ; mesuré par test de performance).
 */
export function groupClashes(
  clashes: Clash[],
  classOf: (clash: Clash) => [ClashClass, ClashClass],
  options: GroupOptions = {},
): ClashGroup[] {
  const linkRadius = options.linkRadius ?? 4;
  if (clashes.length === 0) return [];

  // 1) Signature triée (« DECKE×WAND » == « WAND×DECKE ») → buckets.
  const buckets = new Map<string, { classes: [ClashClass, ClashClass]; items: Clash[] }>();
  for (const clash of clashes) {
    const [a, b] = classOf(clash);
    const classes = (a.localeCompare(b) <= 0 ? [a, b] : [b, a]) as [ClashClass, ClashClass];
    const key = classes.join("×");
    const bucket = buckets.get(key);
    if (bucket) bucket.items.push(clash);
    else buckets.set(key, { classes, items: [clash] });
  }

  const groups: ClashGroup[] = [];

  for (const { classes, items } of buckets.values()) {
    // 2) Union-find spatial à l'intérieur de CHAQUE signature seulement :
    //    un mur-dalle et une gaine-dalle à la même place restent DEUX constats.
    const parent = items.map((_, i) => i);
    const find = (x: number): number => {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    };
    const union = (x: number, y: number) => { parent[find(x)] = find(y); };

    const cellSize = linkRadius;
    const grid = new Map<string, number[]>();
    items.forEach((clash, i) => {
      const [cx, cy, cz] = clash.hotspot.center;
      const gx = Math.floor(cx / cellSize);
      const gy = Math.floor(cy / cellSize);
      const gz = Math.floor(cz / cellSize);
      // 27 cellules voisines : les foyers à cheval sur une frontiere de
      // cellule fusionnent quand même (distance réelle testée ensuite).
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const near = grid.get(`${gx + dx}|${gy + dy}|${gz + dz}`);
            if (!near) continue;
            for (const j of near) {
              const [ox, oy, oz] = items[j].hotspot.center;
              const d2 = (cx - ox) ** 2 + (cy - oy) ** 2 + (cz - oz) ** 2;
              if (d2 <= linkRadius * linkRadius) union(i, j);
            }
          }
        }
      }
      const key = cellOf(clash.hotspot.center, cellSize);
      const list = grid.get(key);
      if (list) list.push(i);
      else grid.set(key, [i]);
    });

    // 3) Agrégats par racine.
    const byRoot = new Map<number, Clash[]>();
    items.forEach((clash, i) => {
      const root = find(i);
      const list = byRoot.get(root);
      if (list) list.push(clash);
      else byRoot.set(root, [clash]);
    });

    for (const members of byRoot.values()) {
      groups.push(buildGroup(classes, members));
    }
  }

  // 4) Tri bureau : sévérité (pire d'abord), puis taille décroissante,
  //    puis alphabétique naturel. Les ids BG-xx suivent CE tri (stables).
  groups.sort(
    (x, y) =>
      SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] ||
      y.count - x.count ||
      x.title.localeCompare(y.title, "de", { numeric: true }),
  );
  groups.forEach((g, i) => {
    g.id = `BG-${String(i + 1).padStart(2, "0")}`;
  });
  return groups;
}

function buildGroup(classes: [ClashClass, ClashClass], members: Clash[]): ClashGroup {
  // Représentant : sévérité la pire, à égalité la plus GROSSE zone
  // d'intersection (le constat le plus parlant), puis alphabétique.
  const representative = [...members].sort(
    (x, y) =>
      SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] ||
      y.overlap[0] * y.overlap[1] * y.overlap[2] - x.overlap[0] * x.overlap[1] * x.overlap[2] ||
      x.nameA.localeCompare(y.nameA, "de", { numeric: true }),
  )[0];

  const severity = representative.severity;

  const centroid: [number, number, number] = [0, 0, 0];
  const overlapAxis: [number[], number[], number[]] = [[], [], []];
  for (const c of members) {
    centroid[0] += c.hotspot.center[0] / members.length;
    centroid[1] += c.hotspot.center[1] / members.length;
    centroid[2] += c.hotspot.center[2] / members.length;
    overlapAxis[0].push(c.overlap[0]);
    overlapAxis[1].push(c.overlap[1]);
    overlapAxis[2].push(c.overlap[2]);
  }
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  // Membres triés règle bureau (pire d'abord, alpha naturel allemand).
  members.sort(
    (x, y) =>
      SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] ||
      x.nameA.localeCompare(y.nameA, "de", { numeric: true }) ||
      x.nameB.localeCompare(y.nameB, "de", { numeric: true }),
  );

  return {
    id: "", // attribué après le tri final
    title: `${CLASH_CLASS_LABEL[classes[0]]} × ${CLASH_CLASS_LABEL[classes[1]]}`,
    classes,
    severity,
    count: members.length,
    clashes: members,
    collisionIds: members.map((c) => c.id),
    levels: [], // renseignée par withGroupLevels (connaissance des Bauteile)
    centroid,
    typicalOverlap: [median(overlapAxis[0]), median(overlapAxis[1]), median(overlapAxis[2])],
    representative,
  };
}

/// Renseigne les étages touchés par chaque groupe à partir des Bauteiles
/// (règle bureau : tri cave → EG → OG → Dach ; « — » ignoré).
export function withGroupLevels(
  groups: ClashGroup[],
  elementOf: (id: string) => BuildingElement | undefined,
): ClashGroup[] {
  for (const group of groups) {
    const seen = new Set<string>();
    for (const c of group.clashes) {
      for (const id of [c.elementA, c.elementB]) {
        const level = elementOf(id)?.level;
        if (level && level !== "—" && level.trim() !== "") seen.add(level);
      }
    }
    group.levels = [...seen].sort((a, b) => {
      const ka = levelKey(a);
      const kb = levelKey(b);
      return ka.rank - kb.rank || ka.label.localeCompare(kb.label, "de", { numeric: true });
    });
  }
  return groups;
}
