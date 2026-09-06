/**
 * §80 — Team : plus d'annuaire fantôme navigateur (cause réelle des
 * « comptes qui ne se contactent pas »). Tout vient de /api/v5/members
 * (PostgreSQL, cloisonné, audité) ; la matrice UI est le miroir des gardes
 * serveur — un compte créé ici peut se connecter, discuter, apparaître
 * « online ». Onglet Nachrichten conservé tel quel.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/store/AuthStore";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui";
import InvitePanel from "@/components/InvitePanel";
import UserAvatar from "@/components/UserAvatar";
import SharedNotiz from "@/components/SharedNotiz";
import SharedLv from "@/components/SharedLv";
import Messages from "./Messages";
import { avatarKeyOf, hydrateAvatarsFromServer } from "@/lib/avatars";
import { relativeTime } from "@/lib/format";
import { generatePassword } from "@/utils/uid";
import {
  canEditTarget,
  createMember,
  deleteMember,
  fetchMembers,
  onceCredentialsText,
  roleCapabilities,
  roleLabel,
  setMemberActive,
  setMemberRole,
  statusLabel,
  type Member,
} from "@/lib/members";

type Tab = "members" | "messages" | "notiz";

export default function Team() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("members");
  const [page, setPage] = useState<{ count: number; your_role: string; members: Member[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const myRole = page?.your_role ?? user?.role ?? "architect";
  const caps = roleCapabilities(myRole);

  useEffect(() => {
    if (!caps.canManageMembers) return;
    let live = true;
    setLoadError(null);
    fetchMembers()
      .then((p) => {
        if (!live) return;
        // §82 — verse les avatars serveur dans le registre local : l'icône
        // de chacun devient visible chez tous les membres du bureau.
        hydrateAvatarsFromServer(p.members);
        setPage(p);
      })
      .catch((e) => { if (live) setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [refreshKey, caps.canManageMembers]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        subtitle="Mitglieder RÉELS du bureau (Base de données, pas de navigateur) — owner > Geschäftsführung > Mitglied"
        actions={
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {(["members", "messages", "notiz"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
              >
                {t === "members" ? "Mitglieder" : t === "messages" ? "Nachrichten" : "Notiz (live)"}
              </button>
            ))}
          </div>
        }
      />

      {tab === "messages" && <Messages />}
      {tab === "notiz" && (
        <>
          <Card className="p-4">
            <p className="text-xs text-slate-500">
              Echter Live-Text (CRDT): alle Mitglieder des Büros bearbeiten dieselbe
              Notiz gleichzeitig — Änderungen verschmelzen ohne Überschreiben,
              gespeichert wird serverseitig — kein Browser-Entwurf, kein Demo-Feld.
            </p>
          </Card>
          {/* §89 — positions LV co-éditées : MÊME connexion CRDT que la
              Notiz (slot handle) — jamais de seconde WebSocket. */}
          <SharedNotiz>{(handle) => <SharedLv handle={handle} />}</SharedNotiz>
        </>
      )}
      {tab === "members" && (
        <>
          {!caps.canManageMembers ? (
            <Card className="p-5">
              <p className="text-sm text-slate-600">
                Die Mitgliederverwaltung ist dem Eigentümer und der Geschäftsführung vorbehalten.
                Ihr Profil (Name, Passwort, Avatar) ändern Sie unter <b>Einstellungen</b> — das ist Ihr Selbstservice.
              </p>
            </Card>
          ) : (
            <>
              {caps.canInvite && <InvitePanel />}
              <CreateMemberCard onCreated={reload} myName={user?.name ?? ""} />
              <MembersTable
                page={page}
                loadError={loadError}
                myId={user?.id ?? ""}
                myRole={myRole}
                onChanged={reload}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

/* --------------------------- création de membre ---------------------------- */

function CreateMemberCard({ onCreated, myName }: { onCreated: () => void; myName: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(() => generatePassword(14));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Member | null>(null);
  const [copied, setCopied] = useState(false);
  void myName;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const m = await createMember({ name: name.trim(), email: email.trim(), password });
      setCreated(m);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyCredentials() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(onceCredentialsText(created.name, created.email, password));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard refusé : le texte reste visible */ }
  }

  return (
    <Card>
      <CardHeader
        title="Mitgliedskonto erstellen"
        subtitle="Crée un VRAI compte (rôle « Mitglied » — les rôles élevés sont réservés à l'Eigentümer). Le compte peut se connecter immédiatement."
        action={<Button size="sm" variant={open ? "secondary" : "primary"} onClick={() => setOpen((o) => !o)}>{open ? "Schließen" : "Neues Konto"}</Button>}
      />
      {open && (
        <div className="space-y-3 border-t border-slate-100 px-5 py-4">
          {created ? (
            <div className="space-y-2">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-xs font-bold text-emerald-800">Konto erstellt — Zugangsdaten EINMAL anzeigen et transmettre :</p>
                <p className="mt-1 select-all font-mono text-xs text-emerald-900">
                  {onceCredentialsText(created.name, created.email, password)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={copyCredentials}>{copied ? "Kopiert ✓" : "Kopieren"}</Button>
                <Button size="sm" variant="secondary" onClick={() => { setCreated(null); setName(""); setEmail(""); setPassword(generatePassword(14)); }}>
                  Weiteres Konto
                </Button>
              </div>
              <p className="text-[11px] text-slate-400">Le mot de passe n'est PAS stocké en clair — il ne sera plus jamais affiché.</p>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm text-slate-600">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Ben Keller"
                    className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30" />
                </label>
                <label className="block text-sm text-slate-600">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">E-Mail (Login)</span>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ben.keller@büro.de" type="email"
                    className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30" />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700 ring-1 ring-slate-200">{password}</span>
                <Button size="sm" variant="secondary" onClick={() => setPassword(generatePassword(14))}>Neu würfeln</Button>
                <Button size="sm" disabled={busy || !name.trim() || !email.trim()} onClick={submit}>
                  {busy ? "Erstelle…" : "Konto erstellen"}
                </Button>
              </div>
              {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/* ----------------------------- table des membres ---------------------------- */

function MembersTable({ page, loadError, myId, myRole, onChanged }: {
  page: { count: number; your_role: string; members: Member[] } | null;
  loadError: string | null;
  myId: string;
  myRole: string;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [armDeleteId, setArmDeleteId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const caps = roleCapabilities(myRole);

  async function run(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    setRowError(null);
    try {
      await action();
      setArmDeleteId(null);
      onChanged();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Mitglieder des Büros"
        subtitle={page ? `${page.count} Konten — rôles et statuts RÉELS (servidor PostgreSQL, jede Aktion auditiert)` : "Lade…"}
      />
      {loadError && <p className="px-5 pb-3 text-xs font-semibold text-rose-600">Mitglieder nicht erreichbar: {loadError}</p>}
      {rowError && <p className="px-5 pb-3 text-xs font-semibold text-rose-600">{rowError}</p>}
      <ul className="divide-y divide-slate-100 border-t border-slate-100">
        {(page?.members ?? []).map((m) => {
          const rl = roleLabel(m.role);
          const editable = canEditTarget(myRole, m.role) && m.id !== myId;
          const isMe = m.id === myId;
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <UserAvatar name={m.name} ownerKey={avatarKeyOf(m)} size={34} variant="brand" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-slate-800">{m.name}{isMe ? " (Sie)" : ""}</p>
                  <Badge tone={rl.tone} dot>{rl.label}</Badge>
                  <Badge tone={m.is_active ? "emerald" : "rose"}>{statusLabel(m.is_active)}</Badge>
                </div>
                <p className="text-xs text-slate-400">
                  {m.email}{m.last_login ? ` · zuletzt online ${relativeTime(m.last_login)}` : " · noch nie angemeldet"}
                </p>
              </div>
              {editable && (
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm" variant="secondary" disabled={busyId === m.id}
                    onClick={() => run(m.id, () => setMemberActive(m.id, !m.is_active))}
                  >
                    {busyId === m.id ? "…" : m.is_active ? "Deaktivieren" : "Aktivieren"}
                  </Button>
                  {caps.canChangeRoles && (m.role === "architect" || m.role === "admin") && (
                    <Button
                      size="sm" variant="secondary" disabled={busyId === m.id}
                      onClick={() => run(m.id, () => setMemberRole(m.id, m.role === "architect" ? "admin" : "architect"))}
                    >
                      {m.role === "architect" ? "Zur Geschäftsführung" : "Zum Mitglied"}
                    </Button>
                  )}
                  <Button
                    size="sm" variant={armDeleteId === m.id ? "primary" : "secondary"} disabled={busyId === m.id}
                    onClick={() => {
                      if (armDeleteId !== m.id) { setArmDeleteId(m.id); return; }
                      void run(m.id, () => deleteMember(m.id));
                    }}
                  >
                    {armDeleteId === m.id ? "Wirklich löschen?" : "Löschen"}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-400">
        Garde-fous gravés : das eigene Konto ändert man im Profil; Eigentümer werden nie gelöscht; die Geschäftsführung verwaltet nur Mitglieder; jede Aktion ist auditiert.
      </p>
    </Card>
  );
}
