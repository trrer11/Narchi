/**
 * §116 — Rechnungen / E-Rechnung : client API + calculs d'aperçu EXACTS.
 *
 * Deux lois de la maison, tenues côté navigateur comme côté serveur :
 *
 *  1. L'argent est une CHAÎNE décimale (« 1234.56 »), jamais un float —
 *     sinon IEEE 754 arrondit en silence et le centime dérive. La saisie
 *     allemande « 1.234,56 » est acceptée et normalisée.
 *  2. La VÉRITÉ est côté serveur (recalcul à l'enregistrement ET dans le
 *     XML §114). Ce module offre un APERÇU en direct, calculé avec la même
 *     arithmétique que le serveur (arrondi par ligne au centime HALF_UP,
 *     TVA par groupe de taux) grâce à BigInt — zéro float, zéro centime
 *     de surprise entre l'aperçu et le XML.
 *
 * Erreurs : ApiError transporte le statut HTTP et, le cas échéant, la
 * liste des violations NARCHI-XR-… renvoyées par le serveur (elles sont
 * affichées TELLES QUELLES — jamais un « invalide » muet).
 */

import { secureFetch } from "@/auth/SecuritySanitizer";

// --- Types miroirs du backend (schémas §116) -------------------------------

export type InvoiceStatus = "draft" | "issued" | "cancelled";

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Entwurf",
  issued: "Ausgestellt",
  cancelled: "Storniert",
};

/** Clés = table UNITE_CODES du service §114 (UNECE Rec 20 réduite, dite). */
export const EINHEIT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "forfait", label: "Pauschal" },
  { value: "stueck", label: "Stück" },
  { value: "heure", label: "Stunde" },
  { value: "jour", label: "Tag" },
  { value: "metre", label: "Meter" },
  { value: "m2", label: "m²" },
  { value: "m3", label: "m³" },
  { value: "kg", label: "kg" },
  { value: "cmc", label: "cm³" },
];

export interface InvoiceLine {
  designation: string;
  quantite: string; // chaîne décimale, ex. « 3 » ou « 12.5 »
  unite: string;
  prix_unitaire_ht: string; // chaîne décimale
  taux_tva: string; // chaîne décimale, ex. « 19 »
  categorie_tva?: string;
}

export interface Invoice {
  id: string;
  status: InvoiceStatus;
  rechnungsnummer: string | null;
  issue_date: string | null;
  profile: string;
  project_id: string | null;
  buyer_name: string;
  buyer_street: string;
  buyer_zip: string;
  buyer_city: string;
  buyer_country: string;
  buyer_reference: string; // Leitweg-ID
  seller_name: string;
  seller_street: string;
  seller_zip: string;
  seller_city: string;
  seller_country: string;
  seller_vat_id: string;
  // §123 — champs exigés par le validateur officiel KoSIT (XRechnung 3.0.2,
  // mesuré) : BG-16 paiement (BR-DE-1), adresses électroniques (R010/R020),
  // contact vendeur (BR-DE-2, BG-6), processus métier (R005, BT-23).
  seller_iban: string;
  seller_bic: string;
  seller_account_name: string;
  seller_email: string;
  buyer_email: string;
  seller_contact_name: string;
  seller_contact_phone: string;
  seller_contact_email: string;
  processus: string;
  currency: string;
  delivery_date: string | null;
  period_start: string | null;
  period_end: string | null;
  due_date: string | null;
  lines: InvoiceLine[];
  notes: string[];
  total_net: string;
  total_tva: string;
  total_brut: string;
  created_by: string;
  created_at: string | null;
  updated_at: string;
  issued_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string;
  kosit_last?: KositDualReport | null;
  kosit_checked_at?: string | null;
}

export interface InvoiceUpsertBody {
  buyer_name: string;
  buyer_street?: string;
  buyer_zip?: string;
  buyer_city?: string;
  buyer_country?: string;
  buyer_reference?: string;
  seller_name?: string;
  seller_street?: string;
  seller_zip?: string;
  seller_city?: string;
  seller_country?: string;
  seller_vat_id?: string;
  // §123 — mêmes champs KoSIT, optionnels à la saisie (le REFUS d'émettre
  // un XRechnung sans IBAN/contact/e-mails est côté serveur, jamais masqué).
  // NB : `processus` n'est pas exposé dans l'UI v1 (valeur canonique Peppol
  // proposée par le schéma serveur, modifiable via l'API — DIT ici).
  seller_iban?: string;
  seller_bic?: string;
  seller_account_name?: string;
  seller_email?: string;
  buyer_email?: string;
  seller_contact_name?: string;
  seller_contact_phone?: string;
  seller_contact_email?: string;
  processus?: string;
  currency?: string;
  project_id?: string | null;
  delivery_date?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  due_date?: string | null;
  notes?: string[];
  lines: InvoiceLine[];
}

export interface ValidationReport {
  ok: boolean;
  violations: string[];
}

// --- Argent : parsing allemand + aperçu exact en BigInt --------------------

/** Normalisation allemande partagée : virgule décisive (points = milliers
 *  si une virgule est présente), sinon point décimal. Règle DITE ici. */
function normaliseDe(input: string): string {
  const brut = input.replace(/[\s€]/g, "");
  return brut.includes(",") ? brut.replace(/\./g, "").replace(",", ".") : brut;
}

function entierPropre(s: string, maxDec: number, garderDec: boolean): string | null {
  const re = new RegExp(`^\\d{1,12}(\\.\\d{1,${maxDec}})?$`);
  if (!re.test(s)) return null;
  const [ent, dec = ""] = s.split(".");
  const propre = ent.replace(/^0+(?=\d)/, "");
  if (!dec) return garderDec ? propre : `${propre}.00`;
  return garderDec ? `${propre}.${dec}` : `${propre}.${dec.padEnd(2, "0")}`;
}

/** Saisie d'argent à 2 décimales (« 4.000,00 » → « 4000.00 »). */
export function parseEuro(input: string): string | null {
  const norm = normaliseDe(input);
  if (!norm) return null;
  return entierPropre(norm, 2, false);
}

/** Prix unitaire : jusqu'à 6 décimales (« 33,3350 » — le cas réel §114 des
 *  honoraires à 4 décimales). ≥ 0 (une ligne à 0,00 € est légale : avoir
 *  d'ajustement hors TVA par exemple). */
export function parsePrix(input: string): string | null {
  const norm = normaliseDe(input);
  if (!norm) return null;
  return entierPropre(norm, 6, true);
}

/** Quantités : jusqu'à 6 décimales (heures, m²…), > 0 exigé comme côté
 *  serveur (une ligne à 0 ne facture rien). */
export function parseQuantite(input: string): string | null {
  const q = parsePrix(input);
  return q !== null && decToScaled(q) > 0n ? q : null;
}

const DEC = /^\d{1,12}(\.\d{1,6})?$/;

/** Chaîne décimale → entier à l'échelle 1e6 (BigInt — précision totale). */
function decToScaled(s: string): bigint {
  if (!DEC.test(s)) throw new Error(`décimal invalide « ${s} »`);
  const [ent, dec = ""] = s.split(".");
  const micro = (dec + "000000").slice(0, 6);
  return BigInt(ent) * 1_000_000n + BigInt(micro);
}

/** Arrondi HALF_UP d'une valeur à l'échelle `echelle` vers les centimes. */
function versCentimes(valeur: bigint, echelle: bigint): bigint {
  const pas = echelle / 100n; // unités d'échelle par centime
  return (valeur + pas / 2n) / pas;
}

export interface TvaGroup {
  taux: string;
  baseCents: bigint;
  tvaCents: bigint;
}

export interface PreviewTotals {
  lignes: bigint[]; // net par ligne (centimes)
  netCents: bigint;
  tvaCents: bigint;
  brutCents: bigint;
  groupes: TvaGroup[];
}

/** MÊME arithmétique que le serveur §114/§116 :
 *  chaque ligne est arrondie au centime (HALF_UP), puis la TVA est
 *  calculée PAR GROUPE de taux (EN 16931) — pas ligne par ligne. */
export function previewTotals(
  lignes: Array<{ quantite: string; prix_unitaire_ht: string; taux_tva: string }>,
): PreviewTotals {
  const ECHELLE = 1_000_000n;
  const parLigne: bigint[] = [];
  const clusters = new Map<string, { baseCents: bigint; taux: string }>();
  let net = 0n;
  for (const li of lignes) {
    const produit = decToScaled(li.quantite) * decToScaled(li.prix_unitaire_ht);
    const cents = versCentimes(produit, ECHELLE * ECHELLE); // qµ × pµ → 1e-12 €
    parLigne.push(cents);
    net += cents;
    const cle = `${li.taux_tva}|`;
    const groupe = clusters.get(cle) ?? { baseCents: 0n, taux: li.taux_tva };
    groupe.baseCents += cents;
    clusters.set(cle, groupe);
  }
  let tva = 0n;
  const groupes: TvaGroup[] = [...clusters.values()]
    .sort((a, b) => Number(decToScaled(a.taux) - decToScaled(b.taux)))
    .map((g) => {
      // cents_taxe = base_cents × taux / 100, arrondi HALF_UP au centime.
      const micro = g.baseCents * decToScaled(g.taux); // 1e-8 €·%
      const tvaCents = (micro + 50_000_000n) / 100_000_000n;
      tva += tvaCents;
      return { taux: g.taux, baseCents: g.baseCents, tvaCents };
    });
  return { lignes: parLigne, netCents: net, tvaCents: tva, brutCents: net + tva, groupes };
}

/** Centimes (BigInt) → « 1.234,56 € » format allemand, écrit à la main
 *  (pas d'Intl : le rendu doit être IDENTIQUE quel que soit l'appareil). */
export function formatEur(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const ent = abs / 100n;
  const dec = (abs % 100n).toString().padStart(2, "0");
  const entStr = ent.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}${entStr},${dec} €`;
}

/** Chaîne serveur « 1234.56 » → centimes BigInt (pour l'affichage liste). */
export function centsOf(decimal: string): bigint {
  return versCentimes(decToScaled(decimal), 1_000_000n);
}

// --- API --------------------------------------------------------------------

const API = "/api/v5/invoices";

export class ApiError extends Error {
  status: number;
  violations: string[];
  constructor(status: number, message: string, violations: string[] = []) {
    super(message);
    this.status = status;
    this.violations = violations;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await secureFetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let violations: string[] = [];
    try {
      const body = await res.json();
      const d = body?.detail;
      if (typeof d === "string") message = d;
      else if (d && typeof d === "object") {
        message = typeof d.detail === "string" ? d.detail : message;
        if (Array.isArray(d.violations)) violations = d.violations.map(String);
      }
    } catch {
      /* corps illisible : le statut suffit déjà à parler */
    }
    throw new ApiError(res.status, message, violations);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function listInvoices(opts: {
  status?: InvoiceStatus | "";
  q?: string;
  projectId?: string | null;
} = {}): Promise<{ invoices: Invoice[]; total: number }> {
  const params = new URLSearchParams();
  if (opts.status) params.set("status", opts.status);
  if (opts.q) params.set("q", opts.q);
  if (opts.projectId) params.set("project_id", opts.projectId);
  const qs = params.toString();
  return request(`${API}${qs ? `?${qs}` : ""}`);
}

export function createInvoice(body: InvoiceUpsertBody): Promise<Invoice> {
  return request(API, { method: "POST", body: JSON.stringify(body) });
}

export function updateInvoice(id: string, body: InvoiceUpsertBody): Promise<Invoice> {
  return request(`${API}/${id}`, { method: "PUT", body: JSON.stringify(body) });
}

export function deleteInvoice(id: string): Promise<void> {
  return request(`${API}/${id}`, { method: "DELETE" });
}

export function issueInvoice(id: string): Promise<Invoice> {
  return request(`${API}/${id}/issue`, { method: "POST" });
}

export function cancelInvoice(id: string, reason: string): Promise<Invoice> {
  return request(`${API}/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function validateInvoice(id: string): Promise<ValidationReport> {
  return request(`${API}/${id}/validation`);
}

export interface KositLeg {
  ok: boolean;
  verdict: string;
  syntax?: string;
  detail?: string;
  excerpt?: string;
  rejected?: number | null;
}

export interface KositDualReport {
  ok: boolean;
  verdict: string;
  detail?: string;
  cii?: KositLeg | null;
  ubl?: KositLeg | null;
  peppol_network?: boolean;
  sidecar_ready?: boolean;
}

export function kositCheckInvoice(id: string): Promise<KositDualReport> {
  return request(`${API}/${id}/kosit`, { method: "POST" });
}
