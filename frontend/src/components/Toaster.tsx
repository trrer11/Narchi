// Narchi — global toast/error notification system.
// Solves the "silent console.warn" problem: sync failures and errors are now
// visible to the user instead of being swallowed.

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui";
import { cn } from "@/utils/cn";

type ToastKind = "success" | "error" | "warn" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
}

const ToasterCtx = createContext<{ push: (t: Omit<Toast, "id">) => void } | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++counter;
    setToasts((prev) => [...prev, { ...t, id }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 5000);
  }, []);

  const remove = (id: number) => setToasts((prev) => prev.filter((x) => x.id !== id));

  return (
    <ToasterCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => {
          const meta = {
            success: { tone: "border-emerald-200 bg-white", icon: "check", color: "text-emerald-600" },
            error: { tone: "border-rose-200 bg-white", icon: "alert", color: "text-rose-600" },
            warn: { tone: "border-amber-200 bg-white", icon: "alert", color: "text-amber-600" },
            info: { tone: "border-slate-200 bg-white", icon: "bell", color: "text-slate-600" },
          }[t.kind];
          return (
            <div
              key={t.id}
              className={cn("pointer-events-auto flex items-start gap-3 rounded-xl border p-3 shadow-lg animate-fade-up", meta.tone)}
            >
              <Icon name={meta.icon as never} size={18} className={cn("mt-0.5 shrink-0", meta.color)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800">{t.title}</p>
                {t.detail && <p className="mt-0.5 text-xs text-slate-500">{t.detail}</p>}
              </div>
              <button onClick={() => remove(t.id)} className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100">
                <Icon name="x" size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToasterCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToasterCtx);
  if (!ctx) return { push: () => {} };
  return ctx;
}
