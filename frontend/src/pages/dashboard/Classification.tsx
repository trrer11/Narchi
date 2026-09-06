import { useMemo, useState } from "react";
import { useApp } from "@/store/AppStore";
import { NMC_TREE } from "@/data/classification";
import type { ClassificationNode } from "@/data/types";
import { Badge, Card, CardHeader, Icon, PageHeader } from "@/components/ui";
import { formatCarbon, formatMoney, formatNumber, formatWeight } from "@/lib/format";

interface Agg { count: number; cost: number; carbonKg: number; weightKg: number; }

function ancestors(code: string): string[] {
  const parts = code.split("-");
  const out: string[] = [];
  let acc = "NMC";
  for (let i = 1; i < parts.length; i++) {
    acc += "-" + parts[i];
    out.push(acc);
  }
  return out;
}

export default function Classification() {
  const { activeElements, activeProject, projects, setActiveProjectId, settings } = useApp();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(NMC_TREE.map((n) => n.code)));
  const [selected, setSelected] = useState<string>(NMC_TREE[0].code);

  const agg = useMemo(() => {
    const map: Record<string, Agg> = {};
    for (const e of activeElements) {
      for (const c of ancestors(e.code)) {
        const a = (map[c] ??= { count: 0, cost: 0, carbonKg: 0, weightKg: 0 });
        a.count++; a.cost += e.cost; a.carbonKg += e.carbonKg; a.weightKg += e.weightKg;
      }
    }
    return map;
  }, [activeElements]);

  const toggle = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });

  const flat = useMemo(() => {
    const out: { code: string; label: string }[] = [];
    const walk = (nodes: ClassificationNode[]) => {
      for (const n of nodes) {
        out.push({ code: n.code, label: n.label });
        if (n.children) walk(n.children);
      }
    };
    walk(NMC_TREE);
    return out;
  }, []);

  const selectedNode = flat.find((n) => n.code === selected);
  const selectedAgg = agg[selected] ?? { count: 0, cost: 0, carbonKg: 0, weightKg: 0 };

  return (
    <div className="space-y-6">
      <PageHeader
        title="NARCHI-Klassifikation"
        subtitle="NMC · Bauteile je Knoten"
        actions={
          <select
            value={activeProject.id}
            onChange={(e) => setActiveProjectId(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
          >
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Baum" subtitle={`${NMC_TREE.length} groupes · 3 niveaux`} action={<Badge tone="slate">{activeElements.length} Bauteile</Badge>} />
          <div className="p-2">
            {NMC_TREE.map((node) => (
              <NodeRow
                key={node.code}
                node={node}
                depth={0}
                agg={agg}
                expanded={expanded}
                toggle={toggle}
                selected={selected}
                onSelect={setSelected}
              />
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Icon name="branch" className="text-brand-500" />
            <h3 className="font-display font-semibold text-slate-900">{selectedNode?.label}</h3>
          </div>
          <p className="mt-1 font-mono text-xs text-slate-400">{selected}</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Tile label="Bauteile" value={formatNumber(selectedAgg.count)} />
            <Tile label="Masse" value={formatWeight(selectedAgg.weightKg)} />
            <Tile label="Coût" value={formatMoney(selectedAgg.cost, settings.currency, true)} />
            <Tile label="Carbone" value={formatCarbon(selectedAgg.carbonKg)} tone="emerald" />
          </div>
          <div className="mt-5 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
            Knoten wählen — Mengen, Kosten und CO₂ dieser Ebene.
          </div>
        </Card>
      </div>
    </div>
  );
}

function NodeRow({
  node,
  depth,
  agg,
  expanded,
  toggle,
  selected,
  onSelect,
}: {
  node: ClassificationNode;
  depth: number;
  agg: Record<string, Agg>;
  expanded: Set<string>;
  toggle: (code: string) => void;
  selected: string;
  onSelect: (code: string) => void;
}) {
  const hasChildren = !!node.children?.length;
  const isOpen = expanded.has(node.code);
  const a = agg[node.code] ?? { count: 0, cost: 0, carbonKg: 0, weightKg: 0 };
  const isSelected = selected === node.code;
  const badgeTone = depth === 0 ? "bg-brand-50 text-brand-700 ring-brand-200" : depth === 1 ? "bg-slate-100 text-slate-600 ring-slate-200" : "bg-slate-50 text-slate-500 ring-slate-200";

  return (
    <div>
      <div
        onClick={() => onSelect(node.code)}
        className={`group flex cursor-pointer items-center gap-2 rounded-lg py-2 pr-2 transition-colors ${isSelected ? "bg-brand-50/70" : "hover:bg-slate-50"}`}
        style={{ paddingLeft: depth * 18 + 8 }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); toggle(node.code); }}
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-200/60 hover:text-slate-700"
          >
            <Icon name="chevronRight" size={15} className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span className="h-6 w-6" />
        )}
        <span className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold ring-1 ring-inset ${badgeTone}`}>{node.code}</span>
        <span className={`flex-1 truncate text-sm ${depth === 0 ? "font-semibold text-slate-800" : "text-slate-600"}`}>{node.label}</span>
        {a.carbonKg > 0 && <span className="hidden text-xs text-emerald-600 sm:inline">{formatCarbon(a.carbonKg)}</span>}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{formatNumber(a.count)}</span>
      </div>
      {hasChildren && isOpen && node.children!.map((c) => (
        <NodeRow key={c.code} node={c} depth={depth + 1} agg={agg} expanded={expanded} toggle={toggle} selected={selected} onSelect={onSelect} />
      ))}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "emerald" }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 font-display text-base font-bold ${tone === "emerald" ? "text-emerald-600" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}


