interface Seg {
  label: string;
  value: number;
  color: string;
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  start: number,
  end: number
): string {
  const [x1, y1] = polar(cx, cy, rOuter, start);
  const [x2, y2] = polar(cx, cy, rOuter, end);
  const [x3, y3] = polar(cx, cy, rInner, end);
  const [x4, y4] = polar(cx, cy, rInner, start);
  const large = end - start > 180 ? 1 : 0;
  return `M${x1},${y1} A${rOuter},${rOuter} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${rInner},${rInner} 0 ${large} 0 ${x4},${y4} Z`;
}

export function DonutChart({
  segments,
  size = 184,
  thickness = 24,
  centerLabel,
  centerSub,
}: {
  segments: Seg[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSub?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 4;
  const rInner = rOuter - thickness;
  let angle = 0;
  const gap = segments.length > 1 ? 1.4 : 0;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={(rOuter + rInner) / 2} fill="none" stroke="#eef1f6" strokeWidth={thickness} />
        {segments.map((s, i) => {
          const sweep = (s.value / total) * 360;
          const start = angle + gap / 2;
          const end = angle + sweep - gap / 2;
          angle += sweep;
          if (end - start < 0.4) return null;
          return (
            <path
              key={i}
              d={arcPath(cx, cy, rOuter, rInner, start, end)}
              fill={s.color}
            >
              <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin={`${i * 0.08}s`} fill="freeze" />
            </path>
          );
        })}
      </svg>
      {(centerLabel || centerSub) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {centerLabel && <span className="font-display text-2xl font-bold text-slate-900">{centerLabel}</span>}
          {centerSub && <span className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">{centerSub}</span>}
        </div>
      )}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; value?: string; color: string }[] }) {
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2 text-slate-600">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} />
            {it.label}
          </span>
          {it.value && <span className="font-semibold tabular-nums text-slate-900">{it.value}</span>}
        </li>
      ))}
    </ul>
  );
}

export function BarChart({
  data,
  height = 200,
  color = "#f59e0b",
  format = (n: number) => String(n),
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  format?: (n: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-3" style={{ height }}>
      {data.map((d, i) => {
        const h = (d.value / max) * (height - 34);
        return (
          <div key={i} className="group flex flex-1 flex-col items-center justify-end gap-2">
            <span className="text-[11px] font-semibold tabular-nums text-slate-400 opacity-0 transition-opacity group-hover:opacity-100">
              {format(d.value)}
            </span>
            <div
              className="w-full rounded-t-md transition-all duration-500"
              style={{
                height: Math.max(h, 4),
                background: `linear-gradient(180deg, ${color}, ${color}bb)`,
              }}
            />
            <span className="text-[11px] font-medium text-slate-500">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function LineChart({
  data,
  height = 180,
  color = "#22d3ee",
}: {
  data: number[];
  height?: number;
  color?: string;
}) {
  const w = 600;
  const h = height;
  const pad = 10;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = (w - pad * 2) / (data.length - 1 || 1);
  const pts = data.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y] as [number, number];
  });
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0]},${h - pad} L${pts[0][0]},${h - pad} Z`;
  const gid = "lc-" + color.replace(/[^a-z0-9]/gi, "");
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={3} fill="#fff" stroke={color} strokeWidth={2} />
      ))}
    </svg>
  );
}

export function HBars({
  data,
  format = (n: number) => String(n),
}: {
  data: { label: string; value: number; color: string }[];
  format?: (n: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-3">
      {data.map((d, i) => (
        <div key={i}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="text-slate-600">{d.label}</span>
            <span className="font-semibold tabular-nums text-slate-900">{format(d.value)}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${(d.value / max) * 100}%`, background: d.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RadialGauge({
  value,
  size = 132,
  thickness = 12,
  color = "#34d399",
  label,
}: {
  value: number;
  size?: number;
  thickness?: number;
  color?: string;
  label?: string;
}) {
  const cx = size / 2;
  const r = size / 2 - thickness / 2 - 2;
  const circumference = 2 * Math.PI * r;
  const dash = (value / 100) * circumference;
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#eef1f6" strokeWidth={thickness} />
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ transition: "stroke-dasharray 0.9s cubic-bezier(0.16,1,0.3,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl font-bold text-slate-900">{Math.round(value)}%</span>
        {label && <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</span>}
      </div>
    </div>
  );
}

export function Sparkline({ data, color = "#22d3ee", width = 90, height = 30 }: { data: number[]; color?: string; width?: number; height?: number }) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = width / (data.length - 1 || 1);
  const pts = data.map((v, i) => `${i * step},${height - ((v - min) / range) * height}`).join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
