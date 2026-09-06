/** §242 — Checkliste Beta-Büro. Nur lokale, prüfbare Fakten. */

export interface BetaSchritt {
  id: string;
  titel: string;
  ok: boolean;
  warum: string;
  href: string;
}

export function absenderIstGefuellt(): boolean {
  try {
    const raw = localStorage.getItem("narchi:rechnungen:absender");
    if (!raw) return false;
    const a = JSON.parse(raw) as { name?: string; vat?: string; iban?: string };
    return Boolean(String(a.name ?? "").trim() && String(a.vat ?? "").trim() && String(a.iban ?? "").trim());
  } catch {
    return false;
  }
}

export function impressumLokalGefuellt(): boolean {
  try {
    const raw = localStorage.getItem("narchi:impressum");
    if (!raw) return false;
    const o = JSON.parse(raw) as { firma?: string; strasse?: string; email?: string; plzOrt?: string };
    return Boolean(String(o.firma ?? "").trim() && String(o.strasse ?? "").trim() && String(o.email ?? "").trim() && String(o.plzOrt ?? "").trim());
  } catch {
    return false;
  }
}

export function betaCheckliste(input: {
  projektAnzahl: number;
  bauteileAktiv: number;
  ngf: number;
}): BetaSchritt[] {
  return [
    {
      id: "projekt",
      titel: "Projekt vorhanden",
      ok: input.projektAnzahl > 0,
      warum: input.projektAnzahl > 0 ? `${input.projektAnzahl} Projekt(e)` : "Ohne Projekt keine Rechnung, kein Clash, keine Stunden.",
      href: "/app/projects",
    },
    {
      id: "impressum",
      titel: "Impressum (Name, Anschrift, E-Mail)",
      ok: impressumLokalGefuellt(),
      warum: impressumLokalGefuellt() ? "Lokal ausgefüllt" : "Pflicht § 5 DDG — Narchi erfindet nichts.",
      href: "/app/settings",
    },
    {
      id: "absender",
      titel: "Absender Rechnung (Name, USt-IdNr, IBAN)",
      ok: absenderIstGefuellt(),
      warum: absenderIstGefuellt() ? "Lokal gemerkt" : "Sonst keine XRechnung.",
      href: "/app/rechnungen",
    },
    {
      id: "flaeche",
      titel: "NGF > 0 (Messung oder Eingabe)",
      ok: input.ngf > 0,
      warum: input.ngf > 0 ? `${Math.round(input.ngf)} m²` : "Ohne NGF keine DIN-276-Schätzung.",
      href: "/app/cost",
    },
    {
      id: "modell",
      titel: "IFC-Bauteile im aktiven Projekt",
      ok: input.bauteileAktiv > 0,
      warum: input.bauteileAktiv > 0 ? `${input.bauteileAktiv} Bauteile` : "Optional — Clash und Mengen brauchen ein Modell.",
      href: "/app/import",
    },
  ];
}

export const BETA_GRENZEN: { titel: string; text: string }[] = [
  { titel: "HOAI", text: "Honorartafel = Orientierung. HOAI 2021: freie Vereinbarung." },
  { titel: "DIN 276", text: "Kennwerte sind Richtwerte, keine Angebote." },
  { titel: "Clash", text: "Bounding-Box, keine Dreiecks-Kollision wie Solibri." },
  { titel: "XRechnung", text: "XML/PDF ja. Peppol-Netz nein. Impressum/IBAN selbst eintragen." },
  { titel: "Daten", text: "Beta: keine echten Mandantendaten. Sicherung: 5_SAUVEGARDE_EXTERNE.bat." },
  { titel: "2027", text: "Kein Peppol, kein Solibri-Mesh, kein Speckle, kein EnergyPlus. Clash = Bounding-Box." },
];
