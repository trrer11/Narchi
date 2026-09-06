import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect } from "react";
import { cn } from "@/utils/cn";
import { Icons, type IconName } from "./icons";

/* ----------------------------- Button (Linear Style) ----------------------------- */
type Variant = "primary" | "dark" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variantClasses: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-500 shadow-[0_1px_2px_rgba(0,0,0,0.1)]",
  dark: "bg-zinc-900 text-zinc-100 hover:bg-zinc-800",
  secondary: "bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700",
  outline: "bg-transparent text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:text-zinc-400 dark:ring-zinc-800 dark:hover:bg-zinc-900",
  ghost: "bg-transparent text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900",
  danger: "bg-rose-600 text-white hover:bg-rose-500",
};
const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-md",
  md: "h-10 px-4 text-sm gap-2 rounded-lg",
  lg: "h-12 px-6 text-base gap-2 rounded-lg",
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
}) {
  return (
    <button
      className={cn(
        "inline-flex select-none items-center justify-center font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 active:scale-95",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 14 : 16} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === "sm" ? 14 : 16} />}
    </button>
  );
}

export function IconButton({
  icon,
  className,
  label,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label?: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
        className
      )}
      {...props}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

export function Icon({ name, size = 18, className, style }: { name: IconName; size?: number; className?: string; style?: React.CSSProperties }) {
  const Cmp = Icons[name];
  return <Cmp size={size} className={className} style={style} />;
}

/* ----------------------------- Card (Bento Style) ----------------------------- */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
      <div>
        <h3 className="font-display text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ----------------------------- Badge (Minimalist) ----------------------------- */
export type Tone = "amber" | "cyan" | "emerald" | "violet" | "rose" | "slate" | "sky";
const toneClasses: Record<Tone, string> = {
  amber: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20",
  cyan: "bg-cyan-50 text-cyan-700 ring-cyan-600/20 dark:bg-cyan-500/10 dark:text-cyan-400 dark:ring-cyan-500/20",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/20",
  rose: "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20",
  slate: "bg-slate-50 text-slate-600 ring-slate-600/20 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/20",
  sky: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-400 dark:ring-sky-500/20",
};

export function Badge({
  tone = "slate",
  children,
  className,
  dot,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
        toneClasses[tone],
        className
      )}
    >
      {dot && <span className="h-1 w-1 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/* ----------------------------- Progress ----------------------------- */
export function ProgressBar({
  value,
  className,
  color = "#f59e0b",
  trackClass = "bg-zinc-100 dark:bg-zinc-800",
}: {
  value: number;
  className?: string;
  color?: string;
  trackClass?: string;
}) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full", trackClass, className)}>
      <div
        className="h-full rounded-full transition-all duration-500 ease-out"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }}
      />
    </div>
  );
}

/* ----------------------------- Avatar ----------------------------- */
export function Avatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-bold text-white ring-1 ring-zinc-200 dark:bg-zinc-100 dark:text-zinc-900 dark:ring-zinc-800",
        className
      )}
    >
      {initials}
    </span>
  );
}

/* ----------------------------- Toggle ----------------------------- */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500/50",
        checked ? "bg-brand-500" : "bg-zinc-300 dark:bg-zinc-700"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

/* ----------------------------- SegmentedControl ----------------------------- */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-all",
            value === o.value ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------- SearchInput ----------------------------- */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
        <Icon name="search" size={14} />
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-600"
      />
    </div>
  );
}

/* ----------------------------- Drawer ----------------------------- */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div className={cn("fixed inset-0 z-50", open ? "pointer-events-auto" : "pointer-events-none")}>
      <div
        className={cn("absolute inset-0 bg-zinc-950/40 backdrop-blur-sm transition-opacity duration-300", open ? "opacity-100" : "opacity-0")}
        onClick={onClose}
      />
      <div
        className={cn(
          "absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ease-out dark:bg-zinc-950",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <h3 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
          <IconButton icon="x" onClick={onClose} label="Schließen" />
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">{footer}</div>}
      </div>
    </div>
  );
}

/* ----------------------------- StatCard (Enterprise) ----------------------------- */
const chipTone: Record<Tone, string> = {
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  cyan: "bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-400",
  emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400",
  rose: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400",
  slate: "bg-slate-50 text-slate-600 dark:bg-slate-500/10 dark:text-slate-400",
  sky: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400",
};

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = "amber",
  trend,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon: IconName;
  tone?: Tone;
  trend?: number;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg transition-colors", chipTone[tone])}>
          <Icon name={icon} size={18} />
        </div>
        {trend !== undefined && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
              trend >= 0 ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400" : "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400"
            )}
          >
            {trend >= 0 ? "+" : ""}{trend}%
          </span>
        )}
      </div>
      <div className="mt-4">
        <div className="font-display text-2xl font-bold text-zinc-900 dark:text-zinc-100">{value}</div>
        <div className="mt-0.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</div>
        {sub && <div className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">{sub}</div>}
      </div>
    </Card>
  );
}

/* ----------------------------- PageHeader ----------------------------- */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  // §224 — Titel sind schon Deutsch. t(title) hat FR-Wörterbuch-Treffer
  // auf denselben Strings erzeugt (z. B. „HOAI-Honorar“).
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="font-display text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ----------------------------- EmptyState ----------------------------- */
export function EmptyState({ icon = "search", title, subtitle }: { icon?: IconName; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
        <Icon name={icon} size={22} />
      </div>
      <div>
        <p className="font-semibold text-zinc-700 dark:text-zinc-200">{title}</p>
        {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
      </div>
    </div>
  );
}

/* ----------------------------- Status metadata ----------------------------- */
export function projectStatusMeta(status: string): { label: string; tone: Tone } {
  const map: Record<string, { label: string; tone: Tone }> = {
    planning: { label: "Planung", tone: "slate" },
    design: { label: "Entwurf", tone: "violet" },
    construction: { label: "Ausführung", tone: "amber" },
    handover: { label: "Übergabe", tone: "cyan" },
    operating: { label: "Betrieb", tone: "emerald" },
  };
  return map[status] ?? map.planning;
}

export function elementStatusMeta(status: string): { label: string; tone: Tone } {
  const map: Record<string, { label: string; tone: Tone }> = {
    modeled: { label: "Modelliert", tone: "slate" },
    validated: { label: "Geprüft", tone: "sky" },
    approved: { label: "Freigegeben", tone: "cyan" },
    issued: { label: "Ausgegeben", tone: "emerald" },
  };
  return map[status] ?? map.modeled;
}

export function sourceStatusMeta(status: string): { label: string; tone: Tone; dot: string } {
  const map: Record<string, { label: string; tone: Tone; dot: string }> = {
    connected: { label: "Verbunden", tone: "emerald", dot: "#10b981" },
    syncing: { label: "Abgleich", tone: "amber", dot: "#f59e0b" },
    idle: { label: "Bereit", tone: "slate", dot: "#94a3b8" },
    error: { label: "Fehler", tone: "rose", dot: "#f43f5e" },
  };
  return map[status] ?? map.idle;
}

export function complianceStatusMeta(status: string): { label: string; tone: Tone; color: string } {
  const map: Record<string, { label: string; tone: Tone; color: string }> = {
    pass: { label: "OK", tone: "emerald", color: "#10b981" },
    fail: { label: "Fehler", tone: "rose", color: "#f43f5e" },
    warn: { label: "Prüfen", tone: "amber", color: "#f59e0b" },
  };
  return map[status] ?? map.warn;
}

export function severityMeta(severity: string): { label: string; tone: Tone } {
  const map: Record<string, { label: string; tone: Tone }> = {
    critical: { label: "Kritisch", tone: "rose" },
    major: { label: "Schwer", tone: "amber" },
    minor: { label: "Gering", tone: "slate" },
  };
  return map[severity] ?? map.minor;
}
