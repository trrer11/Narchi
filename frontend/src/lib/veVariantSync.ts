// §163 — Synchro des VE-Varianten (miroir serveur `/api/v5/ve-variant-sync`).
//
// Modèle de synchro SIMPLE, dit honnêtement (≠ Projets §118) : pas de file
// hors-ligne ni de delta à curseur — un « pull au chargement » (liste serveur,
// fusion LWW par id) et un « push best-effort » à chaque sauvegarde/suppression.
// Suffisant pour une exploration de conception (5 variantes max) ; si le
// serveur est injoignable, la variante reste en localStorage (rien ne se perd).
//
// Toutes les conversions + la fusion sont PURES (testables) ; seuls les appels
// HTTP touchent le réseau (secureFetch, dégradation silencieuse honnête).

import { secureFetch } from "@/auth/SecuritySanitizer";
import type { VEVariant } from "@/lib/veVariants";

const API = "/api/v5/ve-variant-sync";

interface RemoteVEVariant {
  id: string;
  name: string;
  payload: Record<string, unknown>;
  created_by: string;
  created_at: string | null;
  updated_at: string;
  deleted_at: string | null;
}

/** La variante → l'item de synchro (payload = fiche complète). */
export function variantToItem(v: VEVariant): {
  id: string;
  name: string;
  payload: Record<string, unknown>;
  updated_at: string;
} {
  return {
    id: v.id,
    name: v.label,
    payload: {
      savedAt: v.savedAt,
      projectName: v.projectName,
      selectedKeys: v.selectedKeys,
      totalCo2SavedKg: v.totalCo2SavedKg,
      totalEurDelta: v.totalEurDelta,
      co2SavedPct: v.co2SavedPct,
      newPerM2Kg: v.newPerM2Kg,
      count: v.count,
    },
    updated_at: v.savedAt,
  };
}

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((e): e is string => typeof e === "string") : [];
}
function asNumberOrNull(x: unknown): number | null {
  return typeof x === "number" ? x : null;
}

/** L'item serveur → la variante locale (reconstruction tolérante). */
export function remoteToVariant(r: RemoteVEVariant): VEVariant {
  const p = r.payload ?? {};
  return {
    id: r.id,
    label: r.name,
    savedAt: r.updated_at,
    projectName: typeof p.projectName === "string" ? p.projectName : "",
    selectedKeys: asStringArray(p.selectedKeys),
    totalCo2SavedKg: typeof p.totalCo2SavedKg === "number" ? p.totalCo2SavedKg : 0,
    totalEurDelta: typeof p.totalEurDelta === "number" ? p.totalEurDelta : 0,
    co2SavedPct: asNumberOrNull(p.co2SavedPct),
    newPerM2Kg: asNumberOrNull(p.newPerM2Kg),
    count: typeof p.count === "number" ? p.count : 0,
  };
}

/** Fusion PUR LWW par id : le plus récent gagne, union des deux listes,
 * triée plus récent d'abord. Local plus récent → conservé (il re-poussera). */
export function reconcileVEVariants(local: VEVariant[], remote: VEVariant[]): VEVariant[] {
  const byId = new Map<string, VEVariant>();
  for (const v of local) byId.set(v.id, v);
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l || r.savedAt > l.savedAt) byId.set(r.id, r);
  }
  return [...byId.values()].sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

/** Push best-effort d'une variante. `false` = serveur injoignable (rien ne
 * se perd : la variante reste en localStorage). */
export async function pushVEVariant(v: VEVariant): Promise<boolean> {
  try {
    const res = await secureFetch(`${API}/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [variantToItem(v)] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Pull : liste serveur (tombstones exclues), reconstruite en variantes. */
export async function pullVEVariants(): Promise<VEVariant[]> {
  try {
    const res = await secureFetch(API);
    if (!res.ok) return [];
    const body = (await res.json()) as { variants: RemoteVEVariant[] };
    return (body.variants ?? []).filter((r) => !r.deleted_at).map(remoteToVariant);
  } catch {
    return [];
  }
}

/** Suppression best-effort côté serveur (404 = déjà partie = atteint). */
export async function deleteVEVariantRemote(id: string): Promise<boolean> {
  try {
    const res = await secureFetch(`${API}/${encodeURIComponent(id)}`, { method: "DELETE" });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}
