/**
 * §202 — pull/push best-effort des blobs bureau (même modèle que §163).
 * Hors-ligne = localStorage seul. LWW sur updated_at.
 */
import { secureFetch } from "@/auth/SecuritySanitizer";

export type OfficeBlobKind =
  | "mahnwesen"
  | "stunden"
  | "entscheidungen"
  | "bauteile"
  | "szenarien"
  | "absender"
  | "abschlag"
  | "worklog"
  | "kalender"
  | "impressum"
  | "scope";

export async function pullOfficeBlob(kind: OfficeBlobKind): Promise<{
  payload: Record<string, unknown>;
  updatedAt: string;
  empty: boolean;
} | null> {
  try {
    const res = await secureFetch(`/api/v5/office-blob/${kind}`);
    if (!res.ok) return null;
    const body = (await res.json()) as {
      payload?: Record<string, unknown>;
      updated_at?: string;
      empty?: boolean;
    };
    return {
      payload: body.payload ?? {},
      updatedAt: body.updated_at ?? new Date(0).toISOString(),
      empty: Boolean(body.empty),
    };
  } catch {
    return null;
  }
}

export async function pushOfficeBlob(
  kind: OfficeBlobKind,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await secureFetch(`/api/v5/office-blob/${kind}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload, updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Fusion cartes paiement : « bezahlt » gagne. */
export function mergeZahlungen(
  local: Record<string, string>,
  remote: Record<string, unknown>,
): Record<string, "offen" | "bezahlt"> {
  const out: Record<string, "offen" | "bezahlt"> = {};
  for (const [k, v] of Object.entries(local)) {
    if (v === "bezahlt" || v === "offen") out[k] = v;
  }
  for (const [k, v] of Object.entries(remote)) {
    if (v === "bezahlt") out[k] = "bezahlt";
    else if (v === "offen" && out[k] !== "bezahlt") out[k] = "offen";
  }
  return out;
}
