import { useState } from "react";
import type { LevelInfo } from "@/data/types";
import { cn } from "@/utils/cn";

/**
 * IsometricBuilding — a stylised interactive digital twin.
 * Each floor is an isometric prism you can hover/click. Colour encodes the
 * active metric (completion, carbon, cost). A "today" line marks progress.
 */

export type TwinMetric = "completion" | "carbon" | "cost";

const METRIC_META: Record<TwinMetric, { label: string; unit: string }> = {
  completion: { label: "Fortschritt", unit: "%" },
  carbon: { label: "CO₂ (A1–A3)", unit: "kgCO₂e" },
  cost: { label: "Kosten", unit: "€" },
};

function metricColor(value: number, metric: TwinMetric): string {
  if (metric === "completion") {
    // red -> amber -> green
    if (value < 40) return "#f43f5e";
    if (value < 70) return "#f59e0b";
    return "#34d399";
  }
  // carbon / cost: low = green, high = amber/red (relative handled by caller)
  if (value < 0.34) return "#34d399";
  if (value < 0.67) return "#f59e0b";
  return "#fb7185";
}

export function IsometricBuilding({
  levels,
  metric = "completion",
  activeLevel,
  onLevel,
  height = 440,
}: {
  levels: LevelInfo[];
  metric?: TwinMetric;
  activeLevel?: string | null;
  onLevel?: (name: string) => void;
  height?: number;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const max = Math.max(
    ...levels.map((l) =>
      metric === "completion" ? l.completion : metric === "carbon" ? l.carbonKg : l.cost
    ),
    1
  );

  // Isometry projection: depth along (dx, dy) and (-dx, dy)
  const W = 560;
  const H = height;
  const cx = W / 2;
  const floorW = 250;
  const floorD = 150;
  const floorH = 30;
  const isoX = 0.62;
  const isoY = 0.34;
  const startTop = H - 70;

  const floors = [...levels]; // top first (index 0 = highest)

  // "today" marker: where cumulative completion passes 50%
  const todayFloorIndex = (() => {
    let acc = 0;
    const total = floors.reduce((s, l) => s + l.completion, 0) || 1;
    for (let i = floors.length - 1; i >= 0; i--) {
      acc += floors[i].completion;
      if (acc / total >= 0.5) return i;
    }
    return floors.length - 1;
  })();

  const project = (x: number, y: number, z: number): [number, number] => {
    const px = cx + (x - y) * isoX;
    const py = startTop - z * isoY - (x + y) * isoY * 0.5;
    return [px, py];
  };

  const floorPath = (floorZ: number) => {
    const A = project(-floorW, -floorD, floorZ);
    const B = project(floorW, -floorD, floorZ);
    const C = project(floorW, floorD, floorZ);
    const D = project(-floorW, floorD, floorZ);
    return `M${A[0]},${A[1]} L${B[0]},${B[1]} L${C[0]},${C[1]} L${D[0]},${D[1]} Z`;
  };

  const faceTop = (floorZ: number) => {
    const A = project(-floorW, -floorD, floorZ);
    const B = project(floorW, -floorD, floorZ);
    const C = project(floorW, floorD, floorZ);
    const D = project(-floorW, floorD, floorZ);
    return [A, B, C, D] as const;
  };

  return (
    <div className="relative w-full" style={{ height: H }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" className="overflow-visible">
        <defs>
          <linearGradient id="twin-ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(34,211,238,0.10)" />
            <stop offset="100%" stopColor="rgba(34,211,238,0)" />
          </linearGradient>
        </defs>

        {/* ground glow ellipse */}
        <ellipse cx={cx} cy={startTop + 18} rx={floorW * 1.6} ry={floorD * 1.0} fill="url(#twin-ground)" />

        {/* shadow */}
        <ellipse cx={cx} cy={startTop + 14} rx={floorW * 0.95} ry={floorD * 0.6} fill="rgba(5,7,15,0.28)" />

        {floors.map((lvl, i) => {
          const z = i * floorH;
          const value =
            metric === "completion"
              ? lvl.completion
              : metric === "carbon"
              ? lvl.carbonKg / max
              : lvl.cost / max;
          const color = metricColor(value, metric);
          const isActive = activeLevel === lvl.name || hover === lvl.name;
          const top = faceTop(z + floorH - 2);
          const isHover = hover === lvl.name;

          // top polygon points
          const topPts = top.map((p) => p.join(",")).join(" ");

          return (
            <g
              key={lvl.name}
              className="cursor-pointer transition-all"
              onMouseEnter={() => setHover(lvl.name)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onLevel?.(lvl.name)}
              style={{ transition: "transform 0.25s ease" }}
            >
              {/* left face */}
              <path
                d={(() => {
                  const TL = project(-floorW, -floorD, z + floorH - 2);
                  const BL = project(-floorW, -floorD, z);
                  const BR = project(-floorW, floorD, z);
                  const TR = project(-floorW, floorD, z + floorH - 2);
                  return `M${TL[0]},${TL[1]} L${BL[0]},${BL[1]} L${BR[0]},${BR[1]} L${TR[0]},${TR[1]} Z`;
                })()}
                fill={color}
                opacity={isActive ? 0.55 : 0.3}
              />
              {/* right face */}
              <path
                d={(() => {
                  const TL = project(-floorW, floorD, z + floorH - 2);
                  const BL = project(-floorW, floorD, z);
                  const BR = project(floorW, floorD, z);
                  const TR = project(floorW, floorD, z + floorH - 2);
                  return `M${TL[0]},${TL[1]} L${BL[0]},${BL[1]} L${BR[0]},${BR[1]} L${TR[0]},${TR[1]} Z`;
                })()}
                fill={color}
                opacity={isActive ? 0.32 : 0.16}
              />
              {/* top face */}
              <polygon
                points={topPts}
                fill={color}
                opacity={isActive ? 1 : 0.78}
                stroke={isActive ? "#fff" : "rgba(255,255,255,0.25)"}
                strokeWidth={isActive ? 1.5 : 0.75}
              />
              {/* floor outline base for depth */}
              <path d={floorPath(z)} fill="none" stroke="rgba(5,7,15,0.12)" strokeWidth={0.5} />

              {/* level label */}
              <text
                x={project(floorW + 14, 0, z + floorH / 2)[0]}
                y={project(floorW + 14, 0, z + floorH / 2)[1] + 3}
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
                fill={isActive ? "#fbbf24" : "rgba(148,163,184,0.8)"}
                fontWeight={isActive ? 700 : 500}
              >
                {lvl.name}
              </text>

              {/* active halo */}
              {isHover && (
                <circle
                  cx={project(0, 0, z + floorH / 2)[0]}
                  cy={project(0, 0, z + floorH / 2)[1]}
                  r="6"
                  fill={color}
                  className="animate-pulse-ring"
                  style={{ transformOrigin: "center" }}
                />
              )}
            </g>
          );
        })}

        {/* "today" construction marker */}
        {(() => {
          const i = todayFloorIndex;
          const z = i * floorH + floorH / 2;
          const [x, y] = project(-floorW - 26, 0, z);
          return (
            <g>
              <line
                x1={x + 8}
                y1={y}
                x2={project(-floorW, 0, z)[0]}
                y2={project(-floorW, 0, z)[1]}
                stroke="#fbbf24"
                strokeWidth={1.5}
                strokeDasharray="3 3"
              />
              <circle cx={x} cy={y} r="4" fill="#fbbf24" />
              <text x={x - 8} y={y + 3} fontSize="9" textAnchor="end" fontFamily="JetBrains Mono, monospace" fill="#fbbf24" fontWeight={700}>
                HEUTE
              </text>
            </g>
          );
        })()}
      </svg>

      {/* hover tooltip */}
      {hover &&
        (() => {
          const lvl = levels.find((l) => l.name === hover);
          if (!lvl) return null;
          return (
            <div className="pointer-events-none absolute right-2 top-2 w-48 rounded-xl border border-white/15 bg-ink-900/95 p-3 text-white shadow-xl backdrop-blur">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-brand-300">{lvl.name}</span>
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">{lvl.type}</span>
              </div>
              <div className="mt-2 space-y-1 text-[11px] text-slate-300">
                <div className="flex justify-between"><span>Bauteile</span><span className="font-semibold text-white">{lvl.elementCount}</span></div>
                <div className="flex justify-between"><span>Fortschritt</span><span className="font-semibold text-white">{lvl.completion}%</span></div>
                <div className="flex justify-between"><span>CO₂</span><span className="font-semibold text-white">{(lvl.carbonKg / 1000).toFixed(1)} t</span></div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}

export { METRIC_META };
export const twinMetricLegend = [
  { label: "Faible", color: "#34d399" },
  { label: "Modéré", color: "#f59e0b" },
  { label: "Élevé", color: "#fb7185" },
];

export function TwinLegend({ metric }: { metric: TwinMetric }) {
  const meta = METRIC_META[metric];
  return (
    <div className="flex items-center gap-3 text-xs text-slate-400">
      <span className="font-semibold text-slate-500">{meta.label}</span>
      <div className="flex items-center gap-2">
        {twinMetricLegend.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5">
            <span className={cn("h-2.5 w-2.5 rounded-sm")} style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
