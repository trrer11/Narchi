// §182 — Abschlagsrechnung : facturation par Leistungsphase (Teilrechnungen).
//
// Point de douleur marché DE (planlogic.de, 01/2026 : « Teilrechnungen nach
// Fortschritt ❌ Nur manuelle Beträge ✅ Basierend auf LP ») : les outils
// génériques facturent des montants SAISIS À LA MAIN, alors que la HOAI
// découpe le honorar en 8 Leistungsphasen aux SATZ officiels (3 %, 7 %, 11 %…).
// Résultat : l'architecte recalcule à la main « LP 1–3 = 24 % » à chaque
// facture (30–45 min par facture, erreurs de % fréquentes).
//
// Ce moteur génère l'ABSCHLAGSRECHNUNG (facture d'acompte) depuis le moteur
// HOAI réel : l'architecte coche les LPs TERMINÉES, et Narchi calcule le
// montant dû (cumul des satz × honorar), déduit l'ACOMPTE DÉJÀ facturé, et
// fournit un texte de facture prêt à l'emploi.
//
// HONNÊTETÉ (charta §36) : les satz viennent de la HOAI 2021 (Anlage 10,
// Gebäude) — c'est le découpage officiel, pas un pourcentage inventé. Le
// montant final reste une ORIENTATION : la répartition contractuelle peut
// différer (accord libre). Dit dans le texte.

import { LEISTUNGSPHASEN } from "@/data/hoai";
import type { HoaiResult } from "@/lib/hoaiEngine";

export interface AbschlagsPosition {
  lp: number;
  name: string;
  satzPct: number;
  /** Montant netto de CETTE LP (satz × honorar). */
  betragNetto: number;
  /** Cumul netto jusqu'à cette LP incluse. */
  kumuliertNetto: number;
}

export interface Abschlagsrechnung {
  /** Les 8 positions (avec cumul). */
  positionen: AbschlagsPosition[];
  /** LPs facturées (abgerechnet) — cumul netto dû. */
  fakturiertNetto: number;
  /** LP nouvellement terminées → le montant de CETTE Abschlagsrechnung. */
  betragNetto: number;
  betragBrutto: number; // +19 % MwSt
  /** Texte de facture (allemand). */
  text: string;
}

/** Positions par LP avec cumul (pur, à partir du honorar netto). */
export function abschlagsPositionen(honorarNetto: number): AbschlagsPosition[] {
  let kum = 0;
  return LEISTUNGSPHASEN.map((p) => {
    const betragNetto = Math.round(honorarNetto * p.satz * 100) / 100;
    kum = Math.round((kum + betragNetto) * 100) / 100;
    return {
      lp: p.nr,
      name: p.name,
      satzPct: p.satz * 100,
      betragNetto,
      kumuliertNetto: kum,
    };
  });
}

const MWSATZ = 0.19;

/** Construit l'Abschlagsrechnung : LP nouvellement terminées → montant dû. */
export function abschlagsrechnung(
  hoai: HoaiResult,
  fakturierteLps: readonly number[],
  neueLps: readonly number[],
): Abschlagsrechnung {
  const positionen = abschlagsPositionen(hoai.total);
  const fakturiert = new Set(fakturierteLps);
  const neu = new Set(neueLps);

  const fakturiertNetto = Math.round(
    positionen.filter((p) => fakturiert.has(p.lp)).reduce((s, p) => s + p.betragNetto, 0) * 100,
  ) / 100;

  const betragNetto = Math.round(
    positionen.filter((p) => neu.has(p.lp)).reduce((s, p) => s + p.betragNetto, 0) * 100,
  ) / 100;

  const betragBrutto = Math.round(betragNetto * (1 + MWSATZ) * 100) / 100;

  const neueNamen = positionen
    .filter((p) => neu.has(p.lp))
    .map((p) => `LP ${p.lp} ${p.name} (${p.satzPct.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %)`)
    .join(", ");

  const text =
    `Abschlagsrechnung (Entwurf, HOAI 2021 §34 — Orientierung)\n\n` +
    `Abgerechnete Leistungsphasen: ${neueNamen || "—"}.\n` +
    `Honorar netto (Gesamt): ${hoai.total.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €.\n` +
    `Diese Abschlagsrechnung: **${betragNetto.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € netto** ` +
    `(${betragBrutto.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € brutto, 19 % MwSt).\n` +
    `Bereits fakturiert (kumuliert): ${fakturiertNetto.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € netto.\n\n` +
    `Hinweis: Die Aufteilung folgt der Honorartafel (Anlage 10); abweichende vertragliche Regelungen gehen vor.`;

  return { positionen, fakturiertNetto, betragNetto, betragBrutto, text };
}

/** §213 — lignes brouillon XRechnung : une Pauschal-Zeile je neu gewählte LP. */
export function abschlagToInvoiceLines(
  r: Abschlagsrechnung,
  neueLps: readonly number[],
): Array<{
  designation: string;
  quantite: string;
  unite: string;
  prix_unitaire_ht: string;
  taux_tva: string;
}> {
  const neu = new Set(neueLps);
  return r.positionen
    .filter((p) => neu.has(p.lp) && p.betragNetto > 0)
    .map((p) => ({
      designation: `Abschlag HOAI LP ${p.lp} ${p.name}`,
      quantite: "1",
      unite: "forfait",
      prix_unitaire_ht: p.betragNetto.toFixed(2),
      taux_tva: "19",
    }));
}

/** §235 — bereits fakturierte LPs je Projekt, nie global. */
export function abschlagLpsAusPayload(
  payload: unknown,
  projektId: string,
): number[] {
  const pid = projektId.trim();
  if (!pid || !payload || typeof payload !== "object") return [];
  const p = payload as { lps?: unknown; byProjekt?: unknown };
  if (p.byProjekt && typeof p.byProjekt === "object") {
    const raw = (p.byProjekt as Record<string, unknown>)[pid];
    if (Array.isArray(raw)) return raw.filter((n): n is number => typeof n === "number");
    return [];
  }
  // Altes Format { lps: number[] } — nur dem AKTUELLEN Projekt zuordnen, einmal.
  if (Array.isArray(p.lps)) return p.lps.filter((n): n is number => typeof n === "number");
  return [];
}

export function abschlagPayloadMerken(
  bisher: unknown,
  projektId: string,
  lps: readonly number[],
): { byProjekt: Record<string, number[]> } {
  const pid = projektId.trim();
  const byProjekt: Record<string, number[]> = {};
  if (bisher && typeof bisher === "object" && (bisher as { byProjekt?: unknown }).byProjekt
      && typeof (bisher as { byProjekt: unknown }).byProjekt === "object") {
    for (const [k, v] of Object.entries((bisher as { byProjekt: Record<string, unknown> }).byProjekt)) {
      if (Array.isArray(v)) byProjekt[k] = v.filter((n): n is number => typeof n === "number");
    }
  }
  if (pid) byProjekt[pid] = [...lps];
  return { byProjekt };
}
