/**
 * §77 — Büro-Branding : le logo + nom du bureau sur le PDF Kostenschätzung
 * (V1.2 « waw » : « PDF client avec MON logo »). Le serveur est la SEULE
 * source de vérité (validation par octets magiques, RBAC owner) ; ici :
 * appels HTTP + garde-fous PURS et testés, identiques dans l'esprit au serveur.
 */

import { secureFetch } from "@/auth/SecuritySanitizer";
import { getApiBase } from "@/lib/apiClient";

export interface BrandingLogo {
  mime: string;
  bytes: number;
  data_url: string;
}

export interface OfficeBranding {
  office_name: string | null;
  logo: BrandingLogo | null;
  updated_at: string | null;
  updated_by: string | null;
}

/** Limite accordée avec le serveur (§77) : 512 ko BINAIRES — affichée dans l'UI. */
export const MAX_LOGO_BYTES = 512 * 1024;

export async function fetchBranding(): Promise<OfficeBranding> {
  const res = await secureFetch(`${getApiBase()}/api/v5/branding`);
  if (!res.ok) throw new Error(`Branding nicht erreichbar (HTTP ${res.status})`);
  return (await res.json()) as OfficeBranding;
}

/** Écrit l'état COMPLET : null retire le champ (c'est « entfernen »). */
export async function saveBranding(input: {
  officeName: string | null;
  logoDataUrl: string | null;
}): Promise<OfficeBranding> {
  const res = await secureFetch(`${getApiBase()}/api/v5/branding`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ office_name: input.officeName, logo_data_url: input.logoDataUrl }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { detail = (await res.json()).detail ?? detail; } catch { /* garde le code HTTP */ }
    throw new Error(`Speichern fehlgeschlagen: ${detail}`);
  }
  return (await res.json()) as OfficeBranding;
}

/* --------------------------- gardes-fous purs (testés) -------------------- */

/**
 * Même esprit que le serveur (la validation réelle se fait là-bas) :
 * refuse vite, avec la raison exacte — jamais d'envoi voué au 422.
 */
export function validateLogoFile(f: { type: string; size: number }): string | null {
  if (f.type !== "image/png" && f.type !== "image/jpeg") {
    return "Nur PNG oder JPEG — SVG aus Sicherheitsgründen nicht (Skript-Risiko).";
  }
  if (f.size === 0) return "Datei ist leer.";
  if (f.size > MAX_LOGO_BYTES) {
    return `Logo zu groß (max. 512 kB; diese Datei: ${Math.ceil(f.size / 1024)} kB).`;
  }
  return null;
}

/** FileReader → data-URL (browser ; mesuré au moment du PDF, pas ici). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}
