// §177 — Entscheidungslog : la communication client devient une PISTE écrite.
//
// LE point de douleur n°2 des architectes (rapport benchmark A&E 2025 :
// « client communication and approvals were ranked the top time wasters by
// over a third of respondents ») : « courir après les validations » vole des
// heures, et sans trace écrite, chaque désaccord (« tu ne m'as jamais dit ça »)
// devient un litige. La réponse pro : un JOURNAL DE DÉCISIONS — chaque décision
// client est datée, sourcée (réunion/e-mail/téléphone), avec un statut
// (proposée/validée/refusée/renvoyée), et un PROTOKOLL généré qui fait foi.
//
// Ce journal est le fondement juridique du NACHTRAG (§176) : « le client a
// validé le changement X le <date> » = la justification d'une facturation
// supplémentaire.
//
// HONNÊTETÉ (charta §36) : c'est un outil de TRACABILITÉ, pas un avis — le
// protocole rappelle qu'il est « erstellt aus dem Entscheidungslog » et que la
// source (e-mail/CR de réunion) reste la pièce probante.

export type EntscheidungStatus = "vorgeschlagen" | "freigegeben" | "abgelehnt" | "vertagt";
export type EntscheidungQuelle = "besprechung" | "email" | "telefon" | "baubesprechung";

export interface Entscheidung {
  id: string;
  projektId: string;
  /** Sujet court (« Ausbau des Dachbodens »). */
  thema: string;
  /** Détail de la décision. */
  beschreibung: string;
  status: EntscheidungStatus;
  quelle: EntscheidungQuelle;
  /** ISO date (« 2026-08-17 »). */
  datum: string;
  /** Qui a proposé / qui suit le dossier. */
  verantwortlich: string;
}

export const STATUS_META: Record<EntscheidungStatus, { label: string; tone: "amber" | "emerald" | "rose" | "slate" }> = {
  vorgeschlagen: { label: "Vorgeschlagen", tone: "amber" },
  freigegeben: { label: "Freigegeben", tone: "emerald" },
  abgelehnt: { label: "Abgelehnt", tone: "rose" },
  vertagt: { label: "Vertagt", tone: "slate" },
};

export const QUELLE_LABEL: Record<EntscheidungQuelle, string> = {
  besprechung: "Besprechung",
  email: "E-Mail",
  telefon: "Telefonat",
  baubesprechung: "Baubesprechung",
};

export const ENTSCH_STORAGE_KEY = "narchi:entscheidungslog";

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function isEntscheidung(x: unknown): x is Entscheidung {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as Entscheidung).id === "string" &&
    typeof (x as Entscheidung).thema === "string"
  );
}

export function listEntscheidungen(storage: Storage | null = defaultStorage()): Entscheidung[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(ENTSCH_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isEntscheidung) : [];
  } catch {
    return [];
  }
}

function persist(list: Entscheidung[], storage: Storage | null): void {
  if (!storage) return;
  try {
    storage.setItem(ENTSCH_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // quota / mode privé : dégradation silencieuse.
  }
}

export function makeEntscheidung(
  input: Omit<Entscheidung, "id" | "datum">,
  now: Date = new Date(),
): Entscheidung {
  return {
    ...input,
    id: `entsch-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    datum: now.toISOString().slice(0, 10),
  };
}

export function addEntscheidung(
  e: Entscheidung,
  storage: Storage | null = defaultStorage(),
): Entscheidung[] {
  const next = [e, ...listEntscheidungen(storage)];
  persist(next, storage);
  return next;
}

export function removeEntscheidung(
  id: string,
  storage: Storage | null = defaultStorage(),
): Entscheidung[] {
  const next = listEntscheidungen(storage).filter((e) => e.id !== id);
  persist(next, storage);
  return next;
}

export function setEntscheidungStatus(
  id: string,
  status: EntscheidungStatus,
  storage: Storage | null = defaultStorage(),
): Entscheidung[] {
  const next = listEntscheidungen(storage).map((e) =>
    e.id === id ? { ...e, status } : e,
  );
  persist(next, storage);
  return next;
}

/** Décisions EN SOUFFRANCE (proposées ou renvoyées) = ce qui vole du temps. */
export function offeneEntscheidungen(list: Entscheidung[]): Entscheidung[] {
  return list.filter((e) => e.status === "vorgeschlagen" || e.status === "vertagt");
}

/** Décisions d'un projet, triées plus récent d'abord. */
export function migriereEntscheidungenProjektId(
  list: Entscheidung[],
  nachId: string,
): { list: Entscheidung[]; geaendert: number } {
  if (!nachId || nachId === LEGACY_ENTSCH_PROJEKT) return { list, geaendert: 0 };
  let geaendert = 0;
  const next = list.map((e) => {
    if (e.projektId !== LEGACY_ENTSCH_PROJEKT) return e;
    geaendert += 1;
    return { ...e, projektId: nachId };
  });
  return { list: next, geaendert };
}

export function entscheidungenFuerProjekt(
  list: Entscheidung[],
  projektId: string,
): Entscheidung[] {
  return list
    .filter((e) => e.projektId === projektId)
    .sort((a, b) => (a.datum < b.datum ? 1 : -1));
}

/** Le PROTOKOLL (allemand) : la trace écrite qui fait foi. */
export function entscheidungsProtokoll(
  list: Entscheidung[],
  projektName: string,
): string {
  const sorted = [...list].sort((a, b) => (a.datum < b.datum ? 1 : -1));
  const lines: string[] = [
    `Entscheidungsprotokoll — ${projektName}`,
    `Erstellt aus dem Entscheidungslog (die Quelle — E-Mail / Besprechungsprotokoll — bleibt das maßgebliche Belegstück).`,
    "",
  ];
  if (sorted.length === 0) {
    lines.push("(noch keine Entscheidungen erfasst)");
  }
  for (const e of sorted) {
    lines.push(
      `${e.datum} · ${e.thema} — ${STATUS_META[e.status].label} (${QUELLE_LABEL[e.quelle]})`,
      `  ${e.beschreibung} [Verantwortlich: ${e.verantwortlich || "—"}]`,
    );
  }
  return lines.join("\n");
}
