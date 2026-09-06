/**
 * §116 — Rechnungen & E-Rechnung (« finis d'abord la E-Rechnung »).
 *
 * Cycle de vie affiché SANS maquillage :
 *   Entwurf (modifiable/supprimable) → Ausgestellt (numéro RE-AAAA-NNNN
 *   + date attribués par LE SERVEUR, puis figée — GoBD) → Storniert
 *   (marquée, numéro CONSERVÉ, jamais effacée).
 *
 * Le bouton « Ausstellen » peut être refusé : le serveur renvoie alors la
 * liste des violations NARCHI-XR-… et l'écran les montre TELLES QUELLES.
 * §123 — honnêteté tenue : le bandeau dit que le XML de Narchi a PASSÉ le
 * validateur officiel KoSIT v1.6.2 (13/08/2026). §129–§131 — les trois
 * autres sorties (PDF/A-3 ZUGFeRD, UBL, e-mail .eml) sont désormais
 * téléchargeables, chacune prouvée (Mustang/veraPDF pour le PDF, KoSIT pour
 * l'UBL) ; l'e-mail s'envoie via le client mail, Peppol réseau reste différé.
 * Nouveaux champs exigés par KoSIT visibles dans le formulaire : e-mails
 * électroniques (BT-34/49), contact vendeur (BG-6/BR-DE-2), banque (BG-16/
 * BR-DE-1, IBAN). Le processus BT-23 n'est PAS exposé : valeur canonique
 * Peppol proposée par le serveur, modifiable via l'API — dit en commentaire.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ApiError,
  cancelInvoice,
  centsOf,
  createInvoice,
  deleteInvoice,
  EINHEIT_OPTIONS,
  formatEur,
  issueInvoice,
  kositCheckInvoice,
  listInvoices,
  parsePrix,
  parseQuantite,
  previewTotals,
  STATUS_LABELS,
  updateInvoice,
  validateInvoice,
  type Invoice,
  type InvoiceLine,
  type InvoiceStatus,
  type InvoiceUpsertBody,
} from "@/lib/invoices";
import { secureFetch } from "@/auth/SecuritySanitizer";
import {
  ladeZahlungen,
  mahnungText,
  setzeZahlung,
  summeOffen,
  ueberfaelligeRechnungen,
  type MahnbareRechnung,
} from "@/lib/mahnwesen";
import { mergeZahlungen, pullOfficeBlob, pushOfficeBlob } from "@/lib/officeBlobSync";
import { legalIsFilled, parseOfficeLegal } from "@/lib/officeLegal";
import { invoiceBuyerFromProject } from "@/lib/invoiceBuyer";
import { emptySender, fetchOfficeSender, saveOfficeSender, senderToAbsenderLocal, type OfficeSender } from "@/lib/officeSender";
import { useToast } from "@/components/Toaster";
import { Icon } from "@/components/ui";
import { useApp } from "@/store/AppStore";

// ---------------------------------------------------------------------------

const ABSENDER_KEY = "narchi:rechnungen:absender";

interface Absender {
  name: string; street: string; zip: string; city: string; vat: string;
  // §123 — exigences KoSIT 3.0.2 : banque (BG-16), e-mail (BT-34), contact (BG-6).
  iban: string; bic: string; kontoInhaber: string; email: string;
  kontaktName: string; kontaktTelefon: string; kontaktEmail: string;
}

function videAbsender(): Absender {
  return {
    name: "", street: "", zip: "", city: "", vat: "",
    iban: "", bic: "", kontoInhaber: "", email: "",
    kontaktName: "", kontaktTelefon: "", kontaktEmail: "",
  };
}

function normaliserAbsender(p: Partial<Absender> | Record<string, unknown>): Absender {
  const v = videAbsender();
  return {
    name: String(p.name ?? v.name),
    street: String(p.street ?? v.street),
    zip: String(p.zip ?? v.zip),
    city: String(p.city ?? v.city),
    vat: String(p.vat ?? v.vat),
    iban: String(p.iban ?? v.iban),
    bic: String(p.bic ?? v.bic),
    kontoInhaber: String(p.kontoInhaber ?? v.kontoInhaber),
    email: String(p.email ?? v.email),
    kontaktName: String(p.kontaktName ?? v.kontaktName),
    kontaktTelefon: String(p.kontaktTelefon ?? v.kontaktTelefon),
    kontaktEmail: String(p.kontaktEmail ?? v.kontaktEmail),
  };
}

function lireAbsender(): Absender {
  try {
    const brut = localStorage.getItem(ABSENDER_KEY);
    if (brut) return normaliserAbsender(JSON.parse(brut) as Partial<Absender>);
  } catch { /* localStorage indisponible : champs vides, jamais de crash */ }
  return videAbsender();
}

function ecrireAbsenderLocal(a: Absender): void {
  try { localStorage.setItem(ABSENDER_KEY, JSON.stringify(a)); } catch { /* rien */ }
}

function ecrireAbsender(a: Absender): void {
  ecrireAbsenderLocal(a);
  void pushOfficeBlob("absender", { ...a });
}

// --- État du formulaire -----------------------------------------------------

interface LigneDraft { designation: string; quantite: string; unite: string; prix: string; taux: string }

interface FormState {
  buyerName: string; buyerStreet: string; buyerZip: string; buyerCity: string; buyerReference: string;
  buyerEmail: string; // §123 — BT-49, Pflicht XRechnung (Peppol R010)
  sellerName: string; sellerStreet: string; sellerZip: string; sellerCity: string; sellerVatId: string;
  // §123 — KoSIT 3.0.2 : BT-34, BG-16 (BR-DE-1), BG-6 (BR-DE-2).
  sellerEmail: string;
  sellerIban: string; sellerBic: string; sellerKontoInhaber: string;
  sellerKontaktName: string; sellerKontaktTelefon: string; sellerKontaktEmail: string;
  deliveryDate: string; periodStart: string; periodEnd: string; dueDate: string;
  notes: string;
  lignes: LigneDraft[];
}

/** §233 — Kunde nur aus Projektfeldern, nie « Kunde » erfinden. */
export function formCreateFromProject(p: {
  id?: string; client?: string; name?: string; location?: string;
  clientStreet?: string; clientZip?: string; clientCity?: string; clientLeitweg?: string;
} | null | undefined): { form: FormState; hinweis: string } {
  const base = formVide();
  if (!p || !(p.id || "").trim()) {
    return { form: base, hinweis: "Kein aktives Projekt — Empfänger leer. Anschrift in Projekte eintragen oder hier tippen." };
  }
  const b = invoiceBuyerFromProject(p);
  const name = (p.client || "").trim() || (p.name || "").trim();
  return {
    form: {
      ...base,
      buyerName: name,
      buyerStreet: b.buyer_street ?? "",
      buyerZip: b.buyer_zip ?? "",
      buyerCity: b.buyer_city ?? "",
      buyerReference: b.buyer_reference ?? "",
    },
    hinweis: name ? b.note : "Projekt ohne Auftraggeber-Name — Empfänger leer. Nichts erfunden.",
  };
}

function formVide(): FormState {
  const a = lireAbsender();
  return {
    buyerName: "", buyerStreet: "", buyerZip: "", buyerCity: "", buyerReference: "",
    buyerEmail: "",
    sellerName: a.name, sellerStreet: a.street, sellerZip: a.zip, sellerCity: a.city, sellerVatId: a.vat,
    sellerEmail: a.email,
    sellerIban: a.iban, sellerBic: a.bic, sellerKontoInhaber: a.kontoInhaber,
    sellerKontaktName: a.kontaktName, sellerKontaktTelefon: a.kontaktTelefon, sellerKontaktEmail: a.kontaktEmail,
    deliveryDate: "", periodStart: "", periodEnd: "", dueDate: "",
    notes: "",
    lignes: [{ designation: "", quantite: "1", unite: "forfait", prix: "", taux: "19" }],
    projectId: "",
  };
}

/** §149 — Exemple VALIDE pour tester le flux complet (bouton « Beispiel
 *  ausfüllen ») : toutes les Pflichtangaben remplies avec des données
 *  plausibles, dont un IBAN de test canonique (§123) et un e-mail. C'est de
 *  la donnée d'ESSAI affichée telle quelle — l'utilisateur la remplace avant
 *  une vraie facture. Honnête : le bouton dit « Testdaten ». */
function formExemple(): FormState {
  return {
    buyerName: "Stadt Hannover — Gebäudemanagement",
    buyerStreet: "Trammplatz 2", buyerZip: "30159", buyerCity: "Hannover",
    buyerReference: "04011000-2026-4711",
    buyerEmail: "erfassung@hannover-stadt.de",
    sellerName: "Narchi Architekturbüro GmbH", sellerStreet: "Lister Meile 1",
    sellerZip: "30161", sellerCity: "Hannover", sellerVatId: "DE123456789",
    sellerEmail: "buchhaltung@narchi-architekten.de",
    sellerIban: "DE89 3704 0044 0532 0130 00", sellerBic: "COBADEFFXXX",
    sellerKontoInhaber: "Narchi Architekturbüro GmbH",
    sellerKontaktName: "A. Muster", sellerKontaktTelefon: "+49 511 1234567",
    sellerKontaktEmail: "a.muster@narchi-architekten.de",
    deliveryDate: "2026-08-06", periodStart: "", periodEnd: "",
    dueDate: "2026-09-05",
    notes: "Testrechnung — bitte vor echter Nutzung ersetzen.",
    lignes: [{ designation: "Grundleistungen LP 5 (Bauantrag)", quantite: "1", unite: "forfait", prix: "4000.00", taux: "19" }],
    projectId: "",
  };
}

function formDepuis(inv: Invoice): FormState {
  return {
    buyerName: inv.buyer_name, buyerStreet: inv.buyer_street, buyerZip: inv.buyer_zip,
    buyerCity: inv.buyer_city, buyerReference: inv.buyer_reference,
    buyerEmail: inv.buyer_email ?? "",
    sellerName: inv.seller_name, sellerStreet: inv.seller_street, sellerZip: inv.seller_zip,
    sellerCity: inv.seller_city, sellerVatId: inv.seller_vat_id,
    sellerEmail: inv.seller_email ?? "",
    sellerIban: inv.seller_iban ?? "", sellerBic: inv.seller_bic ?? "",
    sellerKontoInhaber: inv.seller_account_name ?? "",
    sellerKontaktName: inv.seller_contact_name ?? "",
    sellerKontaktTelefon: inv.seller_contact_phone ?? "",
    sellerKontaktEmail: inv.seller_contact_email ?? "",
    deliveryDate: inv.delivery_date ?? "", periodStart: inv.period_start ?? "",
    periodEnd: inv.period_end ?? "", dueDate: inv.due_date ?? "",
    notes: inv.notes.join("\n"),
    lignes: inv.lines.map((l) => ({
      designation: l.designation, quantite: l.quantite, unite: l.unite,
      prix: l.prix_unitaire_ht, taux: l.taux_tva,
    })),
    projectId: inv.project_id ?? "",
  };
}

/** Quelles lignes sont numériquement valides (designation ≠ obligatoire ici :
 *  c'est l'aperçu, pas la validation serveur). */
function lignesValides(f: FormState): Array<{ quantite: string; prix_unitaire_ht: string; taux_tva: string }> {
  const out: Array<{ quantite: string; prix_unitaire_ht: string; taux_tva: string }> = [];
  for (const l of f.lignes) {
    const q = parseQuantite(l.quantite);
    const p = parsePrix(l.prix);
    const t = parsePrix(l.taux);
    if (q !== null && p !== null && t !== null && centsOf(`${t}`) <= 10000n) {
      out.push({ quantite: q, prix_unitaire_ht: p, taux_tva: t });
    }
  }
  return out;
}

/** §231 — Pflichtlücken der gespeicherten Rechnung, ohne etwas zu erfinden.
 *  Der Server bleibt die Autorität bei Ausstellen; hier nur Sichtbarkeit. */
export function lueckenVorAusstellung(inv: Invoice): string[] {
  const l: string[] = [];
  if (!inv.buyer_name.trim()) l.push("Kundenname fehlt");
  if (!inv.buyer_street.trim() || !inv.buyer_zip.trim() || !inv.buyer_city.trim()) {
    l.push("Anschrift des Auftraggebers unvollständig (Straße, PLZ, Ort)");
  }
  if (!inv.buyer_reference.trim()) l.push("Leitweg-ID fehlt (Pflicht für XRechnung)");
  if (!(inv.buyer_email ?? "").trim()) l.push("Empfänger-E-Mail (BT-49) fehlt");
  if (!inv.seller_name.trim()) l.push("Absender: Büroname fehlt");
  if (!inv.seller_street.trim() || !inv.seller_zip.trim() || !inv.seller_city.trim()) {
    l.push("Absender-Anschrift unvollständig");
  }
  if (!inv.seller_vat_id.trim()) l.push("USt-IdNr des Büros fehlt");
  if (!(inv.seller_email ?? "").trim()) l.push("Absender-E-Mail (BT-34) fehlt");
  if (!(inv.seller_iban ?? "").trim()) l.push("IBAN fehlt (BG-16)");
  if (!(inv.seller_contact_name ?? "").trim()) l.push("Kontaktperson (BG-6) fehlt");
  const hatLeistung = Boolean(inv.delivery_date) || Boolean(inv.period_start && inv.period_end);
  if (!hatLeistung) l.push("Leistungsdatum oder Zeitraum fehlt");
  if (inv.lines.length === 0) l.push("Keine Leistungszeile");
  return l;
}

/** null = pas enregistrable ; la cause est affichée près des champs. */
function corpsDepuis(f: FormState): InvoiceUpsertBody | null {
  if (!f.buyerName.trim()) return null;
  const valides = lignesValides(f);
  if (valides.length !== f.lignes.length || f.lignes.some((l) => !l.designation.trim())) return null;
  const lignes: InvoiceLine[] = f.lignes.map((l, i) => {
    const v = valides[i];
    return {
      designation: l.designation.trim(), quantite: v.quantite, unite: l.unite,
      prix_unitaire_ht: v.prix_unitaire_ht, taux_tva: v.taux_tva,
    };
  });
  return {
    buyer_name: f.buyerName.trim(),
    buyer_street: f.buyerStreet.trim(), buyer_zip: f.buyerZip.trim(), buyer_city: f.buyerCity.trim(),
    buyer_country: "DE", buyer_reference: f.buyerReference.trim(),
    buyer_email: f.buyerEmail.trim(), // §123 — BT-49 (R010)
    seller_name: f.sellerName.trim(), seller_street: f.sellerStreet.trim(),
    seller_zip: f.sellerZip.trim(), seller_city: f.sellerCity.trim(),
    seller_country: "DE", seller_vat_id: f.sellerVatId.trim(),
    // §123 — KoSIT 3.0.2 mesuré : l'IBAN n'est NI tronqué NI complété ici ;
    // si le format est faux, le serveur refusera l'émission (NARCHI-XR-42)
    // et l'écran affichera la violation telle quelle.
    seller_iban: f.sellerIban.trim(), seller_bic: f.sellerBic.trim(),
    seller_account_name: f.sellerKontoInhaber.trim(),
    seller_email: f.sellerEmail.trim(), // §123 — BT-34 (R020)
    seller_contact_name: f.sellerKontaktName.trim(), // §123 — BG-6 (BR-DE-2)
    seller_contact_phone: f.sellerKontaktTelefon.trim(),
    seller_contact_email: f.sellerKontaktEmail.trim(),
    // `processus` volontairement absent : valeur canonique Peppol du serveur.
    currency: "EUR",
    delivery_date: f.deliveryDate || null,
    period_start: f.periodStart || null, period_end: f.periodEnd || null,
    due_date: f.dueDate || null,
    notes: f.notes.split("\n").map((n) => n.trim()).filter(Boolean),
    lines: lignes,
    project_id: f.projectId.trim() || null,
  };
}

// --- Petits composants ------------------------------------------------------

function Champ(props: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string; erreur?: boolean; type?: string;
}) {
  return (
    <label className="block text-xs" htmlFor={props.id}>
      <span className="mb-1 block font-semibold uppercase tracking-wide text-slate-500">{props.label}</span>
      <input
        id={props.id}
        type={props.type ?? "text"}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition focus:border-brand-500 ${
          props.erreur ? "border-red-400 bg-red-50" : "border-slate-300 bg-white"
        }`}
      />
      {props.hint && <span className="mt-1 block text-[11px] text-slate-400">{props.hint}</span>}
    </label>
  );
}

interface PanelMsg { kind: "err" | "ok" | "warn"; titre: string; violations?: string[] }

function PanneauMessage({ msg }: { msg: PanelMsg }) {
  const couleurs = {
    err: "border-red-300 bg-red-50 text-red-800",
    ok: "border-emerald-300 bg-emerald-50 text-emerald-800",
    warn: "border-amber-300 bg-amber-50 text-amber-800",
  }[msg.kind];
  return (
    <div className={`rounded-xl border p-3 text-sm ${couleurs}`}>
      <p className="font-semibold">{msg.titre}</p>
      {msg.violations && msg.violations.length > 0 && (
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
          {msg.violations.map((v) => <li key={v}>{v}</li>)}
        </ul>
      )}
      {msg.violations !== undefined && msg.violations.length > 0 && msg.kind === "warn" && (
        <p className="mt-1 text-[11px] opacity-80">
          Hinweis: NARCHI-XR-01/02 (Nummer + Ausstellungsdatum) vergibt der Server
          automatisch bei der Ausstellung — sie sind hier nur als Information gelistet.
        </p>
      )}
    </div>
  );
}

// --- Page -------------------------------------------------------------------

export default function Rechnungen() {
  const toast = useToast();
  const { activeProject, projects } = useApp();
  const [nurAktivesProjekt, setNurAktivesProjekt] = useState(true);
  const [items, setItems] = useState<Invoice[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | InvoiceStatus>("");
  const [qInput, setQInput] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ mode: "create" } | { mode: "edit"; inv: Invoice } | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<PanelMsg | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [stornoFor, setStornoFor] = useState<string | null>(null);
  const [stornoReason, setStornoReason] = useState("");

  // §179 — Mahnwesen : statut de paiement + factures échues, en local.
  const [zahlungen, setZahlungen] = useState<Record<string, string>>(() => ladeZahlungen() as Record<string, string>);
  const [impressumOk, setImpressumOk] = useState<boolean | null>(null);
  const [stammdaten, setStammdaten] = useState<OfficeSender | null>(null);
  const [stammBusy, setStammBusy] = useState(false);
  const [stammErr, setStammErr] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      const remote = await pullOfficeBlob("mahnwesen");
      if (live && remote && !remote.empty) {
        const merged = mergeZahlungen(ladeZahlungen(), remote.payload);
        try {
          localStorage.setItem("narchi:mahnwesen:zahlungen", JSON.stringify(merged));
        } catch { /* */ }
        setZahlungen(merged);
      }
      const abs = await pullOfficeBlob("absender");
      if (live && abs && !abs.empty) {
        ecrireAbsenderLocal(normaliserAbsender(abs.payload));
      }
      const imp = await pullOfficeBlob("impressum");
      if (live) {
        setImpressumOk(imp && !imp.empty ? legalIsFilled(parseOfficeLegal(imp.payload)) : false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  const mahnbare: MahnbareRechnung[] = useMemo(
    () =>
      (items ?? [])
        .filter((i) => i.status === "issued")
        .map((i) => ({
          id: i.id,
          rechnungsnummer: i.rechnungsnummer,
          buyer_name: i.buyer_name,
          buyer_street: i.buyer_street,
          buyer_zip: i.buyer_zip,
          buyer_city: i.buyer_city,
          total_brut: i.total_brut,
          due_date: i.due_date,
          issued_at: i.issued_at,
        })),
    [items],
  );
  const ueberfaellig = useMemo(
    () => ueberfaelligeRechnungen(mahnbare, zahlungen as Record<string, "offen" | "bezahlt">),
    [mahnbare, zahlungen],
  );
  const [mahnungFuer, setMahnungFuer] = useState<string | null>(null);
  const markiereBezahlt = (id: string) => {
    const next = setzeZahlung(id, "bezahlt");
    setZahlungen(next);
    void pushOfficeBlob("mahnwesen", next);
    setMahnungFuer(null);
    toast.push({ kind: "success", title: "Als bezahlt markiert" });
  };
  const copyMahnung = async (id: string) => {
    const s = ueberfaellig.find((x) => x.rechnung.id === id);
    if (!s) return;
    try {
      await navigator.clipboard.writeText(mahnungText(s));
      toast.push({ kind: "success", title: "Mahnung kopiert" });
    } catch {
      toast.push({ kind: "warn", title: "Kopieren nicht möglich" });
    }
  };

  const recharger = useCallback(async () => {
    try {
      const pid = nurAktivesProjekt ? (activeProject?.id || "").trim() : "";
      const rep = await listInvoices({
        status: statusFilter,
        q: qApplied || undefined,
        projectId: pid || null,
      });
      setItems(rep.invoices);
      setLoadErr("");
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Laden fehlgeschlagen");
      setItems([]);
    }
  }, [statusFilter, qApplied, nurAktivesProjekt, activeProject?.id]);

  useEffect(() => { void recharger(); }, [recharger]);

  const selected = useMemo(
    () => items?.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  const remplace = (inv: Invoice) =>
    setItems((cur) => (cur ?? []).map((i) => (i.id === inv.id ? inv : i)));

  const surErreur = (e: unknown, titre: string) => {
    if (e instanceof ApiError) {
      setMsg({ kind: "err", titre: `${titre}: ${e.message}`, violations: e.violations });
    } else {
      setMsg({ kind: "err", titre: `${titre}: ${e instanceof Error ? e.message : "unbekannter Fehler"}` });
    }
  };

  async function faireIssue(inv: Invoice) {
    setBusy("issue"); setMsg(null);
    try {
      const out = await issueInvoice(inv.id);
      remplace(out);
      setMsg({ kind: "ok", titre: `Ausgestellt als ${out.rechnungsnummer} — ab jetzt unveränderbar (GoBD).` });
    } catch (e) { surErreur(e, "Ausstellung fehlgeschlagen"); }
    finally { setBusy(""); }
    void recharger();
  }

  async function faireValidation(inv: Invoice) {
    setBusy("valid"); setMsg(null);
    try {
      const rep = await validateInvoice(inv.id);
      setMsg(
        rep.ok
          ? { kind: "ok", titre: "Konform: alle Pflichtangaben der lokalen Prüfung vorhanden." }
          : { kind: "warn", titre: `Noch nicht konform — ${rep.violations.length} offene Pflichtangabe(n):`, violations: rep.violations },
      );
    } catch (e) { surErreur(e, "Prüfung fehlgeschlagen"); }
    finally { setBusy(""); }
  }

  async function faireDelete(inv: Invoice) {
    setBusy("delete"); setMsg(null);
    try {
      await deleteInvoice(inv.id);
      setConfirmDelete(null);
      setSelectedId(null);
      setMsg({ kind: "ok", titre: "Entwurf gelöscht. Ausgestellte Rechnungen werden nie gelöscht." });
      void recharger();
    } catch (e) { surErreur(e, "Löschen verweigert"); }
    finally { setBusy(""); }
  }

  async function faireStorno(inv: Invoice) {
    setBusy("storno"); setMsg(null);
    try {
      const out = await cancelInvoice(inv.id, stornoReason.trim());
      remplace(out);
      setStornoFor(null); setStornoReason("");
      setMsg({ kind: "ok", titre: `Storniert — die Nummer ${out.rechnungsnummer} bleibt reserviert (kein Loch in der Kette).` });
    } catch (e) { surErreur(e, "Storno verweigert"); }
    finally { setBusy(""); }
  }

  /** Téléchargement générique d'une sortie de facture (blob → fichier).
   *  §129–§131 : les 4 sorties (XML, PDF/A-3 ZUGFeRD, UBL, .eml) passent par
   *  le MÊME chemin — un refus serveur (brouillon/stornée/pas d'e-mail) est
   *  lu et affiché tel quel, jamais maquillé. */
  async function telecharger(inv: Invoice, opts: { suffix: string; nom: string; titre: string }) {
    setBusy("dl"); setMsg(null);
    try {
      const res = await secureFetch(`/api/v5/invoices/${inv.id}/${opts.suffix}`);
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          const d = (body as { detail?: unknown })?.detail;
          if (typeof d === "string") message = d;
          else if (d && typeof d === "object" && typeof (d as { detail?: unknown }).detail === "string") {
            message = (d as { detail: string }).detail;
          }
        } catch { /* corps illisible : le statut suffit */ }
        throw new ApiError(res.status, message);
      }
      const blob = await res.blob();
      if (typeof URL.createObjectURL !== "function") {
        throw new Error("Download API fehlt in diesem Browser");
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = opts.nom;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg({ kind: "ok", titre: opts.titre });
    } catch (e) { surErreur(e, "Download fehlgeschlagen"); }
    finally { setBusy(""); }
  }

  function faireXml(inv: Invoice) {
    return telecharger(inv, {
      suffix: "xrechnung.xml",
      nom: `${inv.rechnungsnummer ?? inv.id}.xml`,
      titre: `${inv.rechnungsnummer}.xml heruntergeladen (CII D16B, Profil XRechnung 3.0).`,
    });
  }

  function faireZugferd(inv: Invoice) {
    return telecharger(inv, {
      suffix: "zugferd.pdf",
      nom: `${inv.rechnungsnummer ?? inv.id}_zugferd.pdf`,
      titre: `${inv.rechnungsnummer}_zugferd.pdf heruntergeladen (PDF/A-3 ZUGFeRD — lesbar + XML eingebettet).`,
    });
  }

  function faireUbl(inv: Invoice) {
    return telecharger(inv, {
      suffix: "xrechnung-ubl.xml",
      nom: `${inv.rechnungsnummer ?? inv.id}_ubl.xml`,
      titre: `${inv.rechnungsnummer}_ubl.xml heruntergeladen (UBL 2.1 — Syntax des Peppol-Netzes).`,
    });
  }

  function faireVersand(inv: Invoice) {
    return telecharger(inv, {
      suffix: "versand.eml",
      nom: `${inv.rechnungsnummer ?? inv.id}_versand.eml`,
      titre: `${inv.rechnungsnummer}_versand.eml heruntergeladen — im E-Mail-Programm öffnen und senden.`,
    });
  }

  async function faireKosit(inv: Invoice) {
    setBusy("kosit");
    setMsg(null);
    try {
      const rep = await kositCheckInvoice(inv.id);
      const legs = [
        rep.cii ? `CII ${rep.cii.verdict}` : "CII —",
        rep.ubl ? `UBL ${rep.ubl.verdict}` : "UBL nicht gelaufen",
        "Peppol-Netz: nein",
      ];
      setMsg(
        rep.ok
          ? { kind: "ok", titre: `KoSIT ${rep.verdict} (JAR 1.6.2). ${legs.join(" · ")}` }
          : { kind: "err", titre: `KoSIT ${rep.verdict}`, violations: legs },
      );
      void recharger();
    } catch (e) {
      surErreur(e, "KoSIT nicht gelaufen");
    } finally {
      setBusy("");
    }
  }

  async function sauver(f: FormState, mode: "create" | "edit", inv?: Invoice) {
    const corps = corpsDepuis(f);
    if (!corps) return;
    setBusy("save"); setMsg(null);
    try {
      const out = mode === "create" ? await createInvoice(corps) : await updateInvoice(inv!.id, corps);
      ecrireAbsender({
        name: f.sellerName, street: f.sellerStreet, zip: f.sellerZip, city: f.sellerCity, vat: f.sellerVatId,
        // §123 — banque + e-mail + contact mémorisés localement aussi.
        iban: f.sellerIban, bic: f.sellerBic, kontoInhaber: f.sellerKontoInhaber, email: f.sellerEmail,
        kontaktName: f.sellerKontaktName, kontaktTelefon: f.sellerKontaktTelefon, kontaktEmail: f.sellerKontaktEmail,
      });
      setEditor(null);
      setSelectedId(out.id);
      setMsg({ kind: "ok", titre: mode === "create" ? "Entwurf gespeichert — prüfen, dann ausstellen." : "Entwurf aktualisiert." });
      void recharger();
    } catch (e) { surErreur(e, "Speichern fehlgeschlagen"); }
    finally { setBusy(""); }
  }

  const chip = (s: InvoiceStatus) => {
    const cls = {
      draft: "bg-amber-100 text-amber-800",
      issued: "bg-emerald-100 text-emerald-800",
      cancelled: "bg-slate-200 text-slate-500 line-through",
    }[s];
    return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{STATUS_LABELS[s]}</span>;
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6">
      <header className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">Rechnungen & E-Rechnung</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Entwurf → Ausstellung (Nummer RE-AAAA-NNNN vom Server, dann unveränderbar) →
          Download als XML (XRechnung), PDF/A-3 (ZUGFeRD), UBL (Peppol) oder
          E-Mail-Entwurf (.eml).
          Stornierte Rechnungen bleiben sichtbar — die Nummer wird nie neu vergeben.
        </p>
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <strong>Peppol-Netz: nicht angebunden.</strong> UBL 2.1 ist die Syntax — kein Access Point,
          keine Participant-ID, kein AS4-Versand. Datei herunterladen oder .eml senden.
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Ehrlicher Stand: das von Narchi erzeugte XRechnung-XML hat den offiziellen
          KoSIT-Validator (XRechnung 3.0.2, Stand 31.01.2026) am 13.08.2026 bestanden —
          gemessen, inklusive Bankverbindung, Kontakt und E-Mail-Adressen.
          Das PDF/A-3 (ZUGFeRD) ist konform (Mustang/veraPDF), die UBL-Syntax ist
          KoSIT-validiert. Der E-Mail-Entwurf öffnet sich im Mail-Programm zum
          Senden; der Versand über das Peppol-Netz bleibt ein späterer Schritt
          (Zugangspunkt erforderlich — siehe docs/PEPPOL.md).
        </p>
      </header>

      {stammdaten && (
        <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-800">Büro-Stammdaten (Absender XRechnung)</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Eine Akte fürs ganze Büro — nicht nur dieser Browser. Jede Rechnung behält ihre eigene Kopie (GoBD).
              </p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${stammdaten.ready ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
              {stammdaten.ready ? "XRechnung-bereit" : `${stammdaten.violations.length} Angabe(n) offen`}
            </span>
          </div>
          {!stammdaten.ready && stammdaten.violations.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-[11px] text-amber-900">
              {stammdaten.violations.map((v) => <li key={v}>{v}</li>)}
            </ul>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["name", "Büroname", stammdaten.name],
                ["street", "Straße", stammdaten.street],
                ["zip", "PLZ", stammdaten.zip],
                ["city", "Ort", stammdaten.city],
                ["vat_id", "USt-IdNr", stammdaten.vat_id],
                ["iban", "IBAN", stammdaten.iban_display || stammdaten.iban],
                ["email", "E-Mail BT-34", stammdaten.email],
                ["contact_name", "Kontakt BG-6", stammdaten.contact_name],
              ] as const
            ).map(([key, label, val]) => (
              <label key={key} className="block text-[11px]">
                <span className="mb-0.5 block font-semibold uppercase tracking-wide text-slate-500">{label}</span>
                <input
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  value={val}
                  onChange={(e) => setStammdaten((cur) => (cur ? { ...cur, [key]: e.target.value, iban: key === "iban" ? e.target.value : cur.iban } : cur))}
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={stammBusy}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              onClick={() => {
                if (!stammdaten) return;
                setStammBusy(true);
                setStammErr("");
                void saveOfficeSender(stammdaten)
                  .then((s) => {
                    setStammdaten(s);
                    ecrireAbsender(senderToAbsenderLocal(s));
                  })
                  .catch((e: unknown) => setStammErr(e instanceof Error ? e.message : "Speichern fehlgeschlagen"))
                  .finally(() => setStammBusy(false));
              }}
            >
              Stammdaten speichern (Inhaber/Admin)
            </button>
            {stammErr && <span className="text-xs text-red-600">{stammErr}</span>}
            {stammdaten.updated_at && (
              <span className="text-[11px] text-slate-400">Zuletzt {stammdaten.updated_at.slice(0, 16).replace("T", " ")}</span>
            )}
          </div>
        </section>
      )}

      {impressumOk === false && (
        <div id="rn-impressum-fehlt" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">Impressum unvollständig</p>
          <p className="mt-1 text-xs">
            Name, Anschrift und E-Mail fehlen noch (Einstellungen → Impressum).
            Narchi füllt das nicht für Sie aus.
          </p>
        </div>
      )}

      {/* §179 — Mahnwesen : les factures impayées remontent à la surface. */}
      {ueberfaellig.length > 0 && (
        <section className="mb-4 rounded-xl border border-rose-200 bg-rose-50/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-bold text-rose-800">
              <Icon name="alert" size={16} />
              Mahnwesen — {ueberfaellig.length} offene, überfällige Rechnung(en) · {summeOffen(ueberfaellig).toLocaleString("de-DE")} €
            </h2>
          </div>
          <ul className="mt-3 space-y-2">
            {ueberfaellig.map((s) => (
              <li key={s.rechnung.id} className="rounded-lg border border-rose-100 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-800">
                      {s.rechnung.rechnungsnummer ?? "ohne Nummer"}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      {s.rechnung.buyer_name} · {s.tageUeberfaellig} Tage überfällig · Stufe {s.stufe}
                    </span>
                  </div>
                  <span className="font-display text-sm font-bold text-rose-700">
                    {s.betragBrut.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setMahnungFuer(mahnungFuer === s.rechnung.id ? null : s.rechnung.id)}
                    className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {mahnungFuer === s.rechnung.id ? "Mahnung ausblenden" : "Mahnung anzeigen"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyMahnung(s.rechnung.id)}
                    className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Mahnung kopieren
                  </button>
                  <button
                    type="button"
                    onClick={() => markiereBezahlt(s.rechnung.id)}
                    className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700"
                  >
                    Als bezahlt markieren
                  </button>
                </div>
                {mahnungFuer === s.rechnung.id && (
                  <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
                    {mahnungText(s)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Barre d'outils */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          id="rn-new"
          type="button"
          onClick={() => { setEditor({ mode: "create" }); setMsg(null); }}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + Neue Rechnung
        </button>
        <select
          aria-label="Status filtern"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | InvoiceStatus)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Alle Status</option>
          <option value="draft">Entwurf</option>
          <option value="issued">Ausgestellt</option>
          <option value="cancelled">Storniert</option>
        </select>
        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); setQApplied(qInput.trim()); }}
        >
          <input
            id="rn-search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Nummer oder Kunde suchen…"
            className="w-52 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">
            Suchen
          </button>
        </form>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            id="rn-filter-projekt"
            type="checkbox"
            checked={nurAktivesProjekt}
            onChange={(e) => setNurAktivesProjekt(e.target.checked)}
          />
          Nur aktuelles Projekt
          {nurAktivesProjekt && !(activeProject?.id || "").trim() && (
            <span className="text-amber-700">— keines gewählt, Liste leer möglich</span>
          )}
        </label>
      </div>

      {msg && <div className="mb-4"><PanneauMessage msg={msg} /></div>}

      <div className="grid gap-4 xl:grid-cols-[1fr,420px]">
        {/* LISTE */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Rechnungsbuch (nur Ihr Büro)</h2>
          {loadErr && <p className="text-sm text-red-600">Laden fehlgeschlagen: {loadErr}</p>}
          {items === null && !loadErr && <p className="text-sm text-slate-400">Laden…</p>}
          {items !== null && items.length === 0 && !loadErr && (
            <p id="rn-empty" className="text-sm text-slate-500">
              Noch keine Rechnungen. Mit „+ Neue Rechnung“ starten — der Entwurf ist
              frei änderbar, erst die Ausstellung vergibt Nummer und Datum.
            </p>
          )}
          {(items ?? []).map((inv) => (
            <button
              key={inv.id}
              type="button"
              onClick={() => { setSelectedId(inv.id); setMsg(null); setConfirmDelete(null); setStornoFor(null); }}
              className={`mb-2 block w-full rounded-lg border p-3 text-left transition hover:border-brand-400 ${
                selectedId === inv.id ? "border-brand-500 bg-brand-50" : "border-slate-200"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">
                  {inv.rechnungsnummer ?? "Entwurf (ohne Nummer)"}
                </span>
                {chip(inv.status)}
              </span>
              <span className="mt-0.5 block truncate text-xs text-slate-500">
                {inv.buyer_name} · {inv.issue_date ?? "noch nicht ausgestellt"}
                {" · "}
                {inv.project_id
                  ? (projects.find((p) => p.id === inv.project_id)?.name || inv.project_id)
                  : "keinem Projekt zugeordnet"}
              </span>
              <span className="mt-1 block text-sm font-semibold text-slate-900">
                {formatEur(centsOf(inv.total_brut))}
                <span className="ml-2 text-xs font-normal text-slate-400">
                  netto {formatEur(centsOf(inv.total_net))} + MwSt {formatEur(centsOf(inv.total_tva))}
                </span>
              </span>
            </button>
          ))}
        </section>

        {/* DÉTAIL / ÉDITEUR */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          {editor ? (
            <EditeurRechnung
              editor={editor}
              busy={busy === "save"}
              onCancel={() => setEditor(null)}
              onSave={sauver}
            />
          ) : selected ? (
            <DetailRechnung
              inv={selected}
              busy={busy}
              confirmDelete={confirmDelete}
              stornoFor={stornoFor}
              stornoReason={stornoReason}
              setStornoReason={setStornoReason}
              onEdit={() => setEditor({ mode: "edit", inv: selected })}
              onIssue={() => void faireIssue(selected)}
              onValidate={() => void faireValidation(selected)}
              onAskDelete={() => setConfirmDelete(selected.id)}
              onCancelDelete={() => setConfirmDelete(null)}
              onDelete={() => void faireDelete(selected)}
              onAskStorno={() => { setStornoFor(selected.id); setStornoReason(""); }}
              onCancelStorno={() => setStornoFor(null)}
              onStorno={() => void faireStorno(selected)}
              onXml={() => void faireXml(selected)}
              onZugferd={() => void faireZugferd(selected)}
              onUbl={() => void faireUbl(selected)}
              onVersand={() => void faireVersand(selected)}
              onKosit={() => void faireKosit(selected)}
            />
          ) : (
            <p className="text-sm text-slate-400">
              Links eine Rechnung wählen oder neu anlegen. Der Server rechnet
              verbindlich; die Vorschau hier nutzt dieselbe Rechenweise.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

// --- Détail -----------------------------------------------------------------

function DetailRechnung(props: {
  inv: Invoice; busy: string;
  confirmDelete: string | null; stornoFor: string | null;
  stornoReason: string; setStornoReason: (v: string) => void;
  onEdit: () => void; onIssue: () => void; onValidate: () => void;
  onAskDelete: () => void; onCancelDelete: () => void; onDelete: () => void;
  onAskStorno: () => void; onCancelStorno: () => void; onStorno: () => void;
  onXml: () => void; onZugferd: () => void; onUbl: () => void; onVersand: () => void;
  onKosit: () => void;
}) {
  const { inv } = props;
  const luecken = inv.status === "draft" ? lueckenVorAusstellung(inv) : [];
  const bouton = "rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40";
  const primaire = "rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40";
  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-700">
        {inv.rechnungsnummer ?? "Entwurf"} — {inv.buyer_name}
      </h2>
      <dl className="mt-2 space-y-1 text-xs text-slate-600">
        {inv.issue_date && <div>Ausgestellt am: <strong>{inv.issue_date}</strong></div>}
        {inv.delivery_date && <div>Leistungsdatum: {inv.delivery_date}</div>}
        {inv.period_start && inv.period_end && <div>Zeitraum: {inv.period_start} bis {inv.period_end}</div>}
        {inv.due_date && <div>Zahlbar bis: {inv.due_date}</div>}
        {inv.buyer_reference && <div>Leitweg-ID: {inv.buyer_reference}</div>}
        {inv.status === "cancelled" && (
          <div className="rounded-lg bg-slate-100 p-2 text-slate-600">
            Storniert{inv.cancelled_at ? ` am ${inv.cancelled_at.slice(0, 10)}` : ""}
            {inv.cancel_reason ? ` — Grund: ${inv.cancel_reason}` : ""}. Die Nummer bleibt reserviert.
          </div>
        )}
      </dl>

      <table className="mt-3 w-full text-xs">
        <thead>
          <tr className="text-left text-slate-400">
            <th className="py-1 pr-2 font-medium">Leistung</th>
            <th className="py-1 pr-2 font-medium">Menge</th>
            <th className="py-1 pr-2 font-medium">Preis</th>
            <th className="py-1 font-medium">MwSt</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="py-1 pr-2">{l.designation}</td>
              <td className="py-1 pr-2">{l.quantite} {EINHEIT_OPTIONS.find((e) => e.value === l.unite)?.label ?? l.unite}</td>
              <td className="py-1 pr-2">{formatEur(centsOf(l.prix_unitaire_ht))}</td>
              <td className="py-1">{l.taux_tva} %</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 space-y-0.5 text-right text-sm">
        <div>Netto: <strong>{formatEur(centsOf(inv.total_net))}</strong></div>
        <div>MwSt: <strong>{formatEur(centsOf(inv.total_tva))}</strong></div>
        <div className="text-base">Brutto: <strong>{formatEur(centsOf(inv.total_brut))}</strong></div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {inv.status === "draft" && luecken.length > 0 && (
          <div id="rn-luecken" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-semibold">Noch nicht ausstellbar — {luecken.length} Angabe(n) fehlen:</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {luecken.map((x) => <li key={x}>{x}</li>)}
            </ul>
            <p className="mt-1 text-[11px] text-amber-800">
              Nichts wird erfunden. Bearbeiten Sie den Entwurf — der Server prüft erneut bei « Ausstellen ».
            </p>
          </div>
        )}
        {inv.status === "draft" && (
          <>
            <button type="button" className={primaire} disabled={!!props.busy || luecken.length > 0} onClick={props.onIssue}>
              Ausstellen (Nummer vergeben)
            </button>
            <button type="button" className={bouton} disabled={!!props.busy} onClick={props.onEdit}>Bearbeiten</button>
            <button type="button" className={bouton} disabled={!!props.busy} onClick={props.onValidate}>Pflichtangaben prüfen</button>
            {props.confirmDelete !== inv.id ? (
              <button type="button" className={bouton} disabled={!!props.busy} onClick={props.onAskDelete}>Löschen</button>
            ) : (
              <span className="flex items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-2 text-xs">
                Entwurf wirklich löschen?
                <button type="button" className="px-2 py-1 font-semibold text-red-700" onClick={props.onDelete}>Ja</button>
                <button type="button" className="px-2 py-1" onClick={props.onCancelDelete}>Nein</button>
              </span>
            )}
            <p className="w-full text-[11px] leading-snug text-slate-500">
              Download (XML · PDF/A-3 · UBL · E-Mail) wird erst nach der
              Ausstellung freigeschaltet — ein Entwurf hat noch keine Nummer
              und kein offizielles Dokument (GoBD). Vorher « Ausstellen » :
              der Server prüft alle Pflichtangaben und nennt genau, was fehlt.
            </p>
          </>
        )}
        {inv.status === "issued" && (
          <>
            <button type="button" className={primaire} disabled={!!props.busy} onClick={props.onXml}>
              XML herunterladen (XRechnung)
            </button>
            <button type="button" className={bouton} disabled={!!props.busy} onClick={props.onZugferd}>
              PDF/A-3 herunterladen (ZUGFeRD)
            </button>
            <button type="button" className={bouton} disabled={!!props.busy} onClick={props.onUbl}>
              UBL herunterladen (Peppol)
            </button>
            <button type="button" className={bouton} disabled={!!props.busy} onClick={props.onVersand}>
              E-Mail-Entwurf (.eml)
            </button>
            <button
              type="button"
              id="rn-kosit"
              className={bouton}
              disabled={!!props.busy}
              onClick={props.onKosit}
              title="Offizieller KoSIT-JAR im Docker-Profil kosit. Ohne Sidecar: ehrliche 503."
            >
              KoSIT pruefen
            </button>
            <button type="button" className={bouton} disabled={!!props.busy} onClick={props.onValidate}>Pflichtangaben prüfen</button>
            {props.stornoFor !== inv.id ? (
              <button type="button" className={bouton} disabled={!!props.busy} onClick={props.onAskStorno}>Stornieren…</button>
            ) : (
              <div className="w-full rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs">
                <label className="block" htmlFor="rn-storno-reason">
                  Grund (erscheint im Rechnungsbuch):
                  <input
                    id="rn-storno-reason"
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                    value={props.stornoReason}
                    onChange={(e) => props.setStornoReason(e.target.value)}
                    placeholder="z. B. falsche Leistungsperiode"
                  />
                </label>
                <div className="mt-2 flex gap-2">
                  <button type="button" className="rounded bg-amber-600 px-3 py-1 font-semibold text-white" onClick={props.onStorno}>
                    Endgültig stornieren
                  </button>
                  <button type="button" className="rounded px-3 py-1" onClick={props.onCancelStorno}>Abbrechen</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// --- Éditeur ----------------------------------------------------------------

function EditeurRechnung(props: {
  editor: { mode: "create" } | { mode: "edit"; inv: Invoice };
  busy: boolean;
  onCancel: () => void;
  onSave: (f: FormState, mode: "create" | "edit", inv?: Invoice) => void;
}) {
  const { activeProject } = useApp();
  const start = props.editor.mode === "edit"
    ? { form: formDepuis(props.editor.inv), hinweis: "" }
    : formCreateFromProject(activeProject);
  const [f, setF] = useState<FormState>(() => start.form);
  const [hinweis] = useState(start.hinweis);
  const set = (patch: Partial<FormState>) => setF((cur) => ({ ...cur, ...patch }));
  const setLigne = (i: number, patch: Partial<LigneDraft>) =>
    setF((cur) => ({ ...cur, lignes: cur.lignes.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const valides = lignesValides(f);
  const corps = corpsDepuis(f);
  const preview = previewTotals(valides);
  const apercuIncomplet = valides.length !== f.lignes.length;

  const erreurLigne = (l: LigneDraft) => {
    if (!l.designation.trim()) return "Bezeichnung fehlt";
    if (parseQuantite(l.quantite) === null) return "Menge ungültig (> 0, max. 6 Dezimalstellen)";
    if (parsePrix(l.prix) === null) return "Preis ungültig (z. B. 4.000,00 oder 33,3350)";
    if (parsePrix(l.taux) === null || centsOf(parsePrix(l.taux) ?? "0") > 10000n) return "MwSt-Satz ungültig (0–100)";
    return "";
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (corps) props.onSave(f, props.editor.mode, props.editor.mode === "edit" ? props.editor.inv : undefined);
      }}
    >
      <h2 className="text-sm font-semibold text-slate-700">
        {props.editor.mode === "create" ? "Neue Rechnung (Entwurf)" : `Entwurf bearbeiten — ${props.editor.inv.rechnungsnummer ?? "noch ohne Nummer"}`}
      </h2>

      {/* §149 — Test du flux complet en 1 clic : remplit un exemple VALIDE.
          Honnête : « Testdaten » dit noir sur blanc. */}
      <button
        id="rn-exemple"
        type="button"
        onClick={() => setF(formExemple())}
        className="mt-2 rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100"
      >
        Beispiel ausfüllen (Testdaten)
      </button>
      {hinweis && (
        <p id="rn-from-project" className="mt-2 text-[11px] leading-snug text-slate-600">{hinweis}</p>
      )}

      <div className="mt-3 space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Kunde (Empfänger)</h3>
        <Champ id="rn-buyer-name" label="Kundenname *" value={f.buyerName} onChange={(v) => set({ buyerName: v })}
          erreur={!f.buyerName.trim() && f.buyerName !== ""} placeholder="Stadt Hannover — Gebäudemanagement" />
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <Champ id="rn-buyer-street" label="Straße" value={f.buyerStreet} onChange={(v) => set({ buyerStreet: v })} placeholder="Trammplatz 2" />
          </div>
          <Champ id="rn-buyer-zip" label="PLZ" value={f.buyerZip} onChange={(v) => set({ buyerZip: v })} placeholder="30159" />
        </div>
        <Champ id="rn-buyer-city" label="Ort" value={f.buyerCity} onChange={(v) => set({ buyerCity: v })} placeholder="Hannover" />
        <Champ id="rn-buyer-reference" label="Leitweg-ID (öffentliche Auftraggeber)" value={f.buyerReference}
          onChange={(v) => set({ buyerReference: v })} placeholder="04011000-2026-4711"
          hint="Pflicht im Profil XRechnung. Steht im Bescheid der Behörde; ohne sie verweigert Narchi die Ausstellung." />
        <Champ id="rn-buyer-email" label="E-Mail für den E-Rechnungsempfang (BT-49)" value={f.buyerEmail}
          onChange={(v) => set({ buyerEmail: v })} placeholder="erfassung@behoerde.de" type="email"
          hint="Pflicht für XRechnung (elektronische Adresse). Erfragen Sie sie bei der Behörde — Narchi erfindet sie nicht." />
      </div>

      <div className="mt-4 space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Absender (Ihr Büro — wird lokal gemerkt)</h3>
        <Champ id="rn-seller-name" label="Büroname" value={f.sellerName} onChange={(v) => set({ sellerName: v })} />
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <Champ id="rn-seller-street" label="Straße" value={f.sellerStreet} onChange={(v) => set({ sellerStreet: v })} />
          </div>
          <Champ id="rn-seller-zip" label="PLZ" value={f.sellerZip} onChange={(v) => set({ sellerZip: v })} />
        </div>
        <Champ id="rn-seller-city" label="Ort" value={f.sellerCity} onChange={(v) => set({ sellerCity: v })} />
        <Champ id="rn-seller-vat" label="USt-IdNr" value={f.sellerVatId} onChange={(v) => set({ sellerVatId: v })}
          placeholder="DE123456789" hint="Pflicht (BT-31). Narchi erfindet sie niemals — sie kommt aus Ihrem Finanzamtbescheid." />
        <Champ id="rn-seller-email" label="E-Mail (elektronische Adresse, BT-34)" value={f.sellerEmail}
          onChange={(v) => set({ sellerEmail: v })} placeholder="buchhaltung@ihr-buero.de" type="email"
          hint="Pflicht für XRechnung (gemessen am offiziellen KoSIT-Validator). Wird in jedes XML geschrieben." />
      </div>

      <div className="mt-4 space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
          Kontakt für Rückfragen (XRechnung-Pflicht, BG-6)
        </h3>
        <Champ id="rn-seller-kontakt-name" label="Name der Kontaktperson" value={f.sellerKontaktName}
          onChange={(v) => set({ sellerKontaktName: v })} placeholder="A. Muster" />
        <div className="grid grid-cols-2 gap-2">
          <Champ id="rn-seller-kontakt-tel" label="Telefon" value={f.sellerKontaktTelefon}
            onChange={(v) => set({ sellerKontaktTelefon: v })} placeholder="+49 511 1234567" />
          <Champ id="rn-seller-kontakt-email" label="E-Mail der Kontaktperson" value={f.sellerKontaktEmail}
            onChange={(v) => set({ sellerKontaktEmail: v })} placeholder="a.muster@ihr-buero.de" type="email" />
        </div>
        <p className="text-[11px] text-slate-400">
          Der KoSIT-Validator verlangt diese Angaben (Regel BR-DE-2). Ohne sie verweigert Narchi die Ausstellung — ehrlich, statt still etwas zu erfinden.
        </p>
      </div>

      <div className="mt-4 space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
          Bankverbindung für die Zahlung (XRechnung-Pflicht, BG-16)
        </h3>
        <Champ id="rn-seller-iban" label="IBAN *" value={f.sellerIban}
          onChange={(v) => set({ sellerIban: v })} placeholder="DE89 3704 0044 0532 0130 00"
          hint="Pflicht (Regel BR-DE-1). Leerzeichen sind egal — sie werden für das XML entfernt; eine ungültige IBAN wird ehrlich zurückgewiesen, nie korrigiert." />
        <div className="grid grid-cols-2 gap-2">
          <Champ id="rn-seller-konto" label="Kontoinhaber" value={f.sellerKontoInhaber}
            onChange={(v) => set({ sellerKontoInhaber: v })} placeholder="Ihr Büro GmbH" />
          <Champ id="rn-seller-bic" label="BIC (optional)" value={f.sellerBic}
            onChange={(v) => set({ sellerBic: v })} placeholder="COBADEFFXXX" />
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Leistungszeitraum / Fälligkeit</h3>
        <div className="grid grid-cols-2 gap-2">
          <Champ id="rn-delivery" label="Leistungsdatum" type="date" value={f.deliveryDate} onChange={(v) => set({ deliveryDate: v })} />
          <Champ id="rn-due" label="Zahlbar bis" type="date" value={f.dueDate} onChange={(v) => set({ dueDate: v })} />
          <Champ id="rn-perfrom" label="Zeitraum von (statt Leistungsdatum)" type="date" value={f.periodStart} onChange={(v) => set({ periodStart: v })} />
          <Champ id="rn-perto" label="Zeitraum bis" type="date" value={f.periodEnd} onChange={(v) => set({ periodEnd: v })} />
        </div>
        <p className="text-[11px] text-slate-400">
          XRechnung verlangt das Leistungsdatum ODER einen Zeitraum — mindestens eins davon ausfüllen.
        </p>
      </div>

      <div className="mt-4 space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Leistungen</h3>
        {f.lignes.map((l, i) => {
          const err = erreurLigne(l);
          return (
            <div key={i} className={`rounded-lg border p-2 ${err ? "border-red-300 bg-red-50" : "border-slate-200"}`}>
              <input
                aria-label={`Leistung ${i + 1}`}
                className="mb-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                placeholder={`Leistung ${i + 1} (z. B. Grundleistungen LP 5)`}
                value={l.designation}
                onChange={(e) => setLigne(i, { designation: e.target.value })}
              />
              <div className="grid grid-cols-[70px,1fr,90px,64px,28px] items-center gap-1 text-xs">
                <input aria-label={`Menge ${i + 1}`} className="rounded border border-slate-300 px-1 py-1"
                  value={l.quantite} onChange={(e) => setLigne(i, { quantite: e.target.value })} />
                <select aria-label={`Einheit ${i + 1}`} className="rounded border border-slate-300 px-1 py-1"
                  value={l.unite} onChange={(e) => setLigne(i, { unite: e.target.value })}>
                  {EINHEIT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input aria-label={`Einzelpreis ${i + 1}`} className="rounded border border-slate-300 px-1 py-1"
                  placeholder="netto" value={l.prix} onChange={(e) => setLigne(i, { prix: e.target.value })} />
                <select aria-label={`MwSt ${i + 1}`} className="rounded border border-slate-300 px-1 py-1"
                  value={l.taux} onChange={(e) => setLigne(i, { taux: e.target.value })}
                  title="Nur voller/ermäßigter Satz (Kategorie S). Steuerfrei/Reverse-Charge: nächster Schritt, bewusst nicht angeboten.">
                  <option value="19">19 %</option>
                  <option value="7">7 %</option>
                </select>
                <button type="button" aria-label={`Zeile ${i + 1} entfernen`}
                  className="text-slate-400 hover:text-red-600"
                  onClick={() => setF((cur) => ({ ...cur, lignes: cur.lignes.filter((_, j) => j !== i) }))}
                  disabled={f.lignes.length <= 1}>
                  ×
                </button>
              </div>
              {err && <p className="mt-1 text-[11px] text-red-600">{err}</p>}
            </div>
          );
        })}
        <button type="button" id="rn-add-line"
          className="text-xs font-semibold text-brand-700 hover:underline"
          onClick={() => setF((cur) => ({ ...cur, lignes: [...cur.lignes, { designation: "", quantite: "1", unite: "stueck", prix: "", taux: "19" }] }))}>
          + Zeile hinzufügen
        </button>
      </div>

      <div className="mt-3">
        <label className="block text-xs" htmlFor="rn-notes">
          <span className="mb-1 block font-semibold uppercase tracking-wide text-slate-500">Notizen (eine pro Zeile)</span>
          <textarea id="rn-notes" rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
      </div>

      {/* APERÇU — mêmes règles que le serveur, dit explicitement */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Vorschau (Server rechnet verbindlich — dieselbe Rundung)
        </p>
        {apercuIncomplet && (
          <p className="mb-1 text-[11px] text-amber-700">
            Mindestens eine Zeile ist unvollständig — sie fehlt in der Vorschau.
          </p>
        )}
        <div className="flex justify-between"><span>Netto</span><strong>{formatEur(preview.netCents)}</strong></div>
        {preview.groupes.map((g) => (
          <div key={g.taux} className="flex justify-between text-xs text-slate-500">
            <span>MwSt {parseFloat(g.taux)} % auf {formatEur(g.baseCents)}</span>
            <span>{formatEur(g.tvaCents)}</span>
          </div>
        ))}
        <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 text-base">
          <span>Brutto</span><strong>{formatEur(preview.brutCents)}</strong>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button id="rn-save" type="submit" disabled={!corps || props.busy}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40">
          {props.editor.mode === "create" ? "Entwurf speichern" : "Änderungen speichern"}
        </button>
        <button type="button" className="rounded-lg border border-slate-300 px-4 py-2 text-sm" onClick={props.onCancel}>
          Abbrechen
        </button>
        {!corps && (
          <span className="self-center text-[11px] text-red-600">
            Kundenname + mindestens eine vollständige Leistungszeile fehlen noch.
          </span>
        )}
      </div>
    </form>
  );
}
