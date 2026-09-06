import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/store/AuthStore";
import { useApp } from "@/store/AppStore";
import { Icon } from "@/components/ui";
import {
  ensureChannels,
  ensureDirectChannel,
  getChannels,
  getMessages,
  getTeamUsers,
  mergeMessages,
  sendMessage,
  markRead,
  shouldMarkReadNow,
  subscribeChat,
  unreadCount,
  type ChatChannel,
  type ChatMessage,
  type TeamUser,
} from "@/lib/chatService";
import { partitionContacts, type TeamContact } from "@/lib/contacts";
import { avatarKeyDirectory, avatarKeyOf, ownerKeyForName, type KeyDirectoryUser } from "@/lib/avatars";
import { formatChatTime } from "@/lib/chatTime";
import UserAvatar from "@/components/UserAvatar";
import AvatarPicker from "@/components/AvatarPicker";
import { cn } from "@/utils/cn";

// §61 — CALIBRAGE DU DOCK : hauteur UNIQUE et ligne de base UNIQUE pour
// toutes les surfaces (panneau contacts, fenêtres de conversation,
// éditeur d'avatar). Avant : « bottom-full mb-3 » → bande vide sous le
// panneau (rectangle rouge de la capture client).
// §62 — RECALIBRAGE (2e retour client) :
//  • les surfaces OUVERTES touchent le BORD INFÉRIEUR de l'écran (0 px) —
//    le dock passe à bottom-0, seule la bulle fermée garde ses 24 px
//    d'air (pb-6 sur sa colonne) ; fini le liseré vide sous la fenêtre ;
//  • hauteur réduite 560 → 448 px (28rem) : 560 px occupait ~2/3 de
//    l'écran (« très très long »), 448 px ≈ fenêtre Messenger/Intercom ;
//  • coins inférieurs carrés (rounded-t-2xl) : surfaces POSÉES sur le
//    bord, comme une fenêtre ancrée.
// §63 — panneau contacts + éditeur d'avatar = ÉLÉMENTS FLEX du dock
// (emplacement réel entre fenêtres et bulle) : AUCUNE fenêtre recouverte.
const DOCK_SURFACE_HEIGHT = "h-[min(28rem,calc(100dvh-6rem))]";

// Event bus to open chats from anywhere in the SPA.
type ChatEvent = { type: "OPEN_CHAT"; channelId: string };
const chatListeners = new Set<(e: ChatEvent) => void>();
export const openFloatingChat = (channelId: string) => {
  chatListeners.forEach((listener) => listener({ type: "OPEN_CHAT", channelId }));
};

function playSoftNotification() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const gain = ctx.createGain();
    const osc = ctx.createOscillator();
    gain.gain.value = 0.035;
    osc.frequency.value = 740;
    osc.type = "sine";
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    osc.stop(ctx.currentTime + 0.18);
    window.setTimeout(() => void ctx.close(), 250);
  } catch {
    // Browsers may block audio before user interaction. Visual badge remains active.
  }
}

export function FloatingChatManager() {
  const { user, users } = useAuth();
  const { projects } = useApp();
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  // §109 — démarrage PROPRE (demande client : « à l'ouverture je ne veux
  // qu'UNE bulle ») : les fenêtres de la session passée ne rouvrent plus
  // toutes seules ; on oublie l'ancienne clé de restauration. Pendant la
  // session, les fenêtres ouvertes restent telles quelles.
  const [openChats, setOpenChats] = useState<string[]>([]);
  useEffect(() => {
    try { localStorage.removeItem("narchi:floatingChat:open"); } catch { /* noop */ }
  }, []);
  const [unreads, setUnreads] = useState<Record<string, number>>({});
  const [minimized, setMinimized] = useState<Record<string, boolean>>({});
  // Rail « Teamkontakt » (style Messenger) : liste des collègues, un clic
  // ouvre la fenêtre de chat directe dans le dock.
  const [contactsOpen, setContactsOpen] = useState(false);
  const [contactFilter, setContactFilter] = useState("");
  const [contactError, setContactError] = useState<string | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  // Comptes réels du tenant (seules cibles valides d'une Direktnachricht).
  const [remoteUsers, setRemoteUsers] = useState<TeamUser[] | null>(null);
  const lastUnreadRef = useRef(0);
  // Anti-tempête : les événements chat (envoi, réception WS, lecture) sont
  // coalescés — sinon chaque message déclenchait N requêtes (lenteur fTelée).
  const refreshTimer = useRef<number | null>(null);
  // §84 — verrous contre la tempête « va-et-vient » vécue par le client :
  //  1) dépendances STABLES via refs (un tableau recréé à chaque rendu ne
  //     relance plus jamais la chaîne — un mock de test l'a fait boucler
  //     à pleine vitesse ; en production, latence réseau ≈ 2 cycles/s) ;
  //  2) anti-chevauchement : un refresh en cours en bloque un second.
  const usersRef = useRef(users);
  usersRef.current = users;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const refreshBusy = useRef(false);

  const userId = user?.id ?? null;

  const refresh = useCallback(async () => {
    if (!userId || refreshBusy.current) return;
    refreshBusy.current = true;
    try {
      const safeUsers = Array.isArray(usersRef.current) ? usersRef.current.filter((u) => u?.id) : [];
      const safeProjects = projectsRef.current.map((p) => ({ id: p.id, name: p.name }));
      await ensureChannels(safeUsers, safeProjects);
      const list = await getChannels(userId);
      const channels = Array.isArray(list) ? list : [];
      setChannels(channels);
      const nextUnreads: Record<string, number> = {};
      for (const channel of channels) {
        nextUnreads[channel.id] = await unreadCount(userId, channel.id);
      }
      const total = Object.values(nextUnreads).reduce((a, b) => a + b, 0);
      if (total > lastUnreadRef.current && document.visibilityState !== "visible") playSoftNotification();
      lastUnreadRef.current = total;
      setUnreads(nextUnreads);
    } catch (error) {
      console.warn("[Chat] Rafraîchissement du dock échoué :", error);
    } finally {
      refreshBusy.current = false;
    }
  }, [userId]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void refresh();
    }, 300);
  }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    let mounted = true;
    const safeRefresh = async () => { if (mounted) await refresh(); };
    void safeRefresh();
    const unsub = subscribeChat(() => scheduleRefresh());
    return () => {
      mounted = false;
      unsub();
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    };
  }, [refresh, scheduleRefresh, userId]);

  // §84 — comptes du tenant (+ hydratation avatars §82) sur un rail DÉDIÉ,
  // stable (clé primitive userId) : immédiat au montage puis toutes les
  // 30 s. Propagation avatar honnête : ≤ 30 s ou au prochain évènement
  // chat — pas temps réel (la Notiz CRDT est la seule surface temps réel).
  // Avant, ce fetch était enchaîné DANS refresh() : une tempête de refresh
  // (boucle markRead) pouvait l'empêcher d'aboutir → avatars figés « à
  // l'ancienne version » constatés par le client.
  useEffect(() => {
    if (!userId) return;
    let stopped = false;
    const tick = async () => {
      const rows = await getTeamUsers();
      if (!stopped) setRemoteUsers(rows);
    };
    void tick();
    const poll = window.setInterval(() => {
      if (!stopped) void tick();
    }, 30_000);
    return () => {
      stopped = true;
      window.clearInterval(poll);
    };
  }, [userId]);

  useEffect(() => {
    const handler = (event: ChatEvent) => {
      if (event.type !== "OPEN_CHAT") return;
      setOpenChats((prev) => (prev.includes(event.channelId) ? prev : [...prev.slice(-2), event.channelId]));
      setMinimized((prev) => ({ ...prev, [event.channelId]: false }));
    };
    chatListeners.add(handler);
    return () => { chatListeners.delete(handler); };
  }, []);

  if (!user) return null;

  const totalUnread = Object.values(unreads).reduce((a, b) => a + b, 0);
  // §109 — La rangée de bulles ambre « un canal non lu = une bulle » est
  // SUPPRIMÉE (demande client : une seule bulle noire avec le total). Le
  // détail par canal n'est PAS perdu : il vit dans le panneau, section
  // « Unterhaltungen » (canaux ET conversations directes, pastille non
  // lue par ligne).
  // Deux mondes : collègues AVEC compte réel (chat direct possible) et
  // identités de démo locales (pas de compte → jamais de faux canal).
  const contactPartition = partitionContacts(
    remoteUsers,
    Array.isArray(users) ? users : [],
    user.id,
    user.email ?? "",
    contactFilter,
  );

  // §83 — annuaire de résolution « nom → clé avatar » : les comptes RÉELS
  // (avec e-mail = clé serveur §82) d'abord, l'annuaire local ensuite.
  // Avant, seul le local était consulté → « n:nom » ≠ clé e-mail hydratée
  // → icônes des collègues invisibles dans les fenêtres de discussion.
  const keyDir = useMemo<KeyDirectoryUser[]>(
    () => avatarKeyDirectory(remoteUsers, Array.isArray(users) ? users : []),
    [remoteUsers, users],
  );

  const openDirect = async (contact: TeamContact) => {
    const other = remoteUsers?.find((u) => u.id === contact.userId);
    if (!other) {
      setContactError("Konto nicht gefunden — bitte Seite neu laden.");
      return;
    }
    try {
      setContactError(null);
      const channel = await ensureDirectChannel(user as never, other as never);
      await refresh();
      setContactsOpen(false);
      setContactFilter("");
      openFloatingChat(channel.id);
    } catch (error) {
      setContactError(error instanceof Error ? error.message : "Direktnachricht nicht möglich.");
    }
  };

  // §48 — dock décalé BIEN à gauche du FAB « NARCHI IQ » (bottom-6 right-6).
  // §58 — pile d'actions verticale FLUSH RIGHT.
  // §60 — la pilule « NARCHI IQ » a été supprimée (choix utilisateur) : la
  // bulle messagerie est désormais le SEUL bouton flottant — elle DESCEND
  // au coin inférieur droit (bottom-6 right-6), « bien placée et pas en
  // haut » ; bulles non lues empilées au-dessus, fenêtres à sa gauche.
  // §61 — toutes les surfaces du dock (panneau, fenêtres, avatar) sont
  // ANCRÉES à la ligne de base du coin avec UNE hauteur commune.
  // §62 — les surfaces ouvertes touchent le bord inférieur (dock bottom-0)
  // ; la bulle fermée garde 24 px d'air (pb-6) ; hauteur 448 px.
  return (
    <div className="fixed bottom-0 right-6 z-[100] flex items-end gap-3 pointer-events-none">
      {openChats.map((id, index) => {
        const channel = channels.find((c) => c.id === id);
        if (!channel) return null;
        return (
          <FloatingChatWindow
            key={id}
            channel={channel}
            user={user}
            keyDir={keyDir}
            zOffset={index}
            unread={unreads[id] ?? 0}
            isMinimized={!!minimized[id]}
            onToggle={() => setMinimized((prev) => ({ ...prev, [id]: !prev[id] }))}
            onClose={() => setOpenChats((prev) => prev.filter((chatId) => chatId !== id))}
          />
        );
      })}

      {avatarOpen && user && (
        // §63 — ÉLÉMENT FLEX du dock (à gauche de la bulle) : jamais
        // posé sur une fenêtre ouverte, tout coulisse proprement.
        <div className="pointer-events-auto w-80 max-w-[calc(100vw-3rem)] [&>div]:rounded-b-none">
          <AvatarPicker
            user={{ id: user.id, name: user.name, email: user.email }}
            onClose={() => setAvatarOpen(false)}
          />
        </div>
      )}

      {contactsOpen && (
        <div
          className={cn(
            // §63 — ÉLÉMENT FLEX du dock entre fenêtres et bulle : AUCUNE
            // fenêtre n'est plus recouverte (la rangée coulisse à
            // gauche). Même base, même hauteur, coins bas carrés.
            "pointer-events-auto flex w-80 max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-ink-900",
            DOCK_SURFACE_HEIGHT,
          )}
        >
          <div className="flex shrink-0 cursor-pointer items-center justify-between bg-brand-400 px-3 py-2 text-ink-950" onClick={() => setContactsOpen(false)}>
            {/* Propre avatar en tête de rail : un clic l'édite (photo/emoji) */}
            <button
              onClick={() => { setAvatarOpen(true); setContactsOpen(false); }}
              className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-0.5 transition hover:bg-ink-950/10"
              title="Avatar bearbeiten"
            >
              {/* §59 — pastille noire/or ici aussi ; §83 — le registre
                  réactif rerend cet avatar à chaque changement, sans tick. */}
              <UserAvatar name={user.name || user.email || "Ich"} ownerKey={avatarKeyOf(user)} size={30} variant="brand" />
              <span className="min-w-0 text-left">
                <span className="block truncate text-sm font-bold text-ink-950">Teamkontakt</span>
                <span className="block truncate text-[10px] text-ink-950/60">Mein Avatar bearbeiten ✏️</span>
              </span>
            </button>
            <button
              onClick={() => setContactsOpen(false)}
              aria-label="Schließen"
              className="rounded p-0.5 text-ink-950/70 transition hover:text-ink-950"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
          <div className="shrink-0 p-2">
            <input
              value={contactFilter}
              onChange={(event) => setContactFilter(event.target.value)}
              placeholder="Kollege suchen…"
              aria-label="Kollege suchen"
              className="w-full rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs focus:border-brand-400 focus:outline-none dark:border-slate-700 dark:bg-ink-950 dark:text-white"
            />
          </div>
          {/* §61 — la liste occupe TOUT l'espace restant (flex-1) avec
              scroll interne : le panneau garde sa hauteur calibrée, le
              contenu ne le déforme jamais. */}
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-2">
            {channels.length > 0 && (
              <>
                {/* §109 — TOUTES les conversations (canaux + directs), avec
                    leur pastille non lue : c'est ici que vit le détail qui
                    encombrait avant l'écran sous forme de bulles ambre. */}
                <p className="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Unterhaltungen</p>
                {channels.map((channel) => (
                  <button
                    key={channel.id}
                    onClick={() => { setContactsOpen(false); setContactFilter(""); openFloatingChat(channel.id); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-ink-800"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-ink-800">
                      <Icon name={channel.kind === "direct" ? "users" : "pulse"} size={14} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800 dark:text-white">{channel.name}</span>
                    {(unreads[channel.id] ?? 0) > 0 && (
                      <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white">{unreads[channel.id]}</span>
                    )}
                  </button>
                ))}
              </>
            )}
            <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Direktnachrichten</p>
            {contactError && (
              <p className="mx-3 mb-1 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
                <Icon name="alert" size={12} className="mt-0.5 shrink-0" /> {contactError}
              </p>
            )}
            {remoteUsers === null ? (
              <p className="px-3 py-2 text-[11px] text-slate-400">
                Backend nicht erreichbar — Direktnachrichten offline.
              </p>
            ) : contactPartition.withAccount.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-slate-400">
                Kein Kollege mit Konto gefunden — lege unter „Konfiguration → Team“ Benutzerkonten an.
              </p>
            ) : (
              contactPartition.withAccount.map((contact) => (
                <button
                  key={contact.userId}
                  onClick={() => void openDirect(contact)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-ink-800"
                >
                  <span className="relative">
                    <UserAvatar name={contact.displayName} ownerKey={contact.ownerKey} size={36} />
                    <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-400 dark:border-ink-900" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-slate-800 dark:text-white">{contact.displayName}</span>
                    <span className="block truncate text-[10px] text-slate-400">{contact.roleLabel}</span>
                  </span>
                  <Icon name="chevronRight" size={12} className="shrink-0 text-slate-300" />
                </button>
              ))
            )}
            {contactPartition.withoutAccount.length > 0 && (
              <>
                <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Ohne Konto — nur Demo
                </p>
                {contactPartition.withoutAccount.map((contact) => (
                  <div
                    key={contact.userId}
                    title="Kein Benutzerkonto — Direktnachricht nicht möglich"
                    className="flex w-full cursor-not-allowed items-center gap-2.5 px-3 py-2 text-left opacity-50"
                  >
                    <span className="grayscale">
                      <UserAvatar name={contact.displayName} ownerKey={contact.ownerKey} size={36} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-500">{contact.displayName}</span>
                      <span className="block truncate text-[10px] text-slate-400">{contact.roleLabel} · kein Konto</span>
                    </span>
                    <Icon name="lock" size={12} className="shrink-0 text-slate-300" />
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* §109 — UNE SEULE bulle (demande client, capture à l'appui : la
          rangée de bulles ambre faisait « débutant ») : plus de bulle par
          canal non lu, plus de pilule rouge volante. Le total des non lus
          reste affiché sur la bulle noire ; le détail par conversation
          vit dans le panneau « Unterhaltungen ».
          §62 — pb-6 : le dock est à bottom-0 (surfaces ouvertes posées sur
          le bord) mais la BULLE fermée garde ses 24 px d'air habituels. */}
      <div className="flex flex-col items-end gap-3 pb-6">
        {/* Lanceur « Teamkontakt » — style Messenger : une bulle toujours
            visible, un panneau de collègues, un clic ouvre la fenêtre. */}
        <div className="relative pointer-events-auto">
          <button
            aria-label="Teamkontakt öffnen"
            title="Teamkontakt"
            onClick={() => setContactsOpen((prev) => !prev)}
            className={cn(
              "relative flex h-12 w-12 items-center justify-center rounded-full border border-white shadow-xl transition hover:scale-105",
              contactsOpen ? "bg-brand-500 text-ink-950" : "bg-ink-900 text-brand-400",
            )}
          >
          <Icon name="users" size={20} />
          {totalUnread > 0 && (
            <span className="absolute -right-1 -top-1 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white shadow">
              {totalUnread}
            </span>
          )}
        </button>

        </div>
      </div>
    </div>
  );
}

function FloatingChatWindow({
  channel, user, keyDir, isMinimized, unread, zOffset, onToggle, onClose,
}: {
  channel: ChatChannel;
  user: { id: string; name: string; email?: string };
  /// §83 — annuaire « nom → clé avatar » (comptes réels d'abord) fourni par
  /// le gestionnaire : les icônes des collègues se résolvent par e-mail.
  keyDir: KeyDirectoryUser[];
  isMinimized: boolean;
  unread: number;
  zOffset: number;
  onToggle: () => void;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesTimer = useRef<number | null>(null);
  // §84 — DERNIER horodatage acquitté : markRead n'est rappelé QUE si un
  // message plus récent existe. Avant : markRead à CHAQUE cycle → événement
  // « narchi-chat-read » → subscribeChat ré-agit immédiatement → nouveau
  // cycle → boucle infinie ~2×/s (le « va-et-vient » vu par le client).
  const lastMarkedRef = useRef("");

  const refreshMessages = useCallback(async () => {
    const list = await getMessages(channel.id);
    setMessages(list);
    if (!isMinimized) {
      const mark = shouldMarkReadNow(lastMarkedRef.current, list);
      if (mark) {
        lastMarkedRef.current = mark;
        markRead(user.id, channel.id);
      }
    }
  }, [channel.id, isMinimized, user.id]);

  useEffect(() => {
    let mounted = true;
    void refreshMessages();
    // Événements chat coalescés (250 ms) — sinon chaque envoi/réception
    // déclenchait un rechargement complet par fenêtre ouverte (lenteur).
    const unsub = subscribeChat(() => {
      if (messagesTimer.current !== null) window.clearTimeout(messagesTimer.current);
      messagesTimer.current = window.setTimeout(() => {
        messagesTimer.current = null;
        if (mounted) void refreshMessages();
      }, 250);
    });
    return () => {
      mounted = false;
      unsub();
      if (messagesTimer.current !== null) window.clearTimeout(messagesTimer.current);
    };
  }, [refreshMessages]);

  useEffect(() => {
    if (scrollRef.current && !isMinimized) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isMinimized]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const draft = text.trim();
    if (!draft || sending) return;
    // Envoi optimiste : le message s'affiche IMMÉDIATEMENT (fluidité type
    // Messenger) ; il est remplacé par la version persistée au retour
    // backend, ou retiré proprement si l'envoi échoue (texte restauré).
    const clientId = `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: ChatMessage = {
      id: clientId,
      clientId,
      channelId: channel.id,
      authorId: user.id,
      authorName: user.name || "Ich",
      text: draft,
      createdAt: new Date().toISOString(),
      clientCreatedAt: new Date().toISOString(),
    };
    setText("");
    setSendError(null);
    setMessages((prev) => mergeMessages(prev, [optimistic]));
    setSending(true);
    try {
      const saved = await sendMessage(channel.id, user as never, draft);
      setMessages((prev) => mergeMessages(prev.filter((m) => m.clientId !== clientId), [saved]));
    } catch (error) {
      console.warn("[Chat] Envoi échoué :", error);
      setMessages((prev) => prev.filter((m) => m.clientId !== clientId));
      setText(draft);
      setSendError("Nachricht konnte nicht gesendet werden — erneut versuchen.");
    } finally {
      setSending(false);
    }
  };

  const participantLabel = useMemo(() => channel.kind === "direct" ? channel.name : `${channel.name} · ${channel.memberIds.length} membres`, [channel]);

  return (
    <div
      className={cn(
        // §61 — MÊME hauteur que le panneau contacts, MÊME ligne de base
        // (items-end du dock) : famille parfaitement alignée.
        // §62 — dock bottom-0 → la fenêtre est POSÉE sur le bord inférieur
        // (coins bas carrés = fenêtre ancrée type Messenger) ; hauteur
        // réduite à 448 px. Réduite = en-tête seul (hauteur auto).
        "pointer-events-auto flex w-80 max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-ink-900 transition-all duration-200",
        isMinimized ? "" : DOCK_SURFACE_HEIGHT,
      )}
      style={{ zIndex: 100 + zOffset }}
    >
      <div className="flex cursor-pointer items-center justify-between bg-brand-400 px-3 py-2 text-ink-950" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-2 font-semibold">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
            {channel.kind === "direct" ? (
              <>
                <UserAvatar name={channel.name} ownerKey={ownerKeyForName(keyDir, channel.name)} size={28} />
                <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-brand-400 bg-emerald-400" />
              </>
            ) : (
              <>
                <Icon name="pulse" size={16} />
                <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-brand-400 bg-emerald-400" />
              </>
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm leading-4">{channel.name || "Chat"}</p>
            <p className="truncate text-[10px] leading-3 text-ink-950/70">{participantLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {unread > 0 && <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white">{unread}</span>}
          <button className="rounded p-1 hover:bg-black/10" onClick={(e) => { e.stopPropagation(); onToggle(); }} aria-label={isMinimized ? "Öffnen" : "Minimieren"}>
            <Icon name={isMinimized ? "arrowRight" : "chevronDown"} size={14} />
          </button>
          <button className="rounded p-1 hover:bg-black/10" onClick={(e) => { e.stopPropagation(); onClose(); }} aria-label="Schließen">
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* §61 — zone de messages élastique (flex-1) : la fenêtre garde
              la hauteur commune quelle que soit la conversation. */}
          <div ref={scrollRef} className="scroll-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-slate-50/70 p-3 dark:bg-ink-950/60">
            {messages.length === 0 ? (
              <div className="my-auto text-center text-xs text-slate-400">Noch keine Nachrichten — Unterhaltung beginnen.</div>
            ) : (
              messages.map((message) => {
                const mine = message.authorId === user.id;
                const authorName = String(message.authorName || "Anonym");
                return (
                  <div key={message.id} className={cn("flex gap-2", mine && "flex-row-reverse")}>
                    {!mine && (
                      <UserAvatar
                        name={authorName}
                        ownerKey={ownerKeyForName(keyDir, authorName)}
                        size={24}
                        className="mt-auto"
                      />
                    )}
                    <div className={cn("max-w-[78%] rounded-2xl px-3 py-1.5 text-xs leading-relaxed shadow-sm", mine ? "rounded-br-sm bg-brand-400 text-ink-950" : "rounded-bl-sm border border-slate-200 bg-white dark:border-slate-700 dark:bg-ink-800 dark:text-white")}>
                      {!mine && <p className="mb-0.5 text-[10px] font-bold text-slate-400">{authorName}</p>}
                      <p className="whitespace-pre-wrap break-words">{message.text}</p>
                      {/* Horodatage : traçabilité (aujourd'hui HH:MM, sinon date) */}
                      <p className={cn("mt-0.5 text-right text-[9px] leading-3", mine ? "text-white/70" : "text-slate-400")}>
                        {formatChatTime(message.clientCreatedAt ?? message.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {sendError && (
            <p className="flex items-center gap-1.5 border-t border-rose-100 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-600 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              <Icon name="alert" size={12} /> {sendError}
            </p>
          )}
          <form onSubmit={submit} className="border-t border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-ink-900">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={sending ? "Senden…" : "Nachricht schreiben…"}
              disabled={sending}
              className="w-full rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/20 disabled:opacity-60 dark:border-slate-700 dark:bg-ink-950 dark:text-white"
            />
          </form>
        </>
      )}
    </div>
  );
}
