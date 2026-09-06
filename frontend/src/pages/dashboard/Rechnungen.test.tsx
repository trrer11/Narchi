/**
 * §116 — Page Rechnungen : éprouvé de bout en bout DANS le DOM (jsdom) :
 *  - état vide honnête (« Noch keine Rechnungen ») et ouverture de l'éditeur ;
 *  - saisie ALLEMANDE (« 33,3350 ») → aperçu au centime (« 100,01 € ») AVANT
 *    tout serveur, bouton grisé tant qu'une ligne est incomplète ;
 *  - envoi = CHAÎNES décimales (le corps POST est relu littéralement) ;
 *  - refus d'émission : les violations NARCHI-XR-… s'affichent TELLES QUELLES ;
 *  - cycle affiché : Entwurf → Ausgestellt (bouton XML) → zone de storno AVEC
 *    motif (une facture officielle ne disparaît jamais en silence).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act, createElement } from "react";

import Rechnungen, { formCreateFromProject, lueckenVorAusstellung } from "@/pages/dashboard/Rechnungen";
import type { Invoice } from "@/lib/invoices";

const h = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@/auth/SecuritySanitizer", () => ({ secureFetch: h.fetchMock }));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function facture(over: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    status: "draft",
    rechnungsnummer: null,
    issue_date: null,
    profile: "xrechnung",
    project_id: null,
    buyer_name: "Stadt Hannover — Gebäudemanagement",
    buyer_street: "Trammplatz 2",
    buyer_zip: "30159",
    buyer_city: "Hannover",
    buyer_country: "DE",
    buyer_reference: "04011000-2026-4711",
    seller_name: "Mein Büro",
    seller_street: "Lister Meile 1",
    seller_zip: "30161",
    seller_city: "Hannover",
    seller_country: "DE",
    seller_vat_id: "DE123456789",
    // §123 — champs KoSIT 3.0.2 (BG-16 / BT-34/49 / BG-6 / BT-23).
    seller_iban: "DE89370400440532013000",
    seller_bic: "",
    seller_account_name: "Mein Büro",
    seller_email: "buchhaltung@mein-buero.de",
    buyer_email: "erfassung@hannover-stadt.de",
    seller_contact_name: "A. Muster",
    seller_contact_phone: "+49 511 1234567",
    seller_contact_email: "a.muster@mein-buero.de",
    processus: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
    currency: "EUR",
    delivery_date: "2026-08-10",
    period_start: null,
    period_end: null,
    due_date: "2026-09-10",
    lines: [
      { designation: "LP 5", quantite: "1", unite: "forfait", prix_unitaire_ht: "4000.00", taux_tva: "19", categorie_tva: "S" },
    ],
    notes: [],
    total_net: "4000.00",
    total_tva: "760.00",
    total_brut: "4760.00",
    created_by: "u1",
    created_at: "2026-08-12T10:00:00Z",
    updated_at: "2026-08-12T10:00:00Z",
    issued_at: null,
    cancelled_at: null,
    cancel_reason: "",
    ...over,
  };
}

let hosts: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = [];

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Rechnungen)); });
  hosts.push({ host, root });
  return host;
}

async function flush() {
  await act(async () => {});
}

function setField(host: HTMLElement, selector: string, value: string) {
  const el = host.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
  expect(el, `champ introuvable : ${selector}`).toBeTruthy();
  const champ = el!;
  const proto: object =
    champ instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : champ instanceof HTMLSelectElement ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(champ, value);
  champ.dispatchEvent(new Event(champ instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

function bouton(host: HTMLElement, texte: string): HTMLButtonElement {
  const b = [...host.querySelectorAll("button")].find(
    (c) => (c.textContent ?? "").includes(texte),
  );
  expect(b, `bouton introuvable : ${texte}`).toBeTruthy();
  return b as HTMLButtonElement;
}

describe("Page Rechnungen §116", () => {
  beforeEach(() => {
    h.fetchMock.mockReset();
    localStorage.clear();
  });
  afterEach(async () => {
    for (const { host, root } of hosts) {
      await act(async () => root.unmount());
      host.remove();
    }
    hosts = [];
  });

  it("état vide honnête + ouverture de l'éditeur", async () => {
    h.fetchMock.mockResolvedValue(jsonResponse(200, { invoices: [], total: 0 }));
    const host = await mount();
    await flush();
    expect(host.textContent).toContain("Noch keine Rechnungen");
    bouton(host, "+ Neue Rechnung").click();
    await flush();
    expect(host.textContent).toContain("Kundenname");
    expect(host.textContent).toContain("Leitweg-ID (öffentliche Auftraggeber)");
    expect(host.textContent).toContain("KoSIT"); // l'honnêteté reste affichée
  });

  it("aperçu au centime sur saisie allemande, sauvegarde en CHAÎNES", async () => {
    h.fetchMock.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === "POST" && u === "/api/v5/invoices") {
        return jsonResponse(201, facture());
      }
      return jsonResponse(200, { invoices: [], total: 0 });
    });
    const host = await mount();
    await flush();
    bouton(host, "+ Neue Rechnung").click();
    await flush();

    setField(host, "#rn-buyer-name", "Stadt Hannover");
    setField(host, "#rn-seller-name", "Mein Büro");
    // §123 — les champs exigés par KoSIT 3.0.2 se saisissent dans le formulaire.
    setField(host, "#rn-buyer-email", "erfassung@hannover-stadt.de");
    setField(host, "#rn-seller-email", "buchhaltung@mein-buero.de");
    setField(host, "#rn-seller-iban", "DE89 3704 0044 0532 0130 00");
    setField(host, "#rn-seller-konto", "Mein Büro");
    setField(host, "#rn-seller-bic", "COBADEFFXXX");
    setField(host, "#rn-seller-kontakt-name", "A. Muster");
    setField(host, "#rn-seller-kontakt-tel", "+49 511 1234567");
    setField(host, "#rn-seller-kontakt-email", "a.muster@mein-buero.de");
    setField(host, 'input[aria-label="Leistung 1"]', "Stundenhonorar");
    setField(host, 'input[aria-label="Menge 1"]', "3");
    setField(host, 'input[aria-label="Einzelpreis 1"]', "33,3350");
    await flush();

    // Aperçu EXACT encore côté navigateur : 3 × 33,3350 = 100,005 → 100,01.
    expect(host.textContent).toContain("100,01 €");
    expect(host.textContent).toContain("119,01 €"); // brut avec 19 %
    const save = bouton(host, "Entwurf speichern");
    expect(save.disabled).toBe(false);

    save.click(); // submit du form
    await flush();
    await flush();

    const post = h.fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(post).toBeTruthy();
    const corps = JSON.parse(String(post![1].body));
    expect(corps.lines[0]).toMatchObject({
      designation: "Stundenhonorar",
      quantite: "3",
      prix_unitaire_ht: "33.3350", // CHAÎNE — jamais 33.3350000000000004
      taux_tva: "19",
    });
    // §123 — banque, e-mails et contact partent TELS QUE SAISIS (les espaces
    // de l'IBAN aussi : la normalisation exacte est une affaire de SERVEUR ;
    // un IBAN tordu sera refusé avec NARCHI-XR-42, jamais « arrangé » ici).
    expect(corps.seller_iban).toBe("DE89 3704 0044 0532 0130 00");
    expect(corps.seller_bic).toBe("COBADEFFXXX");
    expect(corps.seller_account_name).toBe("Mein Büro");
    expect(corps.seller_email).toBe("buchhaltung@mein-buero.de");
    expect(corps.buyer_email).toBe("erfassung@hannover-stadt.de");
    expect(corps.seller_contact_name).toBe("A. Muster");
    expect(corps.seller_contact_phone).toBe("+49 511 1234567");
    expect(corps.seller_contact_email).toBe("a.muster@mein-buero.de");
    expect("processus" in corps).toBe(false); // BT-23 : serveur, DIT dans le code
    // L'absender est mémorisé localement pour la prochaine facture.
    expect(localStorage.getItem("narchi:rechnungen:absender")).toContain("Mein Büro");
    expect(localStorage.getItem("narchi:rechnungen:absender")).toContain("DE89 3704");
  });

  it("refus d'émission : violations NARCHI-XR-… affichées TELLES QUELLES", async () => {
    h.fetchMock.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === "POST" && u.endsWith("/issue")) {
        return jsonResponse(422, {
          detail: { detail: "Ausstellung verweigert — Pflichtangaben fehlen", violations: ["NARCHI-XR-42: IBAN illisible (forme ISO 13616)"] },
        });
      }
      return jsonResponse(200, { invoices: [facture()], total: 1 });
    });
    const host = await mount();
    await flush();
    host.querySelector<HTMLButtonElement>("section button")!.click(); // ligne de liste
    await flush();
    bouton(host, "Ausstellen (Nummer vergeben)").click();
    await flush();
    await flush();
    // §149 — le titre n'est PLUS dupliqué (« Ausstellung verweigert: Ausstellung verweigert ») :
    expect(host.textContent).toContain("Ausstellung fehlgeschlagen: Ausstellung verweigert — Pflichtangaben fehlen");
    expect(host.textContent).not.toContain("Ausstellung verweigert: Ausstellung verweigert");
    expect(host.textContent).toContain("NARCHI-XR-42: IBAN illisible (forme ISO 13616)");
  });

  it("§234 create sendet project_id aus dem Formular", () => {
    const teil = formCreateFromProject({
      id: "prj-1", client: "Familie Meyer", clientStreet: "Markt 3",
      clientZip: "30159", clientCity: "Hannover", clientLeitweg: "0204:x",
    });
    expect(teil.form.projectId).toBe("prj-1");
  });

  it("§233 Empfänger aus Projekt, ohne Erfindung", () => {
    const leer = formCreateFromProject(null);
    expect(leer.form.buyerName).toBe("");
    expect(leer.hinweis).toContain("Kein aktives Projekt");
    const teil = formCreateFromProject({
      id: "p1", client: "Familie Meyer", location: "Hannover, DE",
    });
    expect(teil.form.buyerName).toBe("Familie Meyer");
    expect(teil.form.buyerCity).toBe("Hannover");
    expect(teil.form.buyerStreet).toBe("");
    expect(teil.hinweis).toContain("Straße");
    expect(teil.hinweis).toContain("Leitweg-ID");
  });

  it("§231 Lückenliste : leere Anschrift/Leitweg/IBAN werden genannt, Ausstellen gesperrt", async () => {
    const lueckig = facture({
      buyer_street: "", buyer_zip: "", buyer_city: "",
      buyer_reference: "", seller_iban: "",
    });
    expect(lueckenVorAusstellung(lueckig)).toEqual(expect.arrayContaining([
      "Anschrift des Auftraggebers unvollständig (Straße, PLZ, Ort)",
      "Leitweg-ID fehlt (Pflicht für XRechnung)",
      "IBAN fehlt (BG-16)",
    ]));
    expect(lueckenVorAusstellung(facture())).toEqual([]);

    h.fetchMock.mockImplementation(async () => jsonResponse(200, { invoices: [lueckig], total: 1 }));
    const host = await mount();
    await flush();
    host.querySelector<HTMLButtonElement>("section button")!.click();
    await flush();
    expect(host.textContent).toContain("Noch nicht ausstellbar");
    expect(host.textContent).toContain("Leitweg-ID fehlt");
    expect(bouton(host, "Ausstellen (Nummer vergeben)").disabled).toBe(true);
  });

  it("entwurf : le téléchargement est expliqué comme verrouillé (pas un bug muet)", async () => {
    h.fetchMock.mockImplementation(async () => jsonResponse(200, { invoices: [facture()], total: 1 }));
    const host = await mount();
    await flush();
    host.querySelector<HTMLButtonElement>("section button")!.click();
    await flush();
    // Sur un Entwurf, AUCUN bouton de téléchargement (GoBD) MAIS l'explication honnête :
    expect(host.textContent).toContain("Download (XML · PDF/A-3 · UBL · E-Mail) wird erst nach der");
    expect(host.textContent).not.toContain("XML herunterladen (XRechnung)");
  });

  it("bouton « Beispiel ausfüllen » remplit un IBAN valide (test du flux complet)", async () => {
    h.fetchMock.mockResolvedValue(jsonResponse(200, { invoices: [], total: 0 }));
    const host = await mount();
    await flush();
    bouton(host, "+ Neue Rechnung").click();
    await flush();
    bouton(host, "Beispiel ausfüllen (Testdaten)").click();
    await flush();
    // Le champ IBAN contient l'IBAN de test canonique (valide, §123).
    const iban = host.querySelector<HTMLInputElement>("#rn-seller-iban");
    expect(iban).toBeTruthy();
    expect(iban!.value).toBe("DE89 3704 0044 0532 0130 00");
    // Et la facture devient enregistrable (bouton actif).
    expect(bouton(host, "Entwurf speichern").disabled).toBe(false);
  });

  it("facture émise : bouton XML + storno avec MOTIF (jamais de suppression)", async () => {
    const emise = facture({
      id: "inv-9", status: "issued", rechnungsnummer: "RE-2026-0007",
      issue_date: "2026-08-12", issued_at: "2026-08-12T11:00:00Z",
    });
    h.fetchMock.mockImplementation(async () => jsonResponse(200, { invoices: [emise], total: 1 }));
    const host = await mount();
    await flush();
    host.querySelector<HTMLButtonElement>("section button")!.click();
    await flush();
    expect(host.textContent).toContain("RE-2026-0007");
    expect(host.textContent).toContain("Ausgestellt");
    bouton(host, "XML herunterladen (XRechnung)");
    // « Löschen » n'existe PAS pour une émise : uniquement Stornieren.
    expect(host.textContent).not.toContain("Entwurf wirklich löschen?");
    bouton(host, "Stornieren…").click();
    await flush();
    expect(host.querySelector("#rn-storno-reason")).toBeTruthy();
  });

  it("facture émise : les 4 sorties (XML, ZUGFeRD, UBL, .eml) sont téléchargeables", async () => {
    const emise = facture({
      id: "inv-9", status: "issued", rechnungsnummer: "RE-2026-0007",
      issue_date: "2026-08-12", issued_at: "2026-08-12T11:00:00Z",
    });
    h.fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/zugferd.pdf")) return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]), { status: 200 });
      if (u.includes("/xrechnung-ubl.xml")) return new Response("<Invoice/>", { status: 200 });
      if (u.includes("/versand.eml")) return new Response("Subject: Rechnung", { status: 200 });
      return jsonResponse(200, { invoices: [emise], total: 1 });
    });
    const host = await mount();
    await flush();
    host.querySelector<HTMLButtonElement>("section button")!.click();
    await flush();
    // Les 4 boutons sont présents pour une facture émise.
    bouton(host, "XML herunterladen (XRechnung)");
    bouton(host, "PDF/A-3 herunterladen (ZUGFeRD)");
    bouton(host, "UBL herunterladen (Peppol)");
    bouton(host, "E-Mail-Entwurf (.eml)");
  });

  it("e-mail .eml : clique → la bonne route est appelée (et le refus est dit)", async () => {
    const emise = facture({
      id: "inv-9", status: "issued", rechnungsnummer: "RE-2026-0007",
      issue_date: "2026-08-12", issued_at: "2026-08-12T11:00:00Z",
    });
    h.fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/versand.eml")) {
        // Refus honnête du serveur (ex. pas d'e-mail destinataire).
        return jsonResponse(409, { detail: "Keine E-Mail-Adresse des Kunden hinterlegt" });
      }
      return jsonResponse(200, { invoices: [emise], total: 1 });
    });
    const host = await mount();
    await flush();
    host.querySelector<HTMLButtonElement>("section button")!.click();
    await flush();
    bouton(host, "E-Mail-Entwurf (.eml)").click();
    await flush();
    await flush();
    // Le refus serveur est affiché TEL QUEL, jamais maquillé en « envoyé ».
    expect(host.textContent).toContain("Keine E-Mail-Adresse des Kunden hinterlegt");
  });

  it("ligne incomplète = bouton grisé + aperçu qui le DIT", async () => {
    h.fetchMock.mockResolvedValue(jsonResponse(200, { invoices: [], total: 0 }));
    const host = await mount();
    await flush();
    bouton(host, "+ Neue Rechnung").click();
    await flush();
    setField(host, "#rn-buyer-name", "Stadt Hannover");
    setField(host, 'input[aria-label="Leistung 1"]', "LP 5");
    setField(host, 'input[aria-label="Einzelpreis 1"]', "abc");
    await flush();
    expect(bouton(host, "Entwurf speichern").disabled).toBe(true);
    expect(host.textContent).toContain("Mindestens eine Zeile ist unvollständig");
    expect(host.textContent).toContain("Preis ungültig");
  });
});
