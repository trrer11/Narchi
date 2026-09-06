/**
 * §80 — Mitglieder RÉELS (PostgreSQL) + matrice Büro 3 niveaux, miroir EXACT
 * des gardes serveur (les deux sont testés ; si l'un bouge, l'autre casse).
 * L'annuaire fantôme localStorage (lib/auth « narchi:users ») n'est PLUS
 * utilisé par la gestion — les comptes créés ici existent vraiment et
 * peuvent se connecter, discuter et apparaître « online ».
 */

import { secureFetch } from "@/auth/SecuritySanitizer";
import { getApiBase } from "@/lib/apiClient";

export type MemberRole = "owner" | "admin" | "architect" | "guest";

export interface Member {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  avatar_key: string | null;
  /** §82 — contenu d'avatar (JSON {kind, photo?|emoji?}) propagé par le serveur. */
  avatar_json: string | null;
  created_at: string | null;
  last_login: string | null;
}

export interface MembersPage {
  count: number;
  your_role: string;
  members: Member[];
}

async function ensureOk(res: Response, verb: string): Promise<Response> {
  if (res.ok) return res;
  let detail = `HTTP ${res.status}`;
  try { detail = (await res.json()).detail ?? detail; } catch { /* garde le code */ }
  throw new Error(`${verb}: ${detail}`);
}

export async function fetchMembers(): Promise<MembersPage> {
  const res = await ensureOk(await secureFetch(`${getApiBase()}/api/v5/members`), "Mitglieder laden fehlgeschlagen");
  return (await res.json()) as MembersPage;
}

export async function createMember(input: { name: string; email: string; password: string; company?: string | null }): Promise<Member> {
  const res = await ensureOk(await secureFetch(`${getApiBase()}/api/v5/members`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }), "Konto erstellen fehlgeschlagen");
  return (await res.json()) as Member;
}

export async function setMemberActive(id: string, active: boolean): Promise<Member> {
  const res = await ensureOk(await secureFetch(
    `${getApiBase()}/api/v5/members/${encodeURIComponent(id)}/${active ? "activate" : "deactivate"}`,
    { method: "POST" },
  ), "Status ändern fehlgeschlagen");
  return ((await res.json()) as { member: Member }).member;
}

export async function setMemberRole(id: string, role: "admin" | "architect"): Promise<Member> {
  const res = await ensureOk(await secureFetch(`${getApiBase()}/api/v5/members/${encodeURIComponent(id)}/role`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }),
  }), "Rolle ändern fehlgeschlagen");
  return (await res.json()) as Member;
}

export async function deleteMember(id: string): Promise<{ deleted: string; removed_channel_memberships: number }> {
  const res = await ensureOk(await secureFetch(`${getApiBase()}/api/v5/members/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }), "Löschen fehlgeschlagen");
  return (await res.json()) as { deleted: string; removed_channel_memberships: number };
}

export async function updateMyProfile(input: { name?: string; avatar_key?: string | null; avatar_json?: string | null }): Promise<{ changed: boolean; member: Member }> {
  const res = await ensureOk(await secureFetch(`${getApiBase()}/api/v5/members/me`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }), "Profil speichern fehlgeschlagen");
  return (await res.json()) as { changed: boolean; member: Member };
}

/* ------------------------- matrice pure (miroir serveur) ------------------- */

export interface RoleCapabilities {
  canManageMembers: boolean;   // voir la liste + créer/désactiver/supprimer des membres
  canInvite: boolean;          // invitations par lien (owner+admin, §80)
  canChangeRoles: boolean;     // élever/rétrograder la Geschäftsführung (owner seul)
}

/** Miroir EXACT des gardes serveur (testés des deux côtés). */
export function roleCapabilities(role: string): RoleCapabilities {
  if (role === "owner") return { canManageMembers: true, canInvite: true, canChangeRoles: true };
  if (role === "admin") return { canManageMembers: true, canInvite: true, canChangeRoles: false };
  return { canManageMembers: false, canInvite: false, canChangeRoles: false };
}

/** Qui l'acteur peut modifier (hors soi-même — toujours via le profil). */
export function canEditTarget(actorRole: string, targetRole: string): boolean {
  if (actorRole === "owner") return targetRole !== "owner";
  if (actorRole === "admin") return targetRole === "architect";
  return false;
}

export function roleLabel(role: string): { label: string; tone: "emerald" | "sky" | "slate" | "amber" } {
  switch (role) {
    case "owner": return { label: "Eigentümer", tone: "emerald" };
    case "admin": return { label: "Geschäftsführung", tone: "sky" };
    case "guest": return { label: "Gast", tone: "amber" };
    default: return { label: "Mitglied", tone: "slate" };
  }
}

export function statusLabel(isActive: boolean): string {
  return isActive ? "aktiv" : "deaktiviert";
}

/** Texte du panneau identifiants (affiché UNE fois après création). */
export function onceCredentialsText(name: string, email: string, password: string): string {
  return `${name} · ${email} · Passwort: ${password}`;
}
