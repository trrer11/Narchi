/**
 * MEIN KALENDER — calendrier personnel intelligent (demande 2026-08-06).
 *
 * Chaque personne gère SON calendrier :
 *   - tâches avec durée → HEURES TRAVAILLÉES calculées automatiquement ;
 *   - Urlaub (plage), Krankheit, Fortbildung, Konferenz, Termin ;
 *   - fériés ALLEMANDS calculés par Bundesland (Pâques gaussienne) ;
 *   - RAPPEL avant l'échéance → centre de notifications NARCHI +
 *     notification navigateur si autorisée, dédupliqué (notifiedAt) ;
 *   - compte à rebours sur l'échéance la plus proche.
 * Aucune donnée semée : base vide tant que l'utilisateur n'a rien noté.
 * Les calendriers des collègues restent consultables en LECTURE SEULE.
 */
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useApp } from "@/store/AppStore";
import { useAuth } from "@/store/AuthStore";
import { Button, Card, Icon, PageHeader } from "@/components/ui";
import { cn } from "@/utils/cn";
import {
  fetchReminderChannels,
  fetchServerDueReminders,
  loadAcked,
  rememberReminders,
  syncServerReminders,
  unseenReminders,
  type ReminderChannels,
} from "@/lib/reminderSync";
import {
  CAL_KIND_META,
  countdownLabel,
  createMyEntry,
  deleteMyEntry,
  dueReminders,
  entriesOnDate,
  entryStartsAt,
  formatH,
  holidayOn,
  isoWeekNumber,
  istHoursDay,
  listAllEntries,
  listMyEntries,
  markReminded,
  replaceAllEntries,
  monthGridDates,
  monthSummary,
  parseISODate,
  todayISO,
  upcomingReminders,
  type CalEntry,
  type CalKind,
} from "@/lib/myCalendar";
import { pullOfficeBlob, pushOfficeBlob } from "@/lib/officeBlobSync";

const WEEKDAYS_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

const GERMAN_STATES: { code: string; name: string }[] = [
  { code: "BW", name: "Baden-Württemberg" },
  { code: "BY", name: "Bayern" },
  { code: "BE", name: "Berlin" },
  { code: "BB", name: "Brandenburg" },
  { code: "HB", name: "Bremen" },
  { code: "HH", name: "Hamburg" },
  { code: "HE", name: "Hessen" },
  { code: "MV", name: "Mecklenburg-Vorpommern" },
  { code: "NI", name: "Niedersachsen" },
  { code: "NW", name: "Nordrhein-Westfalen" },
  { code: "RP", name: "Rheinland-Pfalz" },
  { code: "SL", name: "Saarland" },
  { code: "SN", name: "Sachsen" },
  { code: "ST", name: "Sachsen-Anhalt" },
  { code: "SH", name: "Schleswig-Holstein" },
  { code: "TH", name: "Thüringen" },
];

const BUNDESLAND_KEY = "narchi:bundesland";

type CalKindLoose = CalKind;

interface DayDraft {
  userId: string;
  date: string;
  kind: CalKindLoose;
  title: string;
  startTime: string;
  endDate: string;
  durationH: string;
  reminderH: string;
  note: string;
}

function emptyDraft(userId: string, dateISO: string): DayDraft {
  return {
    userId,
    date: dateISO,
    kind: "aufgabe",
    title: "",
    startTime: "",
    endDate: dateISO,
    durationH: "",
    reminderH: "24",
    note: "",
  };
}

export default function MeinKalender() {
  const { user, users } = useAuth();
  const { addNotification } = useApp();

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [bundesland, setBundesland] = useState<string>(() => {
    try {
      return localStorage.getItem(BUNDESLAND_KEY) || "NI";
    } catch {
      return "NI"; // Niedersachsen — siège Hanovre
    }
  });
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth0, setViewMonth0] = useState(() => new Date().getMonth());
  const [entries, setEntries] = useState<CalEntry[]>([]);
  const [dialogDate, setDialogDate] = useState<string | null>(null);
  const [draft, setDraft] = useState<DayDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  /// §46 — canaux serveur : undefined = pas encore sondé · null = backend
  /// off/non connecté (rappel local seul) · objet = actif (✉ ou in-App).
  const [serverChannels, setServerChannels] = useState<ReminderChannels | null | undefined>(undefined);

  const owner = users.find((u) => u.id === (selectedUserId ?? user?.id)) ?? user;
  const isOwnCalendar = owner?.id === user?.id;

  const pushKalender = (land: string = bundesland) => {
    void pushOfficeBlob("kalender", { bundesland: land, entries: listAllEntries() });
  };

  const refresh = (uid?: string) => {
    const id = uid ?? owner?.id;
    if (!id) return;
    setEntries(listMyEntries(id));
  };

  useEffect(() => {
    if (owner?.id) refresh(owner.id);
    let live = true;
    void (async () => {
      const remote = await pullOfficeBlob("kalender");
      if (!live || !remote || remote.empty) return;
      if (Array.isArray(remote.payload.entries)) {
        replaceAllEntries(remote.payload.entries as CalEntry[]);
        if (owner?.id) refresh(owner.id);
      }
      if (typeof remote.payload.bundesland === "string" && remote.payload.bundesland.length === 2) {
        setBundesland(remote.payload.bundesland);
        try {
          localStorage.setItem(BUNDESLAND_KEY, remote.payload.bundesland);
        } catch { /* */ }
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner?.id]);

  // ---- Rappels : pousser les rappels dûs (centre de notifications + navigateur)
  useEffect(() => {
    if (!owner?.id) return;
    const mine = listMyEntries(owner.id);
    const due = dueReminders(mine, Date.now());
    if (due.length > 0) {
      due.forEach((e) => {
        const whenLabel = `${parseISODate(e.date).toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long" })}${e.startTime ? ` · ${e.startTime}` : ""}`;
        addNotification({
          id: `cal-${e.id}-${Date.now()}`,
          kind: "alert",
          title: `⏰ ${CAL_KIND_META[e.kind].label} : ${e.title}`,
          detail: `${whenLabel}${e.note ? ` — ${e.note}` : ""}`,
          time: new Date().toLocaleString("de-DE"),
          read: false,
        });
        // Notification navigateur si déjà autorisée (pas de harcèlement de permission).
        try {
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification(`NARCHI — ${e.title}`, { body: whenLabel });
          }
        } catch {
          /* indisponible : notifications internes suffisent */
        }
        markReminded(e.id, Date.now());
      });
      refresh(owner.id);
    }
    // Amorce navigateur : préparation discrète de la permission via un bouton
    // (ci-dessous), jamais automatique.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner?.id]);

  // ---- §46 RAPPELS CÔTÉ SERVEUR (sonnent même NARCHI fermé) ---------------
  // 1) SYNC : les entrées « avec rappel » du calendrier PERSONNEL montent au
  //    backend (upsert) — debounce 2 s après chaque édition. Hors-ligne /
  //    non connecté → silencieux : le rappel local §35 reste la garantie.
  useEffect(() => {
    if (!owner?.id || !isOwnCalendar) return;
    const t = window.setTimeout(() => {
      void syncServerReminders(listMyEntries(owner.id)).then((res) => {
        if (res.ok) setServerChannels(res.channels);
        else setServerChannels((prev) => (prev === undefined ? null : prev));
      });
    }, 2000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner?.id, isOwnCalendar, entries]);

  // 2) SONDAGE DES CANAUX (badge honnête du header) au premier affichage.
  useEffect(() => {
    if (!isOwnCalendar) return;
    void fetchReminderChannels().then((c) => setServerChannels(c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwnCalendar]);

  // 3) PULL in-app : rappels DÉCLENCHÉS par le serveur pendant que NARCHI
  //    était fermé (ou sur un autre appareil). Dédupliqués par (entry, fired_at).
  useEffect(() => {
    if (!isOwnCalendar) return;
    let cancelled = false;
    const pull = async () => {
      const due = await fetchServerDueReminders(48);
      if (cancelled || !due || due.length === 0) return;
      const acked = loadAcked();
      const fresh = unseenReminders(due, acked);
      if (fresh.length === 0) return;
      fresh.forEach((r) => {
        const when = new Date(r.starts_at).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });
        addNotification({
          id: `srv-rem-${r.entry_id}-${r.fired_at}`,
          kind: "alert",
          title: `⏰ ${CAL_KIND_META[r.kind as keyof typeof CAL_KIND_META]?.label ?? r.kind} : ${r.title}`,
          detail: `${when}${r.note ? ` — ${r.note}` : ""} · 🖧 Server-Erinnerung (${r.email_sent ? "✉ E-Mail gesendet" : "in-App — SMTP non configuré"})`,
          time: new Date(r.fired_at).toLocaleString("de-DE"),
          read: false,
        });
        try {
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification(`NARCHI — ${r.title}`, { body: when });
          }
        } catch {
          /* navigateur sans Notification */
        }
      });
      rememberReminders(acked, fresh);
    };
    void pull(); // arrivée sur la page = « NARCHI rouvert »
    const interval = window.setInterval(() => void pull(), 60_000);
    const onFocus = () => void pull();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwnCalendar]);

  // ---- Grille mensuelle
  const gridDates = useMemo(() => monthGridDates(viewYear, viewMonth0), [viewYear, viewMonth0]);
  const today = todayISO();
  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalEntry[]>();
    for (const iso of gridDates) {
      const list = entriesOnDate(entries, iso);
      if (list.length > 0) map.set(iso, list);
    }
    return map;
  }, [entries, gridDates]);

  const summary = useMemo(
    () => monthSummary(entries, viewYear, viewMonth0, bundesland),
    [entries, viewYear, viewMonth0, bundesland],
  );

  const monthHolidays = useMemo(
    () => summary.holidays,
    [summary],
  );

  const upcoming = useMemo(() => upcomingReminders(entries, Date.now(), 7), [entries]);

  const monthLabel = `${MONTHS_DE[viewMonth0]} ${viewYear}`;

  const shiftMonth = (delta: number) => {
    const total = viewYear * 12 + viewMonth0 + delta;
    setViewYear(Math.floor(total / 12));
    setViewMonth0(((total % 12) + 12) % 12);
  };

  const changeBundesland = (code: string) => {
    setBundesland(code);
    try {
      localStorage.setItem(BUNDESLAND_KEY, code);
    } catch {
      /* stockage indisponible */
    }
    pushKalender(code);
  };

  const openDay = (iso: string) => {
    if (!isOwnCalendar) return;
    setDialogDate(iso);
    setEditingId(null);
    setDraft(emptyDraft(owner!.id, iso));
  };

  const openEdit = (e: CalEntry) => {
    if (!isOwnCalendar) return;
    setDialogDate(e.date);
    setEditingId(e.id);
    setDraft({
      userId: e.userId,
      date: e.date,
      kind: e.kind,
      title: e.title,
      startTime: e.startTime ?? "",
      endDate: e.end ?? e.date,
      durationH: e.durationH != null ? String(e.durationH) : "",
      reminderH: String(e.remindH ?? 24),
      note: e.note ?? "",
    });
  };

  const removeEntry = (id: string) => {
    if (!owner?.id) return;
    deleteMyEntry(id, owner.id);
    refresh(owner.id);
  };

  const submitDraft = (ev: FormEvent) => {
    ev.preventDefault();
    if (!draft || !owner?.id) return;
    if (!draft.title.trim()) return;
    if (editingId) deleteMyEntry(editingId, owner.id);
    const duration = draft.durationH.trim() === "" ? undefined : Number(draft.durationH.replace(",", "."));
    createMyEntry({
      userId: owner.id,
      date: draft.date,
      end: draft.endDate > draft.date ? draft.endDate : undefined,
      kind: draft.kind,
      title: draft.title.trim(),
      startTime: draft.startTime || undefined,
      durationH: Number.isFinite(duration) && (duration ?? 0) > 0 ? duration : undefined,
      remindH: draft.reminderH === "0" ? 0 : Number(draft.reminderH) || 24,
      note: draft.note.trim() || undefined,
    });
    setDialogDate(null);
    setDraft(null);
    setEditingId(null);
    refresh(owner.id);
    pushKalender();
  };

  const requestBrowserNotifications = () => {
    try {
      if (typeof Notification === "undefined") return;
      if (Notification.permission === "default") {
        Notification.requestPermission().then((p) => {
          if (p === "granted") {
            new Notification("NARCHI", { body: "Terminerinnerungen aktiviert ✅" });
          }
        });
      }
    } catch {
      /* défensivement */
    }
    setTick((n) => n + 1);
  };

  const dayEntries = dialogDate ? entriesByDay.get(dialogDate) ?? [] : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mein Kalender"
        subtitle={`${owner?.name ?? "—"} · ${MONTHS_DE[viewMonth0]} ${viewYear}`}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={selectedUserId ?? ""}
              onChange={(e) => setSelectedUserId(e.target.value || null)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600"
              title="Angezeigter Kalender (nur der eigene ist änderbar)"
            >
              <option value="">Mein Kalender ({user?.name ?? "—"})</option>
              {users.filter((u) => u.id !== user?.id).map((u) => (
                <option key={u.id} value={u.id}>{u.name} — nur Lesen</option>
              ))}
            </select>
            <select
              value={bundesland}
              onChange={(e) => changeBundesland(e.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600"
              title="Bundesland (jours fériés affichés)"
            >
              {GERMAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
          </div>
        }
      />

      {/* Bandeau intelligent : aujourd'hui + prochaine échéance */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50 to-white px-4 py-3">
        <Icon name="calendar" size={20} className="text-brand-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">
            Heute, {new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            {holidayOn(today, bundesland) ? (
              <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                Feiertag : {holidayOn(today, bundesland)!.name}
              </span>
            ) : null}
          </p>
          <p className="text-xs text-slate-500">
            {upcoming.length > 0
              ? `Nächste : ${CAL_KIND_META[upcoming[0].kind].emoji} ${upcoming[0].title} — ${countdownLabel(entryStartsAt(upcoming[0]), Date.now())}${upcoming[0].startTime ? ` · ${upcoming[0].startTime}` : ""}`
              : "Keine Termine in den nächsten 7 Tagen"}
          </p>
        </div>
        {/* §46 — badge HONNÊTE du rappel serveur : quand NARCHI est fermé,
            le backend sonne (✉ e-mail si SMTP configuré, sinon in-App au
            retour). Jamais affiché « actif » sans preuve. */}
        {serverChannels !== undefined && (
          <span
            className={cn(
              "hidden rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 sm:inline-flex",
              serverChannels === null
                ? "bg-slate-100 text-slate-500 ring-slate-200"
                : serverChannels.email_enabled
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-600/30"
                  : "bg-sky-50 text-sky-700 ring-sky-600/30",
            )}
            title={
              serverChannels === null
                ? "Server aus oder nicht angemeldet — Erinnerungen nur lokal (solange NARCHI offen ist)"
                : serverChannels.email_enabled
                  ? "Der Server sendet auch eine E-Mail, wenn NARCHI geschlossen ist"
                  : "Server merkt Erinnerungen — in-App beim nächsten Öffnen (kein SMTP: keine E-Mail)"
            }
          >
            {serverChannels === null
              ? "🖧 Server aus (lokal ✅)"
              : serverChannels.email_enabled
                ? `🖧 Server aktiv · ✉ ${serverChannels.email_recipient ?? ""}`
                : "🖧 Server aktiv · in-App"}
          </span>
        )}
        <Button size="sm" variant="ghost" onClick={requestBrowserNotifications} title="Browser-Benachrichtigungen (optional)">
          🔔
        </Button>
      </div>

      {/* Mois + navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => shiftMonth(-1)} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">←</button>
          <button
            onClick={() => { const n = new Date(); setViewYear(n.getFullYear()); setViewMonth0(n.getMonth()); }}
            className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-bold text-brand-700 hover:bg-brand-100"
          >Heute</button>
          <button onClick={() => shiftMonth(1)} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">→</button>
          <h2 className="ml-2 font-display text-xl font-bold text-slate-900">{monthLabel}</h2>
        </div>
        <div className="hidden flex-wrap items-center gap-2 md:flex">
          {(Object.keys(CAL_KIND_META) as CalKind[]).map((k) => (
            <span key={k} className="flex items-center gap-1 text-[11px] text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: CAL_KIND_META[k].dot }} />
              {CAL_KIND_META[k].emoji} {CAL_KIND_META[k].label}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
        {/* ==== GRILLE DU MOIS ==== */}
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <div className="min-w-[980px]">
            {/* en-têtes */}
            <div className="grid grid-cols-[48px_repeat(7,1fr)] border-b border-slate-200 bg-slate-50">
              <div className="px-2 py-2 text-center text-[10px] font-bold uppercase text-slate-400">KW</div>
              {WEEKDAYS_DE.map((d, i) => (
                <div key={d} className={cn("border-l border-slate-200 py-2 text-center text-xs font-semibold", i >= 5 ? "text-rose-400" : "text-slate-500")}>{d}</div>
              ))}
            </div>
            {/* 6 semaines */}
            {Array.from({ length: 6 }, (_, w) => {
              const week = gridDates.slice(w * 7, w * 7 + 7);
              return (
                <div key={w} className="grid grid-cols-[48px_repeat(7,1fr)] border-b border-slate-100 last:border-0">
                  <div className="flex items-start justify-center pt-2 text-[10px] font-bold text-slate-300">
                    KW{isoWeekNumber(week[0])}
                  </div>
                  {week.map((iso, idx) => {
                    const d = parseISODate(iso);
                    const inMonth = d.getMonth() === viewMonth0;
                    const isToday = iso === today;
                    const holiday = holidayOn(iso, bundesland);
                    const dayList = entriesByDay.get(iso) ?? [];
                    const dayHours = istHoursDay(dayList, iso);
                    const hasRange = dayList.some((e) => e.end && e.end > (e.date as string));
                    return (
                      <button
                        key={iso}
                        type="button"
                        onClick={() => openDay(iso)}
                        disabled={!isOwnCalendar}
                        className={cn(
                          "group relative min-h-[104px] border-l border-slate-100 p-1.5 text-left align-top transition",
                          !inMonth && "bg-slate-50/60 text-slate-300",
                          isOwnCalendar ? "hover:bg-brand-50/40" : "cursor-default",
                        )}
                        title={isOwnCalendar ? "Eintrag hinzufügen / bearbeiten" : "Nur Lesen — Kalender eines Kollegen"}
                      >
                        <span className={cn(
                          "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                          isToday ? "bg-brand-600 text-white shadow" : inMonth ? "text-slate-700" : "text-slate-300",
                          idx >= 5 && !isToday && "text-rose-400",
                        )}>
                          {d.getDate()}
                        </span>
                        {holiday && (
                          <span className="mt-0.5 block truncate text-[9px] font-bold uppercase tracking-wide text-rose-500" title={`Feiertag : ${holiday.name}`}>
                            {holiday.name}
                          </span>
                        )}
                        <div className="mt-0.5 space-y-0.5">
                          {dayList.slice(0, 3).map((e) => {
                            const meta = CAL_KIND_META[e.kind];
                            return (
                              <span
                                key={e.id}
                                className={cn("block truncate rounded-md px-1 py-0.5 text-[9.5px] font-semibold ring-1 ring-inset", meta.chip)}
                                title={`${meta.label} : ${e.title}${e.startTime ? ` · ${e.startTime}` : ""}${e.durationH ? ` · ${formatH(e.durationH)}` : ""}`}
                              >
                                {e.startTime ? `${e.startTime} ` : ""}{meta.emoji} {e.title}
                              </span>
                            );
                          })}
                          {dayList.length > 3 && (
                            <span className="block px-1 text-[9px] font-bold text-slate-400">+{dayList.length - 3} weitere</span>
                          )}
                        </div>
                        {(dayHours > 0 || hasRange) && (
                          <span className="absolute bottom-1 right-1 flex items-center gap-1">
                            {hasRange && <span className="rounded bg-sky-100 px-1 text-[8.5px] font-bold text-sky-700">🏖️</span>}
                            {dayHours > 0 && (
                              <span className="rounded bg-emerald-100 px-1 text-[8.5px] font-bold text-emerald-700">{formatH(dayHours)}</span>
                            )}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* ==== COLONNE LATÉRALE ==== */}
        <div className="space-y-4">
          <MonthlyStats summary={summary} monthLabel={monthLabel} />
          <Card className="p-4">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Bevorstehend · 7 Tage</h3>
            {upcoming.length === 0 ? (
              <p className="text-xs text-slate-400">Keine Termine — Aufgaben und Termine eintragen</p>
            ) : (
              <ul className="space-y-2">
                {upcoming.map((e) => (
                  <li key={e.id} className="flex items-start gap-2">
                    <span className="mt-0.5 text-sm">{CAL_KIND_META[e.kind].emoji}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-slate-700">{e.title}</p>
                      <p className="text-[10px] text-slate-400">
                        {parseISODate(e.date).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" })}
                        {e.startTime ? ` · ${e.startTime}` : ""} — <span className="font-bold text-brand-600">{countdownLabel(entryStartsAt(e), Date.now())}</span>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {monthHolidays.length > 0 && (
            <Card className="p-4">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Feiertage ({GERMAN_STATES.find((s) => s.code === bundesland)?.name ?? bundesland})</h3>
              <ul className="space-y-1">
                {monthHolidays.map((h) => (
                  <li key={h.date} className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-600">{h.name}</span>
                    <span className="text-slate-400">{parseISODate(h.date).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" })}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {/* ==== ÉDITEUR DE JOUR (dialogue) ==== */}
      {dialogDate && draft && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm" onClick={() => setDialogDate(null)} />
          <div className="relative w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-slate-900">
                {parseISODate(dialogDate).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                {holidayOn(dialogDate, bundesland) ? <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">{holidayOn(dialogDate, bundesland)!.name}</span> : null}
              </h3>
              <button onClick={() => setDialogDate(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">✕</button>
            </div>

            {dayEntries.length > 0 && (
              <div className="mt-3 rounded-xl border border-slate-100">
                {dayEntries.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 border-b border-slate-50 px-3 py-2 last:border-0">
                    <span>{CAL_KIND_META[e.kind].emoji}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-slate-700">
                        {e.title}
                        {e.startTime ? <span className="ml-1 font-normal text-slate-400">· {e.startTime}</span> : null}
                        {e.durationH ? <span className="ml-1 rounded bg-emerald-100 px-1 text-[9.5px] font-bold text-emerald-700">{formatH(e.durationH)}</span> : null}
                        {(e.remindH ?? 0) > 0 ? <span className="ml-1" title={`Erinnerung ${e.remindH} h vorher`}>🔔</span> : null}
                      </p>
                      {e.note ? <p className="truncate text-[10px] text-slate-400">{e.note}</p> : null}
                    </div>
                    <button onClick={() => openEdit(e)} className="rounded px-2 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-100">✏️</button>
                    <button onClick={() => removeEntry(e.id)} className="rounded px-2 py-1 text-[11px] font-bold text-rose-400 hover:bg-rose-50">🗑️</button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={submitDraft} className="mt-4 space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                {editingId ? "Eintrag bearbeiten" : "Neuer Eintrag"}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-slate-500">Typ</label>
                  <div className="mt-1 grid grid-cols-3 gap-1">
                    {(Object.keys(CAL_KIND_META) as CalKind[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setDraft({ ...draft, kind: k })}
                        className={cn("rounded-lg px-1.5 py-1.5 text-[10px] font-bold ring-1 transition", draft.kind === k ? CAL_KIND_META[k].chip : "bg-slate-50 text-slate-400 ring-slate-200 hover:bg-slate-100")}
                      >
                        {CAL_KIND_META[k].emoji} {CAL_KIND_META[k].label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-500">Titel *</label>
                    <input
                      autoFocus
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      placeholder={draft.kind === "termin" ? "z. B. Jour fixe BIM" : draft.kind === "urlaub" ? "z. B. Sommerurlaub" : "z. B. LV schreiben"}
                      className="mt-1 h-9 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
                    />
                  </div>
                  {draft.kind === "urlaub" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-500">Von</label>
                        <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className="mt-1 h-9 w-full rounded-xl border border-slate-200 px-2 text-sm" />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-500">Bis</label>
                        <input type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} className="mt-1 h-9 w-full rounded-xl border border-slate-200 px-2 text-sm" />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {draft.kind !== "urlaub" && (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-500">Uhrzeit</label>
                    <input type="time" value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} className="mt-1 h-9 w-full rounded-xl border border-slate-200 px-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-500">Dauer (h)</label>
                    <input value={draft.durationH} onChange={(e) => setDraft({ ...draft, durationH: e.target.value })} placeholder="z. B. 3,5" inputMode="decimal" className="mt-1 h-9 w-full rounded-xl border border-slate-200 px-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-500">🔔 Erinnerung</label>
                    <select value={draft.reminderH} onChange={(e) => setDraft({ ...draft, reminderH: e.target.value })} className="mt-1 h-9 w-full rounded-xl border border-slate-200 px-2 text-sm">
                      <option value="0">Keine</option>
                      <option value="1">1 h vorher</option>
                      <option value="24">24 h vorher</option>
                      <option value="48">48 h vorher</option>
                      <option value="168">1 Woche vorher</option>
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="text-[11px] font-semibold text-slate-500">Notiz</label>
                <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="Raum, Link, Auftraggeber…" className="mt-1 h-9 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30" />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setDialogDate(null)}>Abbrechen</Button>
                <Button type="submit" icon="check">{editingId ? "Speichern" : "Hinzufügen"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/** Bilan mensuel — le cerveau du calendrier : heures calculées automatiquement. */
function MonthlyStats({ summary, monthLabel }: { summary: ReturnType<typeof monthSummary>; monthLabel: string }) {
  const rows: { label: string; emoji: string; value: string }[] = [
    { label: `Stunden (IST)`, emoji: "🛠️", value: formatH(summary.workH) },
    { label: `Stunden (SOLL)`, emoji: "🎯", value: formatH(summary.targetH) },
    {
      label: summary.deltaH >= 0 ? "Überstunden" : "Reststunden",
      emoji: summary.deltaH >= 0 ? "➕" : "⏳",
      value: `${summary.deltaH >= 0 ? "+" : "−"}${formatH(Math.abs(summary.deltaH))}`,
    },
    { label: "Urlaubstage", emoji: "🏖️", value: String(summary.vacationD) },
    { label: "Kranktage", emoji: "🤒", value: String(summary.sickD) },
    { label: "Fortbildung / Konferenz", emoji: "🎓", value: `${summary.trainingD} Tage` },
    { label: "Termine", emoji: "🗓️", value: String(summary.meetingCount) },
  ];
  return (
    <Card className="p-4">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Monat · {monthLabel}</h3>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-1.5">
            <span className="text-xs text-slate-500">{r.emoji} {r.label}</span>
            <span className={cn("text-sm font-bold tabular-nums", r.label.includes("Überstunden") ? "text-emerald-600" : "text-slate-800")}>{r.value}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
        SOLL = 8 h × jours ouvrés (hors W.E., fériés, Urlaub & Krankheit). IST = durées notées.
      </p>
    </Card>
  );
}
