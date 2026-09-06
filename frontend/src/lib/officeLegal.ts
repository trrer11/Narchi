/** Angaben § 5 DDG — vides tant que le bureau n'a rien saisi. Rien d'inventé. */

export interface OfficeLegal {
  firma: string;
  strasse: string;
  plzOrt: string;
  vertreten: string;
  email: string;
  telefon: string;
  ustId: string;
  register: string;
  gericht: string;
  hrb: string;
}

export const EMPTY_LEGAL: OfficeLegal = {
  firma: "",
  strasse: "",
  plzOrt: "",
  vertreten: "",
  email: "",
  telefon: "",
  ustId: "",
  register: "",
  gericht: "",
  hrb: "",
};

export function parseOfficeLegal(raw: Record<string, unknown> | null | undefined): OfficeLegal {
  const s = (k: keyof OfficeLegal) => {
    const v = raw?.[k];
    return typeof v === "string" ? v.trim() : "";
  };
  return {
    firma: s("firma"),
    strasse: s("strasse"),
    plzOrt: s("plzOrt"),
    vertreten: s("vertreten"),
    email: s("email"),
    telefon: s("telefon"),
    ustId: s("ustId"),
    register: s("register"),
    gericht: s("gericht"),
    hrb: s("hrb"),
  };
}

export function legalIsFilled(l: OfficeLegal): boolean {
  return Boolean(l.firma && l.strasse && l.plzOrt && l.email);
}

export function displayOrPlaceholder(value: string, placeholder: string): string {
  const v = value.trim();
  return v || placeholder;
}
