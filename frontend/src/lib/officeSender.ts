/** §265 — Büro-Stammdaten Absender (server). Snapshot reste sur chaque Rechnung. */
import { secureFetch } from "@/auth/SecuritySanitizer";

export interface OfficeSender {
  name: string;
  street: string;
  zip: string;
  city: string;
  country: string;
  vat_id: string;
  iban: string;
  iban_display: string;
  bic: string;
  account_name: string;
  email: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  ready: boolean;
  violations: string[];
  updated_at: string | null;
  updated_by: string | null;
  empty: boolean;
}

export function emptySender(): OfficeSender {
  return {
    name: "",
    street: "",
    zip: "",
    city: "",
    country: "DE",
    vat_id: "",
    iban: "",
    iban_display: "",
    bic: "",
    account_name: "",
    email: "",
    contact_name: "",
    contact_phone: "",
    contact_email: "",
    ready: false,
    violations: [],
    updated_at: null,
    updated_by: null,
    empty: true,
  };
}

export async function fetchOfficeSender(): Promise<OfficeSender> {
  const res = await secureFetch("/api/v5/office-sender");
  if (!res.ok) throw new Error(`Stammdaten HTTP ${res.status}`);
  return (await res.json()) as OfficeSender;
}

export async function saveOfficeSender(body: Partial<OfficeSender>): Promise<OfficeSender> {
  const res = await secureFetch("/api/v5/office-sender", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: body.name ?? "",
      street: body.street ?? "",
      zip: body.zip ?? "",
      city: body.city ?? "",
      country: body.country ?? "DE",
      vat_id: body.vat_id ?? "",
      iban: body.iban ?? "",
      bic: body.bic ?? "",
      account_name: body.account_name ?? "",
      email: body.email ?? "",
      contact_name: body.contact_name ?? "",
      contact_phone: body.contact_phone ?? "",
      contact_email: body.contact_email ?? "",
    }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (typeof j?.detail === "string") msg = j.detail;
    } catch {
      /* */
    }
    throw new Error(msg);
  }
  return (await res.json()) as OfficeSender;
}

export function senderToAbsenderLocal(s: OfficeSender) {
  return {
    name: s.name,
    street: s.street,
    zip: s.zip,
    city: s.city,
    vat: s.vat_id,
    iban: s.iban_display || s.iban,
    bic: s.bic,
    kontoInhaber: s.account_name,
    email: s.email,
    kontaktName: s.contact_name,
    kontaktTelefon: s.contact_phone,
    kontaktEmail: s.contact_email,
  };
}
