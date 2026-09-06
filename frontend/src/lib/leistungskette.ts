/** §240 — Digitale Leistungskette: nur echte Zustände, kein Fortschritt erfunden. */

export type KetteStatus = "leer" | "messung" | "eingabe" | "bereit";

export interface KetteSchritt {
  id: "ifc" | "din" | "hoai" | "geg" | "rechnung";
  titel: string;
  status: KetteStatus;
  wert: string;
  hinweis: string;
  href: string;
}

export function baueLeistungskette(input: {
  bauteile: number;
  ngf: number;
  ngfQuelle?: "messung" | "eingabe";
  dinNetto: number;
  hoaiAnrechenbar: number;
  hoaiNetto: number;
  gegTfa: number;
  rechnungenMitProjekt: number;
}): KetteSchritt[] {
  const ifc: KetteSchritt = {
    id: "ifc",
    titel: "Modell",
    status: input.bauteile > 0 ? "messung" : "leer",
    wert: input.bauteile > 0 ? `${input.bauteile} Bauteile` : "kein IFC",
    hinweis: input.bauteile > 0 ? "Bauteile aus dem Modell indexiert." : "IFC ablegen — sonst bleibt die Kette leer.",
    href: "/app/import",
  };
  const din: KetteSchritt = {
    id: "din",
    titel: "DIN 276",
    status: input.ngf > 0 ? (input.ngfQuelle === "messung" ? "messung" : "eingabe") : "leer",
    wert: input.ngf > 0 ? `${Math.round(input.ngf)} m² · ${Math.round(input.dinNetto).toLocaleString("de-DE")} €` : "NGF 0",
    hinweis: input.ngf > 0
      ? (input.ngfQuelle === "messung" ? "NGF aus IfcSpace." : "NGF getippt.")
      : "Ohne NGF keine Kostenschätzung.",
    href: "/app/cost",
  };
  const hoai: KetteSchritt = {
    id: "hoai",
    titel: "HOAI",
    status: input.hoaiAnrechenbar > 0 ? "eingabe" : "leer",
    wert: input.hoaiAnrechenbar > 0
      ? `${Math.round(input.hoaiNetto).toLocaleString("de-DE")} € netto`
      : "0 € anrechenbar",
    hinweis: input.hoaiAnrechenbar > 0 ? "Anrechenbare Kosten gesetzt." : "DIN KG 300+400 übernehmen oder tippen.",
    href: "/app/hoai",
  };
  const geg: KetteSchritt = {
    id: "geg",
    titel: "GEG",
    status: input.gegTfa > 0 ? "eingabe" : "leer",
    wert: input.gegTfa > 0 ? `${Math.round(input.gegTfa)} m² TFA` : "TFA 0",
    hinweis: input.gegTfa > 0 ? "Fläche für die Monatsbilanz vorhanden." : "TFA aus NGF übernehmen oder tippen.",
    href: "/app/energy",
  };
  const rechnung: KetteSchritt = {
    id: "rechnung",
    titel: "Rechnung",
    status: input.rechnungenMitProjekt > 0 ? "bereit" : "leer",
    wert: input.rechnungenMitProjekt > 0
      ? `${input.rechnungenMitProjekt} Entwurf/e`
      : "keine zu diesem Projekt",
    hinweis: "Zählung nur wenn die Liste geladen ist — sonst leer gesagt.",
    href: "/app/rechnungen",
  };
  return [ifc, din, hoai, geg, rechnung];
}

/** Vorschau: NGF × Faktor, 0 bleibt 0. Nur Anzeige, speichert nichts. */
export function ngfLabor(ngf: number, faktorPct: number): number {
  if (!(ngf > 0)) return 0;
  const f = 1 + faktorPct / 100;
  return Math.round(ngf * f * 100) / 100;
}
