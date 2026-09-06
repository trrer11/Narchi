import { useMemo, useState } from "react";
import { useApp } from "@/store/AppStore";
import {
  Badge,
  Button,
  Drawer,
  Icon,
  PageHeader,
  ProgressBar,
  SearchInput,
  SegmentedControl,
} from "@/components/ui";
import { formatCarbon, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/utils/cn";

const CATEGORY_TONE: Record<string, "amber" | "violet" | "cyan" | "emerald" | "rose" | "slate"> = {
  Structure: "amber",
  Envelope: "cyan",
  Services: "emerald",
  Interiors: "violet",
  Finishes: "rose",
};

function carbonTone(v: number): "emerald" | "amber" | "rose" {
  if (v <= 0) return "emerald";
  if (v < 1) return "emerald";
  if (v < 3) return "amber";
  return "rose";
}

export default function Materials() {
  const { materials, elements, settings } = useApp();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | string>("all");
  const [sort, setSort] = useState<"name" | "carbon" | "cost">("name");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const usage = useMemo(() => {
    const map: Record<string, { count: number; cost: number; carbonKg: number; weightKg: number }> = {};
    for (const e of elements) {
      const m = (map[e.materialId] ??= { count: 0, cost: 0, carbonKg: 0, weightKg: 0 });
      m.count++; m.cost += e.cost; m.carbonKg += e.carbonKg; m.weightKg += e.weightKg;
    }
    return map;
  }, [elements]);

  const categories = useMemo(() => Array.from(new Set(materials.map((m) => m.category))), [materials]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const list = materials.filter((m) =>
      (category === "all" || m.category === category) &&
      (m.name + m.category + m.supplier + m.origin).toLowerCase().includes(q)
    );
    list.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "de", { numeric: true, sensitivity: "base" });
      if (sort === "cost") return b.unitCost - a.unitCost;
      return b.carbonKgPerKg - a.carbonKgPerKg;
    });
    return list;
  }, [materials, query, category, sort]);

  const selected = materials.find((m) => m.id === selectedId) ?? null;
  const selectedUsage = selected ? usage[selected.id] : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stoffbibliothek"
        subtitle={`${materials.length} hinterlegte Stoffe · Kosten-, Masse- und CO₂-Faktoren`}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={query} onChange={setQuery} placeholder="Stoff oder Lieferant suchen…" className="sm:w-80" />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
          >
            <option value="all">Alle Kategorien</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <SegmentedControl
            value={sort}
            onChange={(v) => setSort(v as typeof sort)}
            options={[
              { value: "carbon", label: "CO₂" },
              { value: "cost", label: "Kosten" },
              { value: "name", label: "Name" },
            ]}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((m) => {
          const u = usage[m.id] ?? { count: 0, cost: 0, carbonKg: 0, weightKg: 0 };
          return (
            <button
              key={m.id}
              onClick={() => setSelectedId(m.id)}
              className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-5 text-left transition-all hover:-translate-y-1 hover:border-brand-200 hover:shadow-lg hover:shadow-slate-200/60"
            >
              <div className="flex items-start justify-between">
                <Badge tone={CATEGORY_TONE[m.category] ?? "slate"}>{m.category}</Badge>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", m.carbonKgPerKg <= 0 ? "bg-emerald-50 text-emerald-600" : m.carbonKgPerKg < 3 ? "bg-brand-50 text-brand-600" : "bg-rose-50 text-rose-600")}>
                  {m.carbonKgPerKg <= 0 ? "CO₂-Senke" : `${m.carbonKgPerKg} kg/kg`}
                </span>
              </div>
              <h3 className="mt-3 font-display text-base font-semibold text-slate-900">{m.name}</h3>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">{m.description}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-400">Stückkosten</div><div className="font-semibold text-slate-800">{formatMoney(m.unitCost, settings.currency)}<span className="text-slate-400">/{m.unit}</span></div></div>
                <div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-400">Masse</div><div className="font-semibold text-slate-800">{formatNumber(m.massPerUnit)} kg<span className="text-slate-400">/{m.unit}</span></div></div>
              </div>
              <div className="mt-auto pt-4">
                <div className="mb-1 flex justify-between text-[11px] text-slate-400"><span>Recyclé</span><span className="font-semibold">{m.recycledContent}%</span></div>
                <ProgressBar value={m.recycledContent} color="#34d399" />
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-400">
                <span className="flex items-center gap-1"><Icon name="cube" size={12} /> {u.count} Bauteile</span>
                <span className="flex items-center gap-1 text-emerald-600"><Icon name="leaf" size={12} /> {formatCarbon(u.carbonKg)}</span>
              </div>
            </button>
          );
        })}
      </div>

      <Drawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected?.name ?? ""}
        footer={selected && <div className="text-xs text-slate-400">Lieferant: <span className="font-semibold text-slate-700">{selected.supplier}</span></div>}
      >
        {selected && selectedUsage && (
          <div className="space-y-5 p-5">
            <div className="flex items-center gap-2">
              <Badge tone={CATEGORY_TONE[selected.category] ?? "slate"}>{selected.category}</Badge>
              <Badge tone={carbonTone(selected.carbonKgPerKg)} dot>
                {selected.carbonKgPerKg <= 0 ? "CO₂-Senke" : `${selected.carbonKgPerKg} kg CO₂e / kg`}
              </Badge>
              <Badge tone="slate">Brand {selected.fireRating}</Badge>
            </div>

            <p className="text-sm leading-relaxed text-slate-600">{selected.description}</p>

            <div className="grid grid-cols-2 gap-3">
              <Stat label="Stückkosten" value={`${formatMoney(selected.unitCost, settings.currency)} / ${selected.unit}`} />
              <Stat label="Masse je Einheit" value={`${formatNumber(selected.massPerUnit)} kg / ${selected.unit}`} />
              <Stat label="Nutzungsdauer" value={`${selected.durabilityYears} Jahre`} />
              <Stat label="Herkunft" value={selected.origin} />
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Wirkung im Portfolio</h4>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Bauteile mit diesem Stoff</span><span className="font-semibold">{selectedUsage.count}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Kosten kumuliert</span><span className="font-semibold">{formatMoney(selectedUsage.cost, settings.currency)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Masse gesamt</span><span className="font-semibold">{formatNumber(selectedUsage.weightKg)} kg</span></div>
                <div className="flex justify-between"><span className="text-slate-500">CO₂ inkarniert</span><span className="font-semibold text-emerald-600">{formatCarbon(selectedUsage.carbonKg)}</span></div>
              </div>
            </div>

            <div>
              <div className="mb-1 flex justify-between text-xs"><span className="text-slate-500">Recyclinganteil</span><span className="font-semibold">{selected.recycledContent}%</span></div>
              <ProgressBar value={selected.recycledContent} color="#34d399" />
            </div>

            <Button className="w-full" variant="secondary" iconRight="arrowRight" onClick={() => { /* navigate handled by parent */ }}>
              Comparer les alternatives
            </Button>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 font-display text-sm font-bold text-slate-900">{value}</div>
    </div>
  );
}


