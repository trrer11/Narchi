// §179 — Mahnwesen : le recouvrement des factures impayées, automatisé.
//
// Point de douleur mesuré (benchmark A&E 2025 : « 51 % collect client payments
// within 31–60 days » ; « billing delays … receivables drift ») : les
// architectes travaillent, facturent… et ne sont PAS payés à temps. Chaque
// facture qui traîne est de l'argent réel immobilisé. Ce moteur :
//
//   - suit le STATUT DE PAIEMENT par facture (offen / bezahlt), persistant ;
//   - détecte les factures ÉCHUES (due_date dépassée, émise, non payée) ;
//   - détermine la MAHNSTUFE (1 / 2 / 3) selon l'ancienneté de l'échéance ;
//   - génère la MAHNUNG (lettre de relance) en allemand : montant dû, intérêts
//     de retard (Verzugszins § 288 BGB), frais de relance (Mahngebühren), et le
//     rappel que la dette porte intérêt.
//
// HONNÊTETÉ (charta §36) : les taux et frais sont des RICHTWERTE, marqués
// comme tels — le Basiszinssatz varie (fixé par la Bundesbank) et les
// Mahngebühren sont libres (mais usuelles). C'est un OUTIL de relance, pas un
// avis juridique : le texte le dit explicitement.

export type ZahlungsStatus = "offen" | "bezahlt";

/** Facture minimale nécessaire au Mahnwesen (sous-ensemble du modèle Invoice). */
export interface MahnbareRechnung {
  id: string;
  rechnungsnummer: string | null;
  buyer_name: string;
  buyer_street: string;
  buyer_zip: string;
  buyer_city: string;
  total_brut: string;
  due_date: string | null;
  issued_at: string | null;
}

/** Une facture avec son état de recouvrement calculé. */
export interface Mahnstatus {
  rechnung: MahnbareRechnung;
  status: ZahlungsStatus;
  /** Jours de retard (0 = pas encore échue, >0 = en retard). */
  tageUeberfaellig: number;
  /** null si pas échue. */
  stufe: 1 | 2 | 3 | null;
  /** Montant brut dû (€, nombre). */
  betragBrut: number;
}

// ---------------------------------------------------------------------------
// Persistance du statut de paiement (localStorage, clé par facture).
// ---------------------------------------------------------------------------

export const ZAHLUNGS_KEY = "narchi:mahnwesen:zahlungen";

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function ladeZahlungen(storage: Storage | null = defaultStorage()): Record<string, ZahlungsStatus> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(ZAHLUNGS_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as unknown;
    if (typeof p !== "object" || p === null) return {};
    const out: Record<string, ZahlungsStatus> = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (v === "bezahlt" || v === "offen") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function setzeZahlung(
  id: string,
  status: ZahlungsStatus,
  storage: Storage | null = defaultStorage(),
): Record<string, ZahlungsStatus> {
  const next = { ...ladeZahlungen(storage), [id]: status };
  if (storage) {
    try {
      storage.setItem(ZAHLUNGS_KEY, JSON.stringify(next));
    } catch {
      // quota / mode privé : dégradation silencieuse.
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Calcul du statut (pur, testable).
// ---------------------------------------------------------------------------

export const STUFEN = [
  { stufe: 1 as const, maxTage: 14, gebuehr: 2.5, label: "1. Mahnung" },
  { stufe: 2 as const, maxTage: 29, gebuehr: 5.0, label: "2. Mahnung" },
  { stufe: 3 as const, maxTage: Infinity, gebuehr: 10.0, label: "3. Mahnung (letzte)" },
];

/** Basezinssatz (Bundesbank) + marge §288 BGB. RICHTWERT, dit. */
export const VERZUGSZINS_BASIS = 3.62; // % p.a. (Richtwert, varie)
export const VERZUGSZINS_MARGE_GESCHAEFT = 9.0; // §288 Abs. 2 BGB (B2B)

function parseBrut(s: string): number {
  const n = Number.parseFloat(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function tageSeit(dateStr: string, now: Date): number {
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return 0;
  const ms = now.getTime() - d.getTime();
  return Math.floor(ms / 86400000);
}

export function mahnstufeFuer(tageUeberfaellig: number): 1 | 2 | 3 | null {
  if (tageUeberfaellig <= 0) return null;
  for (const s of STUFEN) {
    if (tageUeberfaellig <= s.maxTage) return s.stufe;
  }
  return 3;
}

/** Statut de recouvrement d'UNE facture. */
export function mahnstatus(
  rechnung: MahnbareRechnung,
  zahlungen: Record<string, ZahlungsStatus>,
  now: Date = new Date(),
): Mahnstatus {
  const status = zahlungen[rechnung.id] ?? "offen";
  const due = rechnung.due_date;
  const tageUeberfaellig =
    status === "bezahlt" || !due ? 0 : Math.max(0, tageSeit(due, now));
  return {
    rechnung,
    status,
    tageUeberfaellig,
    stufe: status === "bezahlt" ? null : mahnstufeFuer(tageUeberfaellig),
    betragBrut: parseBrut(rechnung.total_brut),
  };
}

/** Toutes les factures ÉCHUES et impayées, les plus en retard d'abord. */
export function ueberfaelligeRechnungen(
  rechnungen: MahnbareRechnung[],
  zahlungen: Record<string, ZahlungsStatus>,
  now: Date = new Date(),
): Mahnstatus[] {
  return rechnungen
    .map((r) => mahnstatus(r, zahlungen, now))
    .filter((s) => s.status === "offen" && s.stufe !== null)
    .sort((a, b) => b.tageUeberfaellig - a.tageUeberfaellig);
}

/** Somme brute totale échue (€). */
export function summeOffen(list: Mahnstatus[]): number {
  return list.reduce((s, x) => s + x.betragBrut, 0);
}

/** Intérêts de retard (Verzugszins) estimés pour une facture. RICHTWERT. */
export function verzugszins(betragBrut: number, tageUeberfaellig: number): number {
  if (tageUeberfaellig <= 0 || betragBrut <= 0) return 0;
  const zinsPct = VERZUGSZINS_BASIS + VERZUGSZINS_MARGE_GESCHAEFT;
  const zins = (betragBrut * (zinsPct / 100) * tageUeberfaellig) / 365;
  return Math.round(zins * 100) / 100;
}

/** La MAHNUNG (lettre de relance) en allemand. */
export function mahnungText(
  s: Mahnstatus,
  now: Date = new Date(),
): string {
  const stufe = s.stufe ?? 1;
  const meta = STUFEN[stufe - 1];
  const zins = verzugszins(s.betragBrut, s.tageUeberfaellig);
  const kopf = `${meta.label} — Rechnung ${s.rechnung.rechnungsnummer ?? "ohne Nummer"}`;
  const zeilen: string[] = [
    kopf,
    `Erstellt am ${now.toLocaleDateString("de-DE")} (Richtwerte — kein Rechtsrat).`,
    "",
    `An: ${s.rechnung.buyer_name}, ${s.rechnung.buyer_street}, ${s.rechnung.buyer_zip} ${s.rechnung.buyer_city}`,
    "",
    `Sehr geehrte Damen und Herren,`,
    "",
    `unsere Rechnung ${s.rechnung.rechnungsnummer ?? ""} vom ${s.rechnung.issued_at ?? "—"} über ` +
      `${s.betragBrut.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € brutto ` +
      `war am ${s.rechnung.due_date ?? "—"} fällig und ist bis heute (${s.tageUeberfaellig} Tage überfällig) nicht beglichen.`,
    "",
    `Wir bitten um Überweisung des ausstehenden Betrags innerhalb von 7 Tagen. ` +
      `Nach Eintritt des Verzugs fallen Verzugszinsen nach § 288 BGB an ` +
      `(Richtwert derzeit ${zins.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € ` +
      `bei ${VERZUGSZINS_BASIS + VERZUGSZINS_MARGE_GESCHAEFT} % p.a.) sowie Mahngebühren in Höhe von ` +
      `${meta.gebuehr.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €.`,
    "",
    "Sollte die Zahlung bereits veranlasst sein, betrachten Sie dieses Schreiben als gegenstandslos.",
    "",
    "Mit freundlichen Grüßen",
  ];
  return zeilen.join("\n");
}
