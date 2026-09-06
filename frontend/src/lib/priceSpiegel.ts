/**
 * §96 — Preisspiegel (min/Median/max des observations réelles) :
 * décisions PURES testées. Mapping défensif (jamais d'exception sur de
 * la forme hostile), étiquettes allemandes exactes, étendue en % une
 * décimale contre la médiane — affichée telle quelle, sans promesse.
 */
import { eurFromCents } from "./offerClient";

/// Chemin REST (même origine, cookie de session seul).
export const SPIEGEL_PATH = "/api/v5/office-prices/spiegel";

export interface SpiegelItem {
  oz: string;
  kurztext: string;
  einheit: string;
  n: number;
  minCents: number;
  medianCents: number | null;
  maxCents: number;
  latestEpCents: number;
  latestCompany: string;
  latestJahr: number;
  latestSource: string;
  minJahr: number;      // §97 — plus ancien millésime observé (brut)
  maxJahr: number;      // §97 — plus récent ; ≠ min ⇒ années dites
}

function _int(v: unknown, min = 0): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= min ? v : null;
}
function _str(v: unknown, max = 500): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/// Ligne serveur → SpiegelItem ; null si forme hostile.
export function spiegelItemOf(raw: unknown): SpiegelItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = _int(r.n, 2);           // le serveur ne sert que n ≥ 2 — ici pareil
  const minCents = _int(r.min_cents);
  const maxCents = _int(r.max_cents);
  const latestEpCents = _int(r.latest_ep_cents);
  const latestJahr = _int(r.latest_jahr, 1900);
  const minJahr = _int(r.min_jahr, 1900);
  const maxJahr = _int(r.max_jahr, 1900);
  const oz = typeof r.oz === "string" && r.oz ? r.oz.slice(0, 64) : null;
  if (!oz || n === null || minCents === null || maxCents === null ||
      latestEpCents === null || latestJahr === null ||
      minJahr === null || maxJahr === null) {
    return null;
  }
  const medianRaw = r.median_cents;
  const medianCents =
    typeof medianRaw === "number" && Number.isInteger(medianRaw) && medianRaw >= 0
      ? medianRaw
      : null;
  return {
    oz,
    kurztext: _str(r.kurztext, 300),
    einheit: _str(r.einheit, 24),
    n,
    minCents,
    medianCents,
    maxCents,
    latestEpCents,
    latestCompany: _str(r.latest_company, 200),
    latestJahr,
    latestSource: _str(r.latest_source, 255),
    minJahr,
    maxJahr,
  };
}

/// §97 — années du lot : une seule → « Jahrgang 2026 » ; plusieurs →
/// « Jahrgänge 2018–2026, Rohwerte — nicht indexiert ». Dit, jamais caché.
export function jahrgangText(minJahr: number, maxJahr: number): string {
  if (minJahr === maxJahr) return `Jahrgang ${minJahr}`;
  return `Jahrgänge ${minJahr}–${maxJahr} · Rohwerte, nicht indexiert`;
}

/// Vrai si le lot mélange des années (l'écran peut le marquer visuellement).
export function hatGemischteJahrgaenge(minJahr: number, maxJahr: number): boolean {
  return minJahr !== maxJahr;
}

export { eurFromCents };

export interface SpiegelResponse {
  items: SpiegelItem[];
  totalObservations: number;
  singleOzCount: number;
  capped: boolean;
  hinweis: string;
}

/// Réponse serveur → SpiegelResponse ; lignes pourries FILTRÉES (défensif).
export function spiegelResponseOf(raw: unknown): SpiegelResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const totalObservations = _int(r.total_observations);
  const singleOzCount = _int(r.single_oz_count);
  if (totalObservations === null || singleOzCount === null) return null;
  const items = (Array.isArray(r.items) ? r.items : [])
    .map(spiegelItemOf)
    .filter((i): i is SpiegelItem => i !== null);
  return {
    items,
    totalObservations,
    singleOzCount,
    capped: r.capped === true,
    hinweis: _str(r.hinweis, 600),
  };
}

/// « 2 Beobachtungen » — pluriel allemand correct (n ≥ 2 ici, mais exact).
export function beobachtungenLabel(n: number): string {
  return n === 1 ? "1 Beobachtung" : `${n} Beobachtungen`;
}

/// Étendue vs médiane, 1 décimale, signe explicite : « −12,4 % bis +7,2 % ».
/// null si pas de médiane/médiane nulle — jamais de pourcentage sans base.
export function streuungText(
  minCents: number,
  medianCents: number | null,
  maxCents: number,
): string | null {
  if (medianCents === null || medianCents <= 0) return null;
  const pct = (v: number) =>
    (((v - medianCents) / medianCents) * 100)
      .toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const lo = pct(minCents);
  const hi = pct(maxCents);
  return `${lo.startsWith("-") ? lo : `+${lo}`} % bis ${hi.startsWith("-") ? hi : `+${hi}`} %`;
}

/// Sous-titre d'ensemble honnête : ce que l'écran ne montre PAS est dit.
export function spiegelSubline(singleOzCount: number, capped: boolean): string {
  const parts: string[] = [];
  if (singleOzCount > 0) {
    parts.push(
      singleOzCount === 1
        ? "1 Position mit nur einer Beobachtung (kein Median — zu wenig Daten)"
        : `${singleOzCount} Positionen mit je nur einer Beobachtung (kein Median — zu wenig Daten)`,
    );
  }
  if (capped) parts.push("Anzeige begrenzt — Rest im Detail ansehen");
  return parts.join(" · ");
}
