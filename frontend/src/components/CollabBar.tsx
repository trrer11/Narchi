/**
 * §78 — barre de présence live (montée dans le shell, salle du bureau).
 * Vérités affichées : compte EXACT (toi inclus), intervalle réel 5 s dans
 * l'infobulle ; si le serveur est injoignable → RIEN n'apparaît (bonus
 * muet plutôt que fausse présence).
 */
import { useEffect, useState } from "react";
import { fetchPresence, heartbeatRoom, joinRoom, leaveRoom, presenceSummary, type PresenceMember } from "@/lib/collab";

const ROOM = "buero";
const HEARTBEAT_MS = 15_000;   // < TTL serveur 45 s (marge ×3)
const POLL_MS = 5_000;

export function CollabBar() {
  const [members, setMembers] = useState<PresenceMember[] | null>(null);

  useEffect(() => {
    let live = true;
    joinRoom(ROOM).catch(() => { if (live) setMembers(null); });
    const beat = setInterval(() => heartbeatRoom(ROOM).catch(() => {}), HEARTBEAT_MS);
    const poll = setInterval(() => {
      fetchPresence(ROOM)
        .then((r) => { if (live) setMembers(r.members); })
        .catch(() => { if (live) setMembers(null); });
    }, POLL_MS);
    fetchPresence(ROOM).then((r) => { if (live) setMembers(r.members); }).catch(() => {});
    return () => {
      live = false;
      clearInterval(beat);
      clearInterval(poll);
      leaveRoom(ROOM).catch(() => { /* fermeture d'onglet : le TTL finit le travail */ });
    };
  }, []);

  if (!members || members.length === 0) return null;   // serveur muet → pas de faux badge

  const shown = members.slice(0, 5);
  return (
    <div className="flex items-center gap-2" title={`Live-Präsenz (${presenceSummary(members.length)}) · Abfrage alle 5 s, Heartbeat 15 s`}>
      <div className="flex -space-x-1.5">
        {shown.map((m) => (
          <span
            key={m.user_id}
            title={m.name}
            className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-white dark:ring-zinc-900"
            style={{ backgroundColor: m.color }}
          >
            {m.name.trim().slice(0, 1).toUpperCase()}
          </span>
        ))}
        {members.length > shown.length && (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600 ring-2 ring-white dark:ring-zinc-900">
            +{members.length - shown.length}
          </span>
        )}
      </div>
      <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
        {members.length} online
      </span>
    </div>
  );
}
