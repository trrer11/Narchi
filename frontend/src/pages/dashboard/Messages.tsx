import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/store/AuthStore";
import { useApp } from "@/store/AppStore";
import { Button, Card, Icon } from "@/components/ui";
import UserAvatar from "@/components/UserAvatar";
import { avatarKeyDirectory, ownerKeyForName, type KeyDirectoryUser } from "@/lib/avatars";
import { formatChatTime } from "@/lib/chatTime";
import {
  connectChannelSocket,
  deleteChannel,
  ensureChannels,
  ensureDirectChannel,
  getChannels,
  getMessages,
  getTeamUsers,
  markRead,
  renameChannel,
  sendMessage,
  shouldMarkReadNow,
  subscribeChat,
  unreadCount,
  type ChatChannel,
  type ChatMessage,
  type TeamUser,
  mergeMessages,
} from "@/lib/chatService";
import { cn } from "@/utils/cn";

const FALLBACK_CHANNEL_ID = "ch-allgemein";

function fallbackChannel(userId: string): ChatChannel {
  return {
    id: FALLBACK_CHANNEL_ID,
    kind: "team",
    name: "# Général (Cabinet)",
    memberIds: [userId],
    createdAt: new Date().toISOString(),
  };
}

function cleanChannels(input: unknown, userId: string): ChatChannel[] {
  const rows = Array.isArray(input) ? input : [];
  const clean: ChatChannel[] = rows
    .filter((c): c is ChatChannel => !!c && typeof c.id === "string" && typeof c.name === "string")
    .map((c) => {
      const kind: ChatChannel["kind"] = c.kind === "project" || c.kind === "direct" ? c.kind : "team";
      return {
        ...c,
        kind,
        memberIds: Array.isArray(c.memberIds) ? c.memberIds.filter(Boolean) : [userId],
        createdAt: c.createdAt || new Date().toISOString(),
      };
    });
  return clean.length > 0 ? clean : [fallbackChannel(userId)];
}

function cleanMessages(input: unknown): ChatMessage[] {
  const rows = Array.isArray(input) ? input : [];
  return rows
    .filter((m): m is ChatMessage => !!m && typeof m.id === "string" && typeof m.text === "string")
    .map((m) => ({
      ...m,
      authorId: m.authorId || "system",
      authorName: m.authorName || "NARCHI",
      createdAt: m.createdAt || new Date().toISOString(),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export default function Messages() {
  const { user, users, isOwner } = useAuth();
  const { projects } = useApp();
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unreads, setUnreads] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "degraded">("loading");
  const [error, setError] = useState<string | null>(null);
  // §83 — comptes réels du tenant : résolution « nom → clé avatar » par
  // e-mail (= clé serveur d'hydratation), sinon « n:nom » sans jamais matcher.
  const [remoteUsers, setRemoteUsers] = useState<TeamUser[] | null>(null);

  // §108 — gestion des conversations (demande client « clic droit :
  // supprimer / renommer, uniquement owner et admin »). Le SERVEUR fait
  // foi (403 sinon) ; l'UI n'ouvre le menu que pour eux.
  const canManageChannels = isOwner || user?.role === "admin";
  const [menuFor, setMenuFor] = useState<{ channel: ChatChannel; x: number; y: number } | null>(null);
  const [renameFor, setRenameFor] = useState<ChatChannel | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteFor, setDeleteFor] = useState<ChatChannel | null>(null);
  const [manageBusy, setManageBusy] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);

  const safeUsers = useMemo(() => (Array.isArray(users) ? users.filter((u) => u?.id) : []), [users]);
  const keyDir = useMemo(() => avatarKeyDirectory(remoteUsers, safeUsers), [remoteUsers, safeUsers]);
  // §84 — verrou markRead (même cause que le dock flottant : acquitter à
  // chaque cycle ré-armait subscribeChat via « narchi-chat-read » → boucle
  // ~2×/s). On n'acquitte que si un message PLUS RÉCENT est présent.
  const lastMarkedRef = useRef("");

  useEffect(() => {
    lastMarkedRef.current = ""; // changement de canal : dernier acquitt local
  }, [activeId]);
  const safeProjects = useMemo(() => projects.map((p) => ({ id: p.id, name: p.name })), [projects]);
  const active = useMemo(() => channels.find((c) => c.id === activeId), [channels, activeId]);
  const teammates = useMemo(() => safeUsers.filter((u) => user && u.id !== user.id), [safeUsers, user]);

  const refreshChannels = useCallback(async () => {
    if (!user) return;
    try {
      await ensureChannels(safeUsers, safeProjects);
      // §83 — hydrate le registre d'avatars (icônes des collègues) en même
      // temps que les canaux : l'onglet Nachrichten n'affichait que des
      // initiales tant que cette source n'était pas lue ici.
      setRemoteUsers(await getTeamUsers());
      const list = cleanChannels(await getChannels(user.id), user.id);
      setChannels(list);
      setActiveId((prev) => (prev && list.some((c) => c.id === prev) ? prev : list[0].id));
      setStatus("ready");
      setError(null);
    } catch (err) {
      const fallback = fallbackChannel(user.id);
      setChannels([fallback]);
      setActiveId((prev) => prev || fallback.id);
      setStatus("degraded");
      setError(err instanceof Error ? err.message : "Kanäle nicht erreichbar.");
    }
  }, [safeProjects, safeUsers, user]);

  const refreshMessages = useCallback(async () => {
    if (!user || !activeId) return;
    try {
      const list = cleanMessages(await getMessages(activeId));
      // Fusion G-Set : l'instantane REST s'unit aux messages deja affiches
      // (optimistes/trames recentes) — ordre stable, zero doublon, zero
      // inversion chronologique apres un rejeu d'outbox.
      setMessages((prev) => mergeMessages(prev, list));
      const mark = shouldMarkReadNow(lastMarkedRef.current, list); // §84 — silence si rien de plus récent
      if (mark) {
        lastMarkedRef.current = mark;
        markRead(user.id, activeId);
      }
      const nextUnread: Record<string, number> = {};
      for (const channel of channels) {
        try {
          nextUnread[channel.id] = await unreadCount(user.id, channel.id);
        } catch {
          nextUnread[channel.id] = 0;
        }
      }
      setUnreads(nextUnread);
      setError(null);
    } catch (err) {
      setMessages([]);
      setStatus("degraded");
      setError(err instanceof Error ? err.message : "Nachrichten für diesen Kanal nicht erreichbar.");
    }
  }, [activeId, channels, user]);

  useEffect(() => {
    void refreshChannels();
  }, [refreshChannels]);

  // §108 — clic hors menu ou Échap = fermé (jamais de menu fantôme).
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);

  const submitRename = async () => {
    if (!renameFor) return;
    const name = renameDraft.trim();
    if (!name) return;
    setManageBusy(true);
    setManageError(null);
    try {
      await renameChannel(renameFor.id, name);
      setRenameFor(null);
      await refreshChannels();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : "Umbenennen fehlgeschlagen.");
    } finally {
      setManageBusy(false);
    }
  };

  const submitDelete = async () => {
    if (!deleteFor) return;
    setManageBusy(true);
    setManageError(null);
    try {
      await deleteChannel(deleteFor.id);
      setDeleteFor(null);
      await refreshChannels(); // liste + canal actif retombent justes
    } catch (err) {
      setManageError(err instanceof Error ? err.message : "Löschen fehlgeschlagen.");
    } finally {
      setManageBusy(false);
    }
  };

  useEffect(() => {
    void refreshMessages();
  }, [refreshMessages]);

  useEffect(() => {
    if (!activeId) return;
    const unsubPoll = subscribeChat(() => void refreshMessages());
    const unsubWs = connectChannelSocket(activeId, (payload) => {
      // AXE 3 — FIN DU REFETCH N+1 : la trame WS contient deja le message
      // complet. Fusion G-Set locale (union par clientId + tri stable par
      // (clientCreatedAt, clientId)) au lieu d'un GET de 500 messages par
      // trame. refreshMessages() ne sert plus qu'a la resynchronisation
      // initiale et aux reprises de connexion (subscribeChat).
      if (typeof payload === "object" && payload && (payload as { type?: string }).type === "message") {
        const raw = (payload as { message?: unknown }).message;
        if (raw && typeof raw === "object") {
          const incoming = cleanMessages([raw as ChatMessage]);
          if (incoming.length > 0 && incoming[0].channelId === activeId) {
            setMessages((prev) => mergeMessages(prev, incoming));
            const mark = user ? shouldMarkReadNow(lastMarkedRef.current, incoming) : null;
            if (mark && user) {
              lastMarkedRef.current = mark;
              markRead(user.id, activeId);
            }
            return;
          }
        }
        // Trame sans payload exploitable (client V3) : repli sur le refetch.
        void refreshMessages();
      }
    });
    return () => {
      unsubPoll();
      unsubWs();
    };
  }, [activeId, refreshMessages]);

  const openDirect = async (otherId: string) => {
    if (!user) return;
    const other = safeUsers.find((u) => u.id === otherId);
    if (!other) return;
    try {
      const dm = await ensureDirectChannel(user, other);
      await refreshChannels();
      setActiveId(dm.id);
    } catch (err) {
      setStatus("degraded");
      setError(err instanceof Error ? err.message : "Direktnachricht nicht möglich.");
    }
  };

  const onSend = async (text: string) => {
    if (!user || !active) return;
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      channelId: active.id,
      authorId: user.id,
      authorName: user.name,
      text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      await sendMessage(active.id, user, text);
      await refreshMessages();
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setStatus("degraded");
      setError(err instanceof Error ? err.message : "Envoi impossible.");
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-4">
      {status === "degraded" && error && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Teilweise Sync der Nachrichten</p>
            <p className="mt-0.5 text-xs">{error}</p>
            <button className="mt-2 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold ring-1 ring-amber-200 hover:bg-amber-100" onClick={() => void refreshChannels()}>
              Réessayer
            </button>
          </div>
        </div>
      )}

      <Card className="grid h-[calc(100vh-13rem)] min-h-[520px] grid-cols-1 overflow-hidden lg:grid-cols-[280px_1fr_240px]">
        <div className="flex flex-col border-r border-slate-100 dark:border-slate-800">
          <div className="border-b border-slate-100 dark:border-slate-800 p-3">
            <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Kanäle</p>
          </div>
          <div className="scroll-thin flex-1 space-y-0.5 overflow-y-auto p-2">
            {channels.map((channel) => {
              const unread = unreads[channel.id] ?? 0;
              const isActive = channel.id === activeId;
              return (
                <button
                  key={channel.id}
                  onClick={() => setActiveId(channel.id)}
                  onContextMenu={(e) => {
                    // §108 — menu réservé owner/admin ; les autres gardent
                    // le menu natif du navigateur (aucune promesse d'action).
                    if (!canManageChannels) return;
                    e.preventDefault();
                    setMenuFor({ channel, x: e.clientX, y: e.clientY });
                  }}
                  className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors", isActive ? "bg-brand-50 dark:bg-brand-500/20" : "hover:bg-slate-50 dark:hover:bg-white/5")}
                >
                  <Icon name={channel.kind === "direct" ? "users" : channel.kind === "project" ? "building" : "pulse"} size={16} className={isActive ? "text-brand-600 dark:text-brand-400" : "text-slate-400"} />
                  <span className={cn("flex-1 truncate text-sm", isActive ? "font-semibold text-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-300")}>
                    {channel.kind === "direct" ? "· " + channel.name : channel.name}
                  </span>
                  {unread > 0 && <span className="rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold text-ink-950">{unread}</span>}
                </button>
              );
            })}
          </div>
          <div className="border-t border-slate-100 dark:border-slate-800 p-2">
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Direktnachrichten</p>
            {teammates.map((member) => {
              const name = String(member.name || member.email || "Teammate");
              return (
                <button key={member.id} onClick={() => void openDirect(member.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-white/5">
                  <UserAvatar name={name} ownerKey={ownerKeyForName(keyDir, name)} size={28} />
                  <span className="truncate text-sm text-slate-600 dark:text-slate-300">{name}</span>
                </button>
              );
            })}
          </div>
        </div>

        <ChatPane channel={active} user={user} users={keyDir} messages={messages} onSend={onSend} />

        <div className="hidden flex-col border-l border-slate-100 dark:border-slate-800 lg:flex">
          <div className="border-b border-slate-100 dark:border-slate-800 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Mitglieder · {(active?.memberIds ?? []).length}</p>
          </div>
          <div className="scroll-thin flex-1 space-y-1 overflow-y-auto p-2">
            {(active?.memberIds ?? []).map((id) => {
              const member = safeUsers.find((u) => u.id === id);
              const name = member?.name || member?.email || id;
              return (
                <div key={id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                  <UserAvatar name={name} ownerKey={ownerKeyForName(keyDir, name)} size={24} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200">{name}</p>
                    <p className="text-[10px] text-slate-400 capitalize">{member?.role || "member"}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* §108 — menu contextuel conversation (owner/admin uniquement) */}
      {menuFor && (
        <div
          className="fixed inset-0 z-40"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setMenuFor(null); }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            role="menu"
            aria-label={`Kanal: ${menuFor.channel.name}`}
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute w-60 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-xl"
            style={{
              left: Math.max(8, Math.min(menuFor.x, window.innerWidth - 260)),
              top: Math.max(8, Math.min(menuFor.y, window.innerHeight - 180)),
            }}
          >
            <div className="truncate px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              {menuFor.channel.name}
            </div>
            <button
              type="button"
              role="menuitem"
              disabled={menuFor.channel.kind === "direct"}
              title={menuFor.channel.kind === "direct"
                ? "Direktnachrichten tragen den Namen des Kontakts"
                : undefined}
              onClick={() => {
                setRenameFor(menuFor.channel);
                setRenameDraft(menuFor.channel.name);
                setManageError(null);
                setMenuFor(null);
              }}
              className="flex w-full items-center px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Umbenennen…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setDeleteFor(menuFor.channel);
                setManageError(null);
                setMenuFor(null);
              }}
              className="flex w-full items-center px-3 py-2 text-left text-sm text-rose-600 transition-colors hover:bg-rose-50"
            >
              Löschen…
            </button>
          </div>
        </div>
      )}

      {/* §108 — modale renommage */}
      {renameFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4"
          onClick={() => { if (!manageBusy) setRenameFor(null); }}
        >
          <div
            role="dialog"
            aria-label="Kanal umbenennen"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-base font-semibold text-zinc-900">Kanal umbenennen</h3>
            <p className="mt-0.5 truncate text-xs text-zinc-400">{renameFor.name}</p>
            <input
              id="ch-rename-input"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              maxLength={80}
              autoFocus
              className="mt-3 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-800 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-400/15"
            />
            {manageError && <p className="mt-2 text-xs text-rose-600">{manageError}</p>}
            <div className="mt-4 flex gap-2">
              <Button
                className="flex-1"
                onClick={() => void submitRename()}
                disabled={manageBusy || !renameDraft.trim()}
              >
                Speichern
              </Button>
              <Button variant="secondary" onClick={() => setRenameFor(null)} disabled={manageBusy}>
                Abbrechen
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* §108 — modale suppression : la perte des messages est DITE */}
      {deleteFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4"
          onClick={() => { if (!manageBusy) setDeleteFor(null); }}
        >
          <div
            role="dialog"
            aria-label="Kanal löschen"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-base font-semibold text-zinc-900">
              „{deleteFor.name}“ wirklich löschen?
            </h3>
            {/* §110 — la modale DIT la vérité du cas : DM = effacée chez
                les deux ; canal = effacé pour toute l'équipe et JAMAIS
                recréé par la synchro (pierre tombale serveur §110). */}
            {deleteFor.kind === "direct" ? (
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">
                Alle Nachrichten dieses Gesprächs werden <strong>endgültig gelöscht</strong> —
                auf dem Server, für beide Seiten. Ohne Wiederherstellung.
              </p>
            ) : (
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">
                Alle Nachrichten dieses Kanals werden <strong>endgültig gelöscht</strong> —
                für das ganze Team. Der Kanal wird <strong>nicht automatisch
                neu erstellt</strong>. Ohne Wiederherstellung.
              </p>
            )}
            {manageError && <p className="mt-2 text-xs text-rose-600">{manageError}</p>}
            <div className="mt-4 flex gap-2">
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => void submitDelete()}
                disabled={manageBusy}
              >
                Endgültig löschen
              </Button>
              <Button variant="secondary" onClick={() => setDeleteFor(null)} disabled={manageBusy}>
                Abbrechen
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatPane({
  channel,
  user,
  users,
  messages,
  onSend,
}: {
  channel?: ChatChannel;
  user: { id: string; name: string };
  /// §83 — annuaire « nom → clé avatar » (comptes réels d'abord) : ne sert
  /// qu'à la résolution d'icônes, jamais à l'envoi (auteur = session).
  users: KeyDirectoryUser[];
  messages: ChatMessage[];
  onSend: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const safeMessages = useMemo(() => cleanMessages(messages), [messages]);
  const grouped = useMemo(() => {
    const map = new Map<string, ChatMessage[]>();
    for (const message of safeMessages) {
      const date = new Date(message.createdAt || Date.now());
      const key = Number.isNaN(date.getTime()) ? "Heute" : date.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long" });
      const arr = map.get(key) ?? [];
      arr.push(message);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [safeMessages]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [safeMessages.length, channel?.id]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const draft = text.trim();
    if (!draft || !channel || sending) return;
    setText("");
    setSending(true);
    try {
      await onSend(draft);
    } finally {
      setSending(false);
    }
  };

  if (!channel) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
        <Icon name="users" size={28} className="text-slate-300" />
        <p className="text-sm">Wähle links einen Kanal aus.</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 px-5 py-3">
        <Icon name={channel.kind === "direct" ? "users" : channel.kind === "project" ? "building" : "pulse"} size={18} className="text-brand-500" />
        <div>
          <h3 className="font-display font-semibold text-slate-900 dark:text-white">{channel.kind === "direct" ? "· " + channel.name : channel.name}</h3>
          <p className="text-[11px] text-slate-400">{channel.memberIds.length} Mitglieder · {safeMessages.length} Nachrichten</p>
        </div>
      </div>

      <div ref={scrollRef} className="scroll-thin flex-1 space-y-4 overflow-y-auto bg-slate-50/40 dark:bg-ink-900/40 p-5">
        {safeMessages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-slate-400">
            <Icon name="spark" size={26} className="text-slate-300 dark:text-slate-600" />
            <p className="text-sm">Noch keine Nachrichten — schreib die erste!</p>
          </div>
        ) : (
          grouped.map(([day, rows]) => (
            <div key={day}>
              <div className="mb-3 flex items-center justify-center"><span className="rounded-full bg-white dark:bg-ink-800 px-3 py-0.5 text-[10px] font-semibold text-slate-400 ring-1 ring-slate-200 dark:ring-slate-700">{day}</span></div>
              <div className="space-y-2.5">
                {rows.map((message) => {
                  const mine = message.authorId === user.id;
                  const author = message.authorName || "NARCHI";
                  // Traçabilité : l'heure de SAISIE (clientCreatedAt) prime.
                  const time = formatChatTime(message.clientCreatedAt ?? message.createdAt) || "--:--";
                  return (
                    <div key={message.id} className={cn("flex items-end gap-2", mine && "flex-row-reverse")}>
                      <UserAvatar name={author} ownerKey={ownerKeyForName(users, author)} size={28} className="mb-0.5" />
                      <div className="max-w-[72%]">
                        <div className={cn("mb-0.5 flex items-center gap-2", mine && "flex-row-reverse")}>
                          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{mine ? "Du" : author}</span>
                          <span className="text-[10px] text-slate-400">{time}</span>
                        </div>
                        <div className={cn("rounded-2xl px-3.5 py-2 text-sm", mine ? "rounded-br-sm bg-brand-500 text-ink-950 font-medium" : "rounded-bl-sm bg-white dark:bg-ink-800 text-slate-700 dark:text-slate-200 ring-1 ring-slate-200 dark:ring-slate-700")}>
                          {message.text}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 border-t border-slate-100 dark:border-slate-800 p-3">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={`Nachricht an ${channel.name}…`}
          disabled={sending}
          className="h-11 flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-ink-900 px-4 text-sm text-slate-800 dark:text-white placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30 disabled:opacity-60"
        />
        <Button type="submit" icon="arrowRight" disabled={!text.trim() || sending}>{sending ? "..." : "Senden"}</Button>
      </form>
    </div>
  );
}
