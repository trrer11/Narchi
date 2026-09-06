/**
 * §81 — V2.7 étape 2 : « Gemeinsame Büro-Notiz » co-éditée en direct.
 *
 * Chaque mot est synchronisé via CRDT (Yjs navigateur ↔ yrs serveur) :
 * deux collègues écrivent dans le MÊME texte en même temps, sans écraser
 * l'autre. Indicateurs strictement réels — l'état affiché vient des
 * évènements du provider, jamais d'un minuteur optimiste :
 *
 *  - « Live synchronisiert » : connecté ET premier sync achevé ;
 *  - « Getrennt » : coupé — l'édition CONTINUE hors ligne (file CRDT) et
 *    fusionne au reconnect ; la bannière l'annonce explicitement ;
 *  - « offline verfügbar » : backend injoignable immédiatement → on ne
 *    prétend pas éditer ensemble : saisie bloquée avec explication.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type * as Y from "yjs";
import { useAuth } from "@/store/AuthStore";
import { Card } from "@/components/ui";
import { hueFor } from "@/lib/avatars";
import {
  applyTextDelta,
  createNotizSnapshot,
  fetchNotizSnapshots,
  LOCAL_ORIGIN,
  NOTIZ_MAX_CHARS,
  openSharedNotiz,
  peersFromStates,
  peerChipLabel,
  peerChipText,
  restoreNotizSnapshot,
  textDelta,
  type NotizSnapshot,
  type PeerState,
  type SharedNotizHandle,
} from "@/lib/collabDoc";

type ConnState = "connecting" | "live" | "reconnecting" | "offline";

const CONN_LABEL: Record<ConnState, string> = {
  connecting: "Verbinde…",
  live: "Live synchronisiert",
  reconnecting: "Getrennt — Reconnect läuft",
  offline: "Server nicht erreichbar",
};

const CONN_CLASS: Record<ConnState, string> = {
  connecting: "bg-slate-100 text-slate-600",
  live: "bg-emerald-50 text-emerald-700",
  reconnecting: "bg-amber-50 text-amber-700",
  offline: "bg-red-50 text-red-700",
};

/**
 * §89 — slot optionnel : les enfants reçoivent la CONNEXION VIVANTE (le
 * handle) plutôt que d'en rouvrir une. Exemple : les positions LV
 * co-éditées (SharedLv) vivent dans le MÊME document CRDT — une seule
 * WebSocket par onglet, une seule persistance, jamais de doublon réseau.
 */
export default function SharedNotiz({
  children,
}: {
  children?: (handle: SharedNotizHandle) => ReactNode;
}) {
  const { user } = useAuth();
  const [value, setValue] = useState("");
  const [conn, setConn] = useState<ConnState>("connecting");
  const [peers, setPeers] = useState<PeerState[]>([]);
  const [hardError, setHardError] = useState<string | null>(null);
  // §86 — Verlauf (historique serveur : manuels + auto à la fermeture).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<NotizSnapshot[] | null>(null);
  const [historyMax, setHistoryMax] = useState(0);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [restoreInfo, setRestoreInfo] = useState<string | null>(null);
  const handleRef = useRef<SharedNotizHandle | null>(null);
  const valueRef = useRef("");
  const typingTimer = useRef<number | null>(null);
  // §86 — état awareness local unique (typing + curseur), publié SANS spam.
  const awarenessRef = useRef<{ typing: boolean; cursor: number | null }>({
    typing: false,
    cursor: null,
  });
  const selfName = useMemo(() => user?.name ?? "", [user?.name]);
  // Couleur stable = teinte de l'avatar (même source, cohérence visuelle).
  const selfColor = useMemo(
    () => `hsl(${hueFor(selfName || (user?.email ?? "?"))} 70% 45%)`,
    [selfName, user?.email],
  );

  useEffect(() => {
    let alive = true;
    let handle: SharedNotizHandle | null = null;
    try {
      handle = openSharedNotiz({ name: selfName || "unbekannt", color: selfColor });
    } catch (err) {
      setHardError(err instanceof Error ? err.message : String(err));
      setConn("offline");
      return undefined;
    }
    handleRef.current = handle;

    const applyRemote = () => {
      if (!alive) return;
      const next = handle!.ytext.toString();
      if (next !== valueRef.current) {
        valueRef.current = next;
        setValue(next);
      }
    };
    const observer = (event: Y.YTextEvent) => {
      if (event.transaction.origin === LOCAL_ORIGIN) return;
      applyRemote();
    };
    handle.ytext.observe(observer);

    const onStatus = ({ status }: { status: string }) => {
      if (!alive) return;
      setConn(status === "connected" ? "live" : "reconnecting");
    };
    const onSync = (synced: boolean) => {
      if (!alive) return;
      if (synced) {
        applyRemote();
        setConn((c) => (c === "offline" ? c : "live"));
      }
    };
    const onClose = () => { if (alive) setConn("reconnecting"); };
    const onError = () => { if (alive) setConn("offline"); };
    const onPeers = () => {
      if (!alive) return;
      setPeers(peersFromStates(handle!.provider.awareness.getStates().values(), selfName));
    };
    handle.provider.on("status", onStatus);
    handle.provider.on("sync", onSync);
    handle.provider.on("connection-close", onClose);
    handle.provider.on("connection-error", onError);
    handle.provider.awareness.on("change", onPeers);

    return () => {
      alive = false;
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      handle!.ytext.unobserve(observer);
      handle!.destroy();
      handleRef.current = null;
    };
    // selfName stable (Auth) — la connexion est ouverte une fois par montage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfName, selfColor]);

  // §86 — publication awareness UNIQUE (typing + curseur, égalité court-
  // circuitée) : avant, chaque frappe écrasait le champ « user » au complet.
  const pushAwareness = (patch: { typing?: boolean; cursor?: number | null }) => {
    const handle = handleRef.current;
    if (!handle) return;
    const prev = awarenessRef.current;
    const next = {
      typing: patch.typing ?? prev.typing,
      cursor: patch.cursor !== undefined ? patch.cursor : prev.cursor,
    };
    if (next.typing === prev.typing && next.cursor === prev.cursor) return;
    awarenessRef.current = next;
    handle.provider.awareness.setLocalStateField("user", {
      name: selfName || "unbekannt",
      color: selfColor,
      typing: next.typing,
      cursor: next.cursor,
    });
  };

  const onChange = (next: string, caret?: number | null) => {
    const handle = handleRef.current;
    if (!handle) return;
    const delta = textDelta(valueRef.current, next);
    valueRef.current = next;
    setValue(next);
    if (delta) applyTextDelta(handle.doc, handle.ytext, delta);
    // « tape… » honnête : 1,5 s après la dernière frappe il s'éteint seul ;
    // le curseur suit la frappe quand le navigateur la rapporte (caret).
    pushAwareness({ typing: true, ...(caret !== undefined ? { cursor: caret } : {}) });
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => pushAwareness({ typing: false }), 1500);
  };

  /// §86 — curseur publié à chaque déplacement (clic, clavier, sélection).
  const onSelect = (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const target = event.currentTarget;
    pushAwareness({ cursor: typeof target.selectionStart === "number" ? target.selectionStart : null });
  };

  // ------------------------- §86 — Verlauf (REST) -------------------------

  const loadHistory = async () => {
    setHistoryError(null);
    try {
      const list = await fetchNotizSnapshots();
      setHistory(list.snapshots);
      setHistoryMax(list.maxSnapshots);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (historyOpen) void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyOpen]);

  const onSnapshot = async () => {
    setHistoryBusy(true);
    setRestoreInfo(null);
    try {
      await createNotizSnapshot();
      await loadHistory();
      setHistoryOpen(true);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : String(error));
      setHistoryOpen(true);
    } finally {
      setHistoryBusy(false);
    }
  };

  const onRestore = async (snap: NotizSnapshot) => {
    const stamp = new Date(snap.createdAt).toLocaleString("de-DE", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    // Le remplacement concerne TOUS les connectés — la confirmation le dit.
    if (!window.confirm(
      `Schnappschuss vom ${stamp} wiederherstellen?\nDer aktuelle Text wird für ALLE Beteiligten ersetzt.`,
    )) return;
    setHistoryBusy(true);
    setRestoreInfo(null);
    try {
      const result = await restoreNotizSnapshot(snap.id);
      setRestoreInfo(
        result.mode === "live"
          ? (result.changed
            ? "Wiederhergestellt — bei allen Live-Teilnehmern angewendet."
            : "Inhalt entsprach bereits dem Schnappschuss — nichts geändert.")
          : "Wiederhergestellt — wirkt beim nächsten Laden der Notiz.",
      );
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setHistoryBusy(false);
    }
  };

  if (hardError) {
    return (
      <Card className="p-5">
        <p className="text-sm text-red-700">
          Gemeinsame Notiz nicht verfügbar: {hardError}
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Gemeinsame Büro-Notiz</h3>
          {peers.map((p) => (
            <span
              key={p.name}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
              title={p.typing ? "tippt gerade…" : p.cursor !== null ? "Cursor-Position (live)" : "live dabei"}
            >
              <i
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: p.color, opacity: p.typing ? 1 : 0.55 }}
              />
              {peerChipText(p, value)}
            </span>
          ))}
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CONN_CLASS[conn]}`}>
          {CONN_LABEL[conn]}
        </span>
      </div>

      {conn === "reconnecting" && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Verbindung getrennt — Sie können weiter schreiben: Ihre Änderungen werden
          beim Wiederverbinden automatisch zusammengeführt (CRDT, kein Überschreiben).
        </p>
      )}
      {conn === "offline" && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
          Backend derzeit nicht erreichbar — die gemeinsame Notiz ist pausiert.
          Ihr Text bleibt in diesem Browser-Tab erhalten.
        </p>
      )}

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
        onSelect={onSelect}
        maxLength={NOTIZ_MAX_CHARS}
        rows={8}
        placeholder={
          conn === "offline"
            ? "Getrennt — Text bleibt lokal erhalten"
            : "Gemeinsame Notiz des Büros — alle Mitglieder schreiben live mit…"
        }
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-inner focus:border-sky-400 focus:outline-none"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span className="flex items-center gap-2">
          <span>{peerChipLabel(peers.length)}</span>
          <button
            type="button"
            onClick={() => setHistoryOpen((o) => !o)}
            className="rounded-md border border-slate-200 px-2 py-0.5 font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Verlauf{history ? ` (${history.length})` : ""}
          </button>
          <button
            type="button"
            onClick={() => void onSnapshot()}
            disabled={historyBusy || conn === "offline"}
            className="rounded-md border border-slate-200 px-2 py-0.5 font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            title="Stand der letzten Auto-Speicherung (max. ~2 s alt)"
          >
            Schnappschuss
          </button>
        </span>
        <span>
          {value.length.toLocaleString("de-DE")}/{NOTIZ_MAX_CHARS.toLocaleString("de-DE")} Zeichen ·
          automatisch gespeichert (Server, ~2 s)
        </span>
      </div>

      {historyOpen && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-700">Verlauf (Server)</p>
            <p className="text-[10px] text-slate-400">
              Schnappschuss = Stand der Auto-Speicherung (≤ ~2 s){historyMax > 0 ? ` · max. ${historyMax} behalten` : ""}
            </p>
          </div>
          {historyError && (
            <p className="mb-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">{historyError}</p>
          )}
          {restoreInfo && (
            <p className="mb-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700">{restoreInfo}</p>
          )}
          {history === null && !historyError ? (
            <p className="py-2 text-center text-[11px] text-slate-400">Verlauf wird geladen…</p>
          ) : history !== null && history.length === 0 ? (
            <p className="py-2 text-center text-[11px] text-slate-400">
              Noch kein Schnappschuss — manuell anlegen oder die Notiz einmal vollständig schließen
              (automatischer Punkt, max. 1 pro 30 min).
            </p>
          ) : (
            <ul className="scroll-thin max-h-56 space-y-1 overflow-y-auto">
              {(history ?? []).map((snap) => (
                <li
                  key={snap.id}
                  className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-2.5 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                      <span className="font-semibold text-slate-800">
                        {new Date(snap.createdAt).toLocaleString("de-DE", {
                          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                      <span className={`rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ${
                        snap.trigger === "manual" ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-500"
                      }`}>
                        {snap.trigger === "manual" ? "manuell" : "auto"}
                      </span>
                      {snap.label && <span className="font-medium text-slate-700">{snap.label}</span>}
                      {snap.createdByName && (
                        <span className="text-slate-400">· {snap.createdByName}</span>
                      )}
                    </p>
                    <p className="truncate text-[10px] text-slate-400" title={snap.preview}>
                      {snap.preview || "(leerer Text)"} · {snap.chars.toLocaleString("de-DE")} Zeichen
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onRestore(snap)}
                    disabled={historyBusy || conn === "offline"}
                    className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                  >
                    Wiederherstellen
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* §89 — slot enfants (positions LV co-éditées) : rendu seulement
          quand la connexion existe réellement, jamais sur une promesse. */}
      {children && handleRef.current && !hardError ? children(handleRef.current) : null}
    </Card>
  );
}
