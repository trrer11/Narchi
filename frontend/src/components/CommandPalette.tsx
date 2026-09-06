import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/store/AppStore";
import { Icon } from "@/components/ui";
import type { IconName } from "@/components/icons";
import { cn } from "@/utils/cn";

interface CmdEntry {
  id: string;
  label: string;
  hint: string;
  icon: IconName;
  group: string;
  run: () => void;
}

const PAGES: { id: string; label: string; icon: IconName }[] = [
  { id: "overview", label: "Übersicht", icon: "grid" },
  { id: "import", label: "Modell-Import (BIM/CAD/IFC)", icon: "cube" },
  { id: "plot", label: "Grundstücksanalyse (Labor)", icon: "pin" },
  { id: "projects", label: "Projekte", icon: "building" },
  { id: "twin", label: "Digitaler Zwilling (Labor)", icon: "box" },
  { id: "elements", label: "Bauteile", icon: "cube" },
  { id: "quantities", label: "Mengen & Aufmaß", icon: "scale" },
  { id: "cost", label: "Kostenschätzung (DIN 276)", icon: "gauge" },
  { id: "energy", label: "GEG-Energiebilanz", icon: "bolt" },
  { id: "physics", label: "Bauphysik (Labor)", icon: "layers" },
  { id: "lca", label: "CO₂-Bilanz / LCA (DIN EN 15978)", icon: "leaf" },
  { id: "hoai", label: "HOAI-Honorar", icon: "scale" },
  { id: "schedule", label: "Bauablauf 4D", icon: "calendar" },
  { id: "materials", label: "Baustoffe", icon: "package" },
  { id: "classification", label: "Klassifikation NMC", icon: "branch" },
  { id: "sync", label: "Synchronisierung", icon: "refresh" },
  { id: "compliance", label: "Konformität", icon: "shield" },
  { id: "planpruefung", label: "Planprüfung (AABB, kein Mesh)", icon: "layers" },
  { id: "qs", label: "Clash-Radar & Bauteil-QC", icon: "shield" },
  { id: "issues", label: "Mängel", icon: "flag" },
  { id: "team", label: "Team & Zugänge", icon: "users" },
  { id: "messages", label: "Team-Messages", icon: "pulse" },
  { id: "klima", label: "Büro-Klima & Humor", icon: "spark" },
  { id: "kalender", label: "Ressourcenplanung", icon: "calendar" },
  { id: "practice", label: "Büro-Management (Zeiterfassung)", icon: "gauge" },
  { id: "feedback", label: "Feedback", icon: "spark" },
  { id: "settings", label: "Einstellungen", icon: "cog" },
  { id: "grenzen", label: "Grenzen & Recht (kein Mesh / kein Peppol-AP)", icon: "shield" },
  { id: "vault", label: "DataVault (Sicherheit & Datenschutz)", icon: "shield" },
  { id: "backend", label: "Backend (Multi-Device Setup)", icon: "database" },
  { id: "roadmap", label: "Roadmap", icon: "target" },
];

export function CommandPalette() {
  const { commandOpen, setCommandOpen, navigate, projects, setActiveProjectId, runSync, kpis } = useApp();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global hotkey: ⌘K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(!commandOpen);
      }
      if (e.key === "Escape" && commandOpen) setCommandOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commandOpen, setCommandOpen]);

  useEffect(() => {
    if (commandOpen) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [commandOpen]);

  const entries = useMemo<CmdEntry[]>(() => {
    const close = () => setCommandOpen(false);
    const pages: CmdEntry[] = PAGES.map((p) => ({
      id: "page-" + p.id,
      label: p.label,
      hint: "Seite",
      icon: p.icon,
      group: "Navigation",
      run: () => { navigate(`/app/${p.id}`); close(); },
    }));
    const proj: CmdEntry[] = projects.map((p) => ({
      id: "proj-" + p.id,
      label: p.name,
      hint: p.code,
      icon: "building",
      group: "Projekt wählen",
      run: () => { setActiveProjectId(p.id); navigate("/app/overview"); close(); },
    }));
    const actions: CmdEntry[] = [
      { id: "act-sync", label: "Abgleich starten", hint: "Aktion", icon: "refresh", group: "Aktionen", run: () => { void runSync(); navigate("/app/sync"); close(); } },
      { id: "act-issues", label: `${kpis.openConflicts} offene Hinweise`, hint: "Aktion", icon: "alert", group: "Aktionen", run: () => { navigate("/app/issues"); close(); } },
      { id: "act-compliance", label: "Konformität öffnen", hint: "Aktion", icon: "shield", group: "Actions", run: () => { navigate("/app/compliance"); close(); } },
    ];
    return [...actions, ...pages, ...proj];
  }, [projects, navigate, setActiveProjectId, runSync, kpis.openConflicts, setCommandOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => (e.label + " " + e.hint + " " + e.group).toLowerCase().includes(q));
  }, [entries, query]);

  // group filtered
  const grouped = useMemo(() => {
    const map = new Map<string, CmdEntry[]>();
    for (const e of filtered) {
      const arr = map.get(e.group) ?? [];
      arr.push(e);
      map.set(e.group, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const flat = filtered;

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!commandOpen) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); flat[active]?.run(); }
  };

  let runningIdx = -1;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm animate-fade-up" onClick={() => setCommandOpen(false)} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4">
          <Icon name="command" size={18} className="text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Seite, Projekt oder Aktion suchen…"
            className="h-14 flex-1 bg-transparent text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
          <kbd className="hidden rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 sm:block">ESC</kbd>
        </div>
        <div ref={listRef} className="scroll-thin max-h-[52vh] overflow-y-auto p-2">
          {grouped.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-400">Keine Treffer für « {query} ».</div>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group} className="mb-2">
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{group}</div>
                {items.map((e) => {
                  runningIdx++;
                  const idx = runningIdx;
                  return (
                    <button
                      key={e.id}
                      data-idx={idx}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => e.run()}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                        active === idx ? "bg-brand-50" : "hover:bg-slate-50"
                      )}
                    >
                      <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", active === idx ? "bg-brand-500 text-ink-950" : "bg-slate-100 text-slate-500")}>
                        <Icon name={e.icon} size={16} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">{e.label}</span>
                        <span className="block truncate text-xs text-slate-400">{e.hint}</span>
                      </span>
                      {active === idx && <Icon name="arrowRight" size={14} className="text-brand-500" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-semibold">↑</kbd><kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-semibold">↓</kbd> blättern</span>
            <span className="flex items-center gap-1"><kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-semibold">↵</kbd> öffnen</span>
          </div>
          <span className="font-display font-bold text-slate-300">Narchi</span>
        </div>
      </div>
    </div>
  );
}
