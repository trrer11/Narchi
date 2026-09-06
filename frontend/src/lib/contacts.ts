// NARCHI — Liste de contacts du rail Messenger (Teamkontakt).
// Logique pure et testée : la fenêtre de chat s'ouvre ensuite via
// chatService.ensureDirectChannel + openFloatingChat.

import { avatarKeyOf } from "@/lib/avatars";

export interface ContactUserLike {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
}

export interface TeamContact {
  userId: string;
  displayName: string;
  initials: string;
  roleLabel: string;
  /// Clé avatar stable (e-mail normalisé si connu, sinon « n:nom »).
  ownerKey: string;
}

export const ROLE_LABELS: Record<string, string> = {
  owner: "Büroleitung",
  architect: "Architekt:in",
  guest: "Gast",
};

export function roleLabelOf(role?: string | null): string {
  if (!role) return "Team";
  return ROLE_LABELS[role] ?? "Team";
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase();
  return initials || "??";
}

function displayNameOf(user: ContactUserLike): string {
  const name = (user.name ?? "").trim();
  if (name) return name;
  const email = (user.email ?? "").trim();
  if (email) return email;
  return "Team-Mitglied";
}

/// Construit la liste des contacts du rail : l'utilisateur courant en est
/// exclu ; tri alphabétique (locale allemande) ; filtre optionnel sur le nom
/// ou l'e-mail (insensible à la casse).
export function buildContacts(
  users: ContactUserLike[],
  meId: string,
  filter = "",
): TeamContact[] {
  const needle = filter.trim().toLowerCase();
  const seen = new Set<string>();
  const contacts: TeamContact[] = [];
  for (const user of users) {
    if (!user || typeof user.id !== "string" || !user.id) continue;
    if (user.id === meId) continue;
    if (seen.has(user.id)) continue;
    seen.add(user.id);
    const displayName = displayNameOf(user);
    const email = (user.email ?? "").toLowerCase();
    if (needle && !displayName.toLowerCase().includes(needle) && !email.includes(needle)) {
      continue;
    }
    contacts.push({
      userId: user.id,
      displayName,
      initials: initialsOf(displayName),
      roleLabel: roleLabelOf(user.role),
      ownerKey: avatarKeyOf({ email: user.email, name: displayName, id: user.id }),
    });
  }
  contacts.sort((a, b) => a.displayName.localeCompare(b.displayName, "de"));
  return contacts;
}

/* ------ partition : comptes réels (chat direct) vs identités de démo ------ */

export interface RemoteUserLike {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface ContactPartition {
  /// Collègues avec compte backend réel — Direktnachricht possible.
  withAccount: TeamContact[];
  /// Identités présentes seulement en local (démo) — pas de chat direct.
  withoutAccount: TeamContact[];
}

/// Sépare les contacts en deux listes. Le « moi » est exclu des deux listes
/// par identifiant ET par e-mail (l'id local et l'id backend peuvent
/// différer pour le même utilisateur). Les identités locales dont l'e-mail
/// correspond à un compte réel ne sont pas dupliquées.
export function partitionContacts(
  remoteUsers: RemoteUserLike[] | null,
  localUsers: ContactUserLike[],
  meId: string,
  meEmail: string,
  filter = "",
): ContactPartition {
  const meMail = meEmail.trim().toLowerCase();
  const remote = (remoteUsers ?? []).filter(
    (u) => u && typeof u.id === "string" && u.email.trim().toLowerCase() !== meMail,
  );
  const withAccount = buildContacts(remote, meId, filter);
  const takenEmails = new Set(remote.map((u) => u.email.trim().toLowerCase()));
  const takenIds = new Set(remote.map((u) => u.id));
  const withoutAccount = buildContacts(localUsers, meId, filter).filter((contact) => {
    if (takenIds.has(contact.userId)) return false;
    const local = localUsers.find((u) => u && u.id === contact.userId);
    const mail = (local?.email ?? "").trim().toLowerCase();
    if (!mail) return true;
    if (mail === meMail) return false;
    return !takenEmails.has(mail);
  });
  return { withAccount, withoutAccount };
}
