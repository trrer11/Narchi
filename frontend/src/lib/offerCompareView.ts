/**
 * §92 — Angebotsvergleich : mapping défensif et décisions PURES de
 * présentation (couleurs de cellule, verdict). La matrice est calculée
 * côté serveur (offer_compare.py) — ici on ne devine rien, on affiche.
 */

import { eurFromCents } from "@/lib/offerClient";

export interface CompareCell {
  upCents: number | null;
  itCents: number | null;
  deltaPct: number | null;   // écart vs EP interne (1 décimale) — null sans base
}

export interface CompareRow {
  oz: string;
  title: string;
  qty: number;
  unit: string;
  internalUpCents: number | null;
  onlyInOffer: boolean;      // ligne ajoutée par l'entreprise — montrée
  cells: Record<string, CompareCell>;
  bestOfferId: string | null;
}

export interface CompareOffer {
  id: string;
  companyName: string;
  dp: string;
  ohneEp: number;
  missingInternal: number;
  complete: boolean;         // false → son total est une Teilsumme, marquée
  totalCents: number;
}

export interface CompareMatrix {
  rows: CompareRow[];
  offers: CompareOffer[];
  hinweis: string | null;
  duplicateInternalOz: number;
}

function _num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function _intOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}
function _str(v: unknown, max = 300): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export function compareMatrixOf(raw: unknown): CompareMatrix | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.rows) || !Array.isArray(r.offers)) return null;
  const offers: CompareOffer[] = [];
  for (const o of r.offers) {
    if (!o || typeof o !== "object") continue;
    const oo = o as Record<string, unknown>;
    const id = typeof oo.id === "string" ? oo.id : "";
    const totalCents = _intOrNull(oo.total_cents);
    if (!id || totalCents === null) continue;
    offers.push({
      id,
      companyName: _str(oo.company_name, 200),
      dp: _str(oo.dp, 4) || "31",
      ohneEp: _intOrNull(oo.ohne_ep) ?? 0,
      missingInternal: _intOrNull(oo.missing_internal) ?? 0,
      complete: oo.complete === true,
      totalCents,
    });
  }
  const rows: CompareRow[] = [];
  for (const w of r.rows) {
    if (!w || typeof w !== "object") continue;
    const ww = w as Record<string, unknown>;
    const cellsRaw = (ww.cells ?? {}) as Record<string, unknown>;
    const cells: Record<string, CompareCell> = {};
    for (const [offerId, c] of Object.entries(cellsRaw)) {
      if (!c || typeof c !== "object") continue;
      const cc = c as Record<string, unknown>;
      cells[offerId] = {
        upCents: _intOrNull(cc.up_cents),
        itCents: _intOrNull(cc.it_cents),
        deltaPct: _num(cc.delta_pct),
      };
    }
    rows.push({
      oz: _str(ww.oz, 64),
      title: _str(ww.title),
      qty: _num(ww.qty) ?? 0,
      unit: _str(ww.unit, 12),
      internalUpCents: _intOrNull(ww.internal_up_cents),
      onlyInOffer: ww.only_in_offer === true,
      cells,
      bestOfferId: typeof ww.best_offer_id === "string" ? ww.best_offer_id : null,
    });
  }
  return {
    rows,
    offers,
    hinweis: _str(r.hinweis, 400) || null,
    duplicateInternalOz: _intOrNull(r.duplicate_internal_oz) ?? 0,
  };
}

/// Couleur de cellule : vert = meilleur EP de la ligne ; « — » = pas chiffré.
export function cellClass(row: CompareRow, offerId: string): "best" | "normal" | "missing" {
  const cell = row.cells[offerId];
  if (!cell || cell.upCents === null) return "missing";
  return row.bestOfferId === offerId ? "best" : "normal";
}

/// « +5,0 % » / « −5,0 % » (virgule allemande, moins typographique).
export function deltaText(deltaPct: number | null): string | null {
  if (deltaPct === null) return null;
  const rounded = Math.round(deltaPct * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
  return `${sign}${Math.abs(rounded).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

/**
 * Verdict honnête : le moins-disant PARMI LES OFFRES COMPLÈTES seulement
 * (une Teilsumme ne gagne jamais un appel d'offres — dit en clair) ;
 * null quand rien n'est comparable (< 2 offres).
 */
export function verdictText(offers: CompareOffer[]): string | null {
  if (offers.length < 2) return null;
  const complete = offers.filter((o) => o.complete);
  if (complete.length === 0) {
    return "Kein Angebot vollständig bepreist — die Summen unten sind Teilsummen und nicht vergleichbar.";
  }
  const best = complete.reduce((a, b) => (a.totalCents <= b.totalCents ? a : b));
  return `Günstigstes vollständiges Angebot: ${best.companyName} — ${eurFromCents(best.totalCents)}`;
}
