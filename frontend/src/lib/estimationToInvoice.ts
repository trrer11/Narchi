/** §151 — Pont « estimation → facture » : transforme une estimation DIN 276
 * en LIGNES de facture (le brouillon que l'utilisateur édite puis émet).
 *
 * HONNÊTETÉ gravée ici :
 *  - une estimation n'est PAS une facture : ce module produit un BROUILLON
 *    pré-rempli (les Kostengruppen deviennent des lignes « Pauschal » à
 *    19 %), que l'utilisateur RELIT avant d'émettre. La note « aus Schätzung
 *    erstellt — Beträge prüfen » accompagne le brouillon.
 *  - l'argent : les montants de l'estimation sont des floats (moteur
 *    costEngine). Ici ils sont convertis en CHAÎNES décimales à 2 décimales
 *    avec arrondi HALF_UP (Math.round sur les centimes) — le SERVEUR re-
 *    calcule ensuite en Decimal (§114), l'aperçu aussi. Pas de float qui
 *    fuit dans la facture.
 */
import type { CostResult } from "@/lib/costEngine";
import type { InvoiceLine } from "@/lib/invoices";

/** float (€) → chaîne décimale à 2 décimales, HALF_UP (montants positifs). */
export function moneyStr(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  const cents = Math.round(n * 100); // Math.round = half-up pour les positifs
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const ent = Math.floor(abs / 100).toString();
  const dec = (abs % 100).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${ent}.${dec}`;
}

/** Toutes les lignes détaillées de l'estimation (KG 200 → 700), dans l'ordre
 * DIN 276. Chaque ligne : « code — libellé » en Pauschal, prix = montant net. */
export function estimationToInvoiceLines(cost: CostResult): InvoiceLine[] {
  const groupes: Array<{ code: string; lines: { code: string; label: string; amount: number }[] }> = [
    { code: "200", lines: cost.lines200 ?? [] },
    { code: "300", lines: cost.lines300 ?? [] },
    { code: "400", lines: cost.lines400 ?? [] },
    { code: "500", lines: cost.lines500 ?? [] },
    { code: "700", lines: cost.lines700 ?? [] },
  ];
  const out: InvoiceLine[] = [];
  for (const g of groupes) {
    for (const l of g.lines) {
      if (!l || !Number.isFinite(l.amount) || l.amount <= 0) continue;
      out.push({
        designation: `KG ${l.code} — ${l.label}`.slice(0, 300),
        quantite: "1",
        unite: "forfait",
        prix_unitaire_ht: moneyStr(l.amount),
        taux_tva: "19",
      });
    }
  }
  return out;
}
