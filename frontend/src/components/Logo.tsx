import { cn } from "@/utils/cn";

export function LogoMark({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="narchi-mark" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fbbf24" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="38" height="38" rx="11" fill="url(#narchi-mark)" />
      <rect x="1" y="1" width="38" height="38" rx="11" fill="black" fillOpacity="0.08" />
      <path
        d="M11 28V13.2c0-.6.74-.88 1.13-.42L25.4 27.6c.39.46 1.13.18 1.13-.42V12"
        stroke="#1a1206"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="28.5" cy="12" r="2.4" fill="#1a1206" />
    </svg>
  );
}

export function Logo({ light = false, size = 34, className }: { light?: boolean; size?: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      <span className={cn("font-display text-xl font-bold tracking-tight", light ? "text-white" : "text-slate-900")}>
        Narchi
      </span>
    </div>
  );
}
