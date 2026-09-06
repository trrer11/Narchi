/**
 * §95 — « Preis-Spiegel » : offre réelle → Preisbibliothek du bureau.
 * Décisions PURES testées : chemin REST, mapping défensif de la réponse,
 * message de fin ALLEMAND exact (pluriels corrects, jamais de promesse
 * en plus — le prix vaut à sa date d'offre, l'index Destatis fait suite).
 */

export interface LibraryTakeover {
  inserted: number;      // nouvelles lignes dans la bibliothèque
  updated: number;       // lignes existantes remplacées (dernier prix réel)
  skipped: number;       // ohne EP / OZ double/vide / plausibilité — dit
  preisstandJahr: number; // année de l'offre = millésime du prix
  skippedVeraltet: number; // §97 — millésime plus ancien refusé (dit)
}

/// Chemin REST (même origine, cookie de session seul).
export function offerToLibraryPath(room: string, offerId: string): string {
  return (
    `/api/v5/collab/${encodeURIComponent(room)}/offers/` +
    `${encodeURIComponent(offerId)}/to-library`
  );
}

function _int(v: unknown, min = 0): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= min ? v : null;
}

/// Réponse serveur → LibraryTakeover ; null si forme hostile.
/// `skipped_veraltet` (§97) est OPTIONNEL : absent chez un vieux serveur
/// → 0 ; présent et hostile → null (jamais de compteur affiché au hasard).
export function libraryTakeoverOf(raw: unknown): LibraryTakeover | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const inserted = _int(r.inserted);
  const updated = _int(r.updated);
  const skipped = _int(r.skipped);
  const preisstandJahr = _int(r.preisstand_jahr, 1900);
  if (inserted === null || updated === null || skipped === null || preisstandJahr === null) {
    return null;
  }
  let skippedVeraltet = 0;
  if ("skipped_veraltet" in r) {
    const v = _int(r.skipped_veraltet);
    if (v === null) return null;
    skippedVeraltet = v;
  }
  return { inserted, updated, skipped, preisstandJahr, skippedVeraltet };
}

function _plural(n: number, ein: string, mehrere: string): string {
  return n === 1 ? `1 ${ein}` : `${n} ${mehrere}`;
}

/// Message de fin affiché tel quel — factuel, complet sur les 3 compteurs.
export function libraryTakeoverText(t: LibraryTakeover): string {
  const prisEnCharge = t.inserted + t.updated;
  const parts: string[] = [];
  if (t.updated > 0) {
    parts.push(`${_plural(t.updated, "vorhandener", "vorhandene")} ersetzt`);
  }
  if (t.skipped > 0) {
    parts.push(`${_plural(t.skipped, "Position", "Positionen")} ohne EP übersprungen`);
  }
  if (t.skippedVeraltet > 0) {
    parts.push(
      `${_plural(t.skippedVeraltet, "Position", "Positionen")} mit älterem ` +
      `Preisstand verworfen (neuere bleiben)`,
    );
  }
  const details = parts.length ? ` — ${parts.join(", ")}` : "";
  return (
    `${_plural(prisEnCharge, "Position", "Positionen")} mit echten EP in die ` +
    `Preisbibliothek übernommen (Preisstand ${t.preisstandJahr})${details}. ` +
    `Fortschreibung mit Destatis-Index wie bei allen Büropreisen.`
  );
}
