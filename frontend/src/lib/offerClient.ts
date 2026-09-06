/**
 * §91 — Offres d'entreprises (GAEB entrant) : décisions PURES testées.
 * Le câblage réseau vit dans le composant — ici : mapping défensif
 * (jamais de donnée aveugle), centimes → affichage, erreurs honnêtes.
 */

export interface OfferMeta {
  id: string;
  companyName: string;
  filename: string;
  dp: string;            // phase GAEB lue — « 31 »/« 83 »/… affichée telle quelle
  cur: string;
  itemCount: number;
  ohnePreisCount: number; // positions sans prix — montrées, jamais cachées
  gpTotalCents: number;   // somme EXACTE en centimes entiers
  createdByName: string | null;
  createdAt: string | null;
}

export interface OfferItem {
  oz: string;            // OZ GAEB paddée (REB 23.003)
  title: string;
  qty: number;
  unit: string;
  upCents: number | null;
  itCents: number | null;
}

function _str(v: unknown, max = 500): string | null {
  return typeof v === "string" ? v.slice(0, max) : null;
}
function _int(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/// Ligne serveur → OfferMeta ; null si forme hostile (aucune exception).
export function offerMetaOf(raw: unknown): OfferMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = _str(r.id, 64);
  const companyName = _str(r.company_name, 200);
  const itemCount = _int(r.item_count);
  const ohnePreisCount = _int(r.ohne_preis_count);
  const gpTotalCents = _int(r.gp_total_cents);
  if (!id || !companyName || itemCount === null || ohnePreisCount === null || gpTotalCents === null) {
    return null;
  }
  return {
    id,
    companyName,
    filename: _str(r.filename, 200) ?? "",
    dp: _str(r.dp, 4) ?? "31",
    cur: _str(r.cur, 4) ?? "EUR",
    itemCount,
    ohnePreisCount,
    gpTotalCents,
    createdByName: _str(r.created_by_name, 140),
    createdAt: _str(r.created_at, 40),
  };
}

export function offerItemOf(raw: unknown): OfferItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const oz = _str(r.oz, 64);
  const qty = typeof r.qty === "number" && Number.isFinite(r.qty) && r.qty >= 0 ? r.qty : null;
  if (!oz || qty === null) return null;
  return {
    oz,
    title: _str(r.title, 300) ?? "",
    qty,
    unit: _str(r.unit, 12) ?? "",
    upCents: _int(r.up_cents),
    itCents: _int(r.it_cents),
  };
}

/// Centimes entiers → montant affiché (format allemand via lvOps).
export function eurFromCents(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/// Erreurs d'upload : detail serveur (refus motivé du parseur) prioritaire.
export function offerErrorMessage(status: number, detail: string | null): string {
  if (detail) return detail;
  if (status === 422) return "Angebot abgelehnt — Datei bitte prüfen.";
  if (status === 404) return "Angebot nicht gefunden.";
  return `Angebot-Import fehlgeschlagen (HTTP ${status}).`;
}
