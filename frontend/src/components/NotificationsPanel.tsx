import { useApp } from "@/store/AppStore";
import { Icon, type Tone } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { cn } from "@/utils/cn";
import type { NotificationItem } from "@/data/types";

const META: Record<NotificationItem["kind"], { icon: Parameters<typeof Icon>[0]["name"]; tone: Tone; ring: string }> = {
  sync: { icon: "refresh", tone: "cyan", ring: "bg-cyan-50 text-cyan-600" },
  alert: { icon: "alert", tone: "rose", ring: "bg-rose-50 text-rose-600" },
  carbon: { icon: "leaf", tone: "emerald", ring: "bg-emerald-50 text-emerald-600" },
  compliance: { icon: "shield", tone: "violet", ring: "bg-violet-50 text-violet-600" },
  mention: { icon: "users", tone: "amber", ring: "bg-brand-50 text-brand-600" },
};

export function NotificationsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { notifications, unreadCount, markNotificationRead, markAllNotificationsRead, navigate } = useApp();

  return (
    <div className={cn("fixed inset-0 z-[90]", open ? "pointer-events-auto" : "pointer-events-none")}>
      {open && <div className="absolute inset-0" onClick={onClose} />}
      <div
        className={cn(
          "absolute right-0 top-0 w-[22rem] max-w-[calc(100vw-2rem)] origin-top-right rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all duration-200",
          open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-sm font-semibold text-slate-900">Hinweise</h3>
            {unreadCount > 0 && (
              <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{unreadCount}</span>
            )}
          </div>
          <button
            onClick={markAllNotificationsRead}
            className="text-xs font-semibold text-brand-600 hover:text-brand-700"
          >
            Alle gelesen
          </button>
        </div>
        <ul className="scroll-thin max-h-[60vh] overflow-y-auto">
          {notifications.map((n) => {
            const m = META[n.kind];
            return (
              <li key={n.id}>
                <button
                  onClick={() => {
                    markNotificationRead(n.id);
                    if (n.kind === "compliance") navigate("/app/compliance");
                    else if (n.kind === "alert") navigate("/app/issues");
                    else if (n.kind === "carbon") navigate("/app/quantities");
                    else if (n.kind === "sync") navigate("/app/sync");
                    onClose();
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 border-b border-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-50",
                    !n.read && "bg-brand-50/40"
                  )}
                >
                  <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", m.ring)}>
                    <Icon name={m.icon} size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-800">{n.title}</span>
                      {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-slate-500">{n.detail}</span>
                    <span className="mt-1 block text-[11px] text-slate-400">{relativeTime(n.time)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-slate-100 px-4 py-2.5">
          <button
            onClick={() => { navigate("/app/issues"); onClose(); }}
            className="w-full rounded-lg bg-slate-100 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200"
          >
            Alle Hinweise
          </button>
        </div>
      </div>
    </div>
  );
}
