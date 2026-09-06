import { useMemo, useState } from "react";
import { useApp } from "@/store/AppStore";
import { NMC_GROUPS } from "@/data/classification";
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  Icon,
  IconButton,
  PageHeader,
  ProgressBar,
  SearchInput,
  SegmentedControl,
  elementStatusMeta,
} from "@/components/ui";
import { formatCarbon, formatMoney, formatNumber, formatWeight } from "@/lib/format";
import { sortByLevelName } from "@/lib/levelSort";
import type { ElementStatus } from "@/data/types";

type SortKey = "standard" | "name" | "cost" | "carbon" | "weight" | "qty";
const PAGE_SIZE = 11;

const STATUS_OPTS: { value: ElementStatus | "all"; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "modeled", label: "Modélisé" },
  { value: "validated", label: "Validé" },
  { value: "approved", label: "Approuvé" },
  { value: "issued", label: "Émis" },
];

function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
    >
      {children}
    </select>
  );
}

export default function Elements() {
  const { activeElements, getMaterial, activeProject, projects, setActiveProjectId, setElementStatus, settings } = useApp();
  const currency = settings.currency;

  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [status, setStatus] = useState<ElementStatus | "all">("all");
  const [material, setMaterial] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("standard");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const projectMaterials = useMemo(() => {
    const ids = new Set(activeElements.map((e) => e.materialId));
    return Array.from(ids).map((id) => getMaterial(id)!).filter(Boolean);
  }, [activeElements, getMaterial]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const list = activeElements.filter((e) => {
      if (group !== "all" && !e.code.startsWith(group)) return false;
      if (status !== "all" && e.status !== status) return false;
      if (material !== "all" && e.materialId !== material) return false;
      if (q && !(e.name + e.type + e.code + e.classificationLabel + e.level).toLowerCase().includes(q)) return false;
      return true;
    });
    // ORDRE BUREAU par défaut (demande 2026-08-06) : par NIVEAU (cave → EG →
    // étages → Dach) puis alphabétique. Les autres tris restent un clic away.
    if (sortKey === "standard") {
      return sortByLevelName(list, (e) => e.level, (e) => e.name);
    }
    const dir = sortDir === "asc" ? 1 : -1;
    const fieldOf: Record<Exclude<SortKey, "name" | "standard">, "cost" | "carbonKg" | "weightKg" | "qty"> = {
      cost: "cost", carbon: "carbonKg", weight: "weightKg", qty: "qty",
    };
    list.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name, "de", { numeric: true }) * dir;
      const f = fieldOf[sortKey];
      return ((a[f] as number) - (b[f] as number)) * dir;
    });
    return list;
  }, [activeElements, query, group, status, material, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const totals = useMemo(() => ({
    cost: filtered.reduce((s, e) => s + e.cost, 0),
    carbon: filtered.reduce((s, e) => s + e.carbonKg, 0),
    weight: filtered.reduce((s, e) => s + e.weightKg, 0),
  }), [filtered]);

  const selected = filtered.find((e) => e.id === selectedId) ?? activeElements.find((e) => e.id === selectedId) ?? null;
  const selectedMaterial = selected ? getMaterial(selected.materialId) : undefined;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const onFilterChange = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1); };

  const SortHead = ({ k, label, align = "right" }: { k: SortKey; label: string; align?: "left" | "right" }) => (
    <th className={`px-4 py-3 font-semibold ${align === "right" ? "text-right" : "text-left"}`}>
      <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 transition-colors hover:text-slate-900 ${sortKey === k ? "text-slate-900" : ""}`}>
        {label}
        <Icon name={sortKey === k ? (sortDir === "asc" ? "chevronDown" : "chevronDown") : "chevronDown"} size={14} className={sortKey === k ? (sortDir === "asc" ? "rotate-180" : "") : "opacity-30"} />
      </button>
    </th>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bauteile"
        subtitle={`${formatNumber(activeElements.length)} Bauteile · ${activeProject.name}`}
        actions={
          <Select value={activeProject.id} onChange={(v) => setActiveProjectId(v)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryStat label="Kosten gesamt" value={formatMoney(totals.cost, currency, true)} icon="scale" tone="amber" />
        <SummaryStat label="CO₂ inkarniert" value={formatCarbon(totals.carbon)} icon="leaf" tone="emerald" />
        <SummaryStat label="Masse totale" value={formatWeight(totals.weight)} icon="cube" tone="violet" />
        <SummaryStat label="Gefilterte Bauteile" value={formatNumber(filtered.length)} icon="filter" tone="cyan" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput value={query} onChange={onFilterChange(setQuery)} placeholder="Bauteil suchen…" className="lg:w-72" />
          {/* Rappel de l'ordre officiel bureau (par défaut) + retour rapide. */}
          {sortKey === "standard" ? (
            <span className="hidden items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-[11px] font-bold text-brand-700 md:inline-flex" title="Amtliche Reihenfolge: Keller → EG → Geschosse → Dach, dann A–Z">
              <Icon name="building" size={12} /> Ebene → A–Z
            </span>
          ) : (
            <button
              onClick={() => { setSortKey("standard"); setPage(1); }}
              className="hidden items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-500 transition hover:bg-brand-50 hover:text-brand-700 md:inline-flex"
              title="Zurück zur Amtsreihenfolge: Geschoss, dann A–Z"
            >
              <Icon name="building" size={12} /> Ebene → A–Z ?
            </button>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={group} onChange={onFilterChange(setGroup)}>
              <option value="all">Toutes classifications</option>
              {NMC_GROUPS.map((g) => <option key={g.code} value={g.code}>{g.code} · {g.label}</option>)}
            </Select>
            <Select value={material} onChange={onFilterChange(setMaterial)}>
              <option value="all">Toutes matières</option>
              {projectMaterials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
            <SegmentedControl options={STATUS_OPTS} value={status} onChange={onFilterChange(setStatus)} />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-xs uppercase tracking-wide text-slate-500">
                <SortHead k="name" label="Bauteil" align="left" />
                <th className="px-4 py-3 text-left">Classification</th>
                <th className="px-4 py-3 text-left">Matière</th>
                <th className="px-4 py-3 text-left">Niveau</th>
                <SortHead k="qty" label="Menge" />
                <SortHead k="weight" label="Masse" />
                <SortHead k="cost" label="Coût" />
                <SortHead k="carbon" label="CO₂" />
                <th className="px-4 py-3 text-right">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pageItems.map((e) => {
                const mat = getMaterial(e.materialId);
                const meta = elementStatusMeta(e.status);
                return (
                  <tr key={e.id} onClick={() => setSelectedId(e.id)} className="cursor-pointer transition-colors hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {e.conflicts > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" title={`${e.conflicts} Konflikt(e)`} />}
                        <div>
                          <div className="font-semibold text-slate-800">{e.name}</div>
                          <div className="font-mono text-[11px] text-slate-400">{e.id} · {e.type}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><div className="text-slate-600">{e.classificationLabel}</div><div className="font-mono text-[11px] text-slate-400">{e.code}</div></td>
                    <td className="px-4 py-3 text-slate-600">{mat?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{e.level}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatNumber(e.qty, e.qty < 10 ? 2 : 0)} <span className="text-slate-400">{e.unit}</span></td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatWeight(e.weightKg)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">{formatMoney(e.cost, currency, true)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{formatCarbon(e.carbonKg)}</td>
                    <td className="px-4 py-3 text-right"><Badge tone={meta.tone}>{meta.label}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pageItems.length === 0 && <EmptyState title="Keine Bauteile" subtitle="Filter lockern, um Treffer zu sehen." />}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
          <span>Affichage {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} sur {formatNumber(filtered.length)}</span>
          <div className="flex items-center gap-1">
            <IconButton icon="chevronLeft" label="Précédent" onClick={() => setPage((p) => Math.max(1, p - 1))} className={currentPage === 1 ? "pointer-events-none opacity-40" : ""} />
            <span className="px-2 text-xs font-semibold text-slate-700">{currentPage} / {totalPages}</span>
            <IconButton icon="chevronRight" label="Suivant" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className={currentPage === totalPages ? "pointer-events-none opacity-40" : ""} />
          </div>
        </div>
      </Card>

      <Drawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected ? selected.name : ""}
        footer={
          selected && (
            <div className="flex flex-wrap gap-2">
              {(["validated", "approved", "issued"] as ElementStatus[]).map((st) => (
                <Button
                  key={st}
                  size="sm"
                  variant={selected.status === st ? "primary" : "secondary"}
                  disabled={selected.status === st}
                  onClick={() => setElementStatus(selected.id, st)}
                >
                  {elementStatusMeta(st).label}
                </Button>
              ))}
            </div>
          )
        }
      >
        {selected && selectedMaterial && (
          <div className="space-y-5 p-5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-slate-400">{selected.id}</span>
              <Badge tone={elementStatusMeta(selected.status).tone}>{elementStatusMeta(selected.status).label}</Badge>
              {selected.conflicts > 0 && <Badge tone="rose" dot>{selected.conflicts} conflit(s)</Badge>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Metric label="Menge" value={`${formatNumber(selected.qty, selected.qty < 10 ? 2 : 0)} ${selected.unit}`} />
              <Metric label="Masse" value={formatWeight(selected.weightKg)} />
              <Metric label="Coût" value={formatMoney(selected.cost, currency)} />
              <Metric label="Carbone" value={formatCarbon(selected.carbonKg)} tone="emerald" />
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-800">{selectedMaterial.name}</p>
                  <p className="text-xs text-slate-500">{selectedMaterial.category} · Coupure au feu {selectedMaterial.fireRating}</p>
                </div>
                <Icon name="leaf" className="text-emerald-500" />
              </div>
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-xs text-slate-500"><span>Matière recyclée</span><span className="font-semibold">{selectedMaterial.recycledContent}%</span></div>
                <ProgressBar value={selectedMaterial.recycledContent} color="#34d399" />
              </div>
              <p className="mt-3 text-xs text-slate-400">Provenance : {selectedMaterial.origin}</p>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Propriétés</h4>
              <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {selected.properties.map((p) => (
                  <div key={p.key} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <dt className="text-slate-500">{p.key}</dt>
                    <dd className="font-medium text-slate-800">{p.value}</dd>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <dt className="text-slate-500">Identifiant global</dt>
                  <dd className="font-mono text-xs text-slate-700">{selected.guid}</dd>
                </div>
              </dl>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function SummaryStat({ label, value, icon, tone }: { label: string; value: string; icon: Parameters<typeof Icon>[0]["name"]; tone: "amber" | "emerald" | "violet" | "cyan" }) {
  const toneClass = {
    amber: "bg-brand-50 text-brand-600", emerald: "bg-emerald-50 text-emerald-600",
    violet: "bg-violet-50 text-violet-600", cyan: "bg-cyan-50 text-cyan-600",
  }[tone];
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneClass}`}><Icon name={icon} size={20} /></span>
      <div>
        <div className="font-display text-lg font-bold text-slate-900">{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </div>
    </Card>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "emerald" }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 font-display text-base font-bold ${tone === "emerald" ? "text-emerald-600" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}
