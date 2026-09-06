import { useMemo, useState } from "react";
import { useApp } from "@/store/AppStore";
import { downloadBackup } from "@/lib/dataVault";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Icon,
  IconButton,
  PageHeader,
  ProgressBar,
  SearchInput,
  SegmentedControl,
  projectStatusMeta,
} from "@/components/ui";
import { formatCarbon, formatMoney, formatNumber } from "@/lib/format";
import type { CostResult } from "@/lib/costEngine";
import { fmtMoney, fmtNumber } from "@/lib/costEngine";
import { projectCarbonSummaries } from "@/lib/carbonCockpit";
import { VERDICT_META } from "@/lib/veEngine";
import { DEMO_PROJECT_ID, makeDemoElements, makeDemoProject } from "@/lib/demoProject";
import type { Project, ProjectStatus } from "@/data/types";
import { secureFetch } from "@/auth/SecuritySanitizer";
import { useToast } from "@/components/Toaster";
import { cn } from "@/utils/cn";

  const STATUSES: { value: ProjectStatus | "all"; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "planning", label: "Planung" },
  { value: "design", label: "Entwurf" },
  { value: "construction", label: "Ausführung" },
  { value: "handover", label: "Übergabe" },
  { value: "operating", label: "Betrieb" },
];

function DinEstimate({
  projectId,
  estimateForProject,
  budget,
  country,
}: {
  projectId: string;
  estimateForProject: (id: string) => CostResult | null;
  budget: number;
  country: "EUR" | "CHF";
}) {
  const est = estimateForProject(projectId);
  if (!est) return null;
  const diff = budget - est.netTotal;
  const diffPct = budget ? (diff / budget) * 100 : 0;
  const over = diff < 0;
  return (
    <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          <Icon name="gauge" size={12} /> Kostenschätzung DIN 276
        </span>
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${over ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"}`}>
          {over ? "+" : "−"}{fmtNumber(Math.abs(diffPct))}%
        </span>
      </div>
      <div className="mt-1.5 flex items-end justify-between">
        <div>
          <div className="font-display text-base font-bold text-slate-900">{fmtMoney(est.netTotal, country)}</div>
          <div className="text-[11px] text-slate-400">{fmtNumber(est.perM2Ngf)} €/m² NGF · KG300 {fmtNumber(est.kg300 / est.netTotal * 100)}%</div>
        </div>
        <div className="text-right text-[11px] text-slate-400">
          Budget<br /><span className="font-semibold text-slate-600">{fmtMoney(budget, country)}</span>
        </div>
      </div>
    </div>
  );
}

export default function Projects() {
  const { projects, elements, setActiveProjectId, navigate, settings, estimateForProject, country, addProject, addElements, removeProject, updateProject } = useApp();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "all">("all");
  const [showModal, setShowModal] = useState(false);
  // Confirmation en deux temps par carte (Évite tout window.confirm bloquant).
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDelete = (project: { id: string; name: string }) => {
    setConfirmDeleteId(null);
    // Best effort backend (miroir du pattern POST de création) ; le store
    // local reste la source de vérité des projets de ce navigateur.
    void secureFetch(`/api/v5/ifc/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" })
      .then((res) => {
        if (!res.ok && res.status !== 404) {
          console.warn(`[Projects] Suppression backend refusee (${res.status}) — projet retire en local.`);
        }
      })
      .catch((error) => console.warn("[Projects] Backend injoignable — suppression locale:", error));
    removeProject(project.id);
    toast.push({
      kind: "success",
      title: "Projekt gelöscht",
      detail: `„${project.name}“ wurde mit zugehörigen Bauteilen entfernt.`,
    });
  };

  const stats = useMemo(() => {
    const map: Record<string, { count: number; carbon: number; validated: number }> = {};
    for (const e of elements) {
      const m = (map[e.projectId] ??= { count: 0, carbon: 0, validated: 0 });
      m.count++;
      m.carbon += e.carbonKg;
      if (e.status !== "modeled") m.validated++;
    }
    return map;
  }, [elements]);

  // §162 — carbone A1–A3 (cohérent LCA/VE) + statut budget PAR PROJET : le
  // carbone devient un KPI de PORTEFEUILLE, pas seulement du projet actif.
  const carbonByProject = useMemo(
    () => projectCarbonSummaries(projects, elements),
    [projects, elements],
  );

  const filtered = projects.filter((p) => {
    const matchesQuery = (p.name + p.code + p.location + p.client).toLowerCase().includes(query.toLowerCase());
    const matchesStatus = status === "all" || p.status === status;
    return matchesQuery && matchesStatus;
  });

  const open = (id: string) => {
    setActiveProjectId(id);
    navigate("/app/elements");
  };

  // §152 — « Beispielprojekt » : crée le projet de démonstration en un clic,
  // idempotent (id déterministe). Idéal au premier contact (liste vide).
  // §157 — le projet embarque aussi une petite MAQUETTE réaliste (takeoff
  // démo) pour que TOUT le produit s'allume : LCA + ⚡ VE-Studio + Baustelle.
  const creerDemo = () => {
    if (projects.some((p) => p.id === DEMO_PROJECT_ID)) {
      toast.push({ kind: "info", title: "Beispielprojekt existiert bereits." });
      return;
    }
    addProject(makeDemoProject());
    addElements(makeDemoElements());
    toast.push({
      kind: "success",
      title: "Beispielprojekt angelegt",
      detail: "Kostenschätzung, LCA, ⚡ VE-Studio und Baustelle sind jetzt mit Beispieldaten gefüllt.",
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projekte"
        subtitle={`${filtered.length} Projekt(e) · ${formatMoney(projects.reduce((s, p) => s + p.budget, 0), settings.currency, true)} Baukosten`}
        actions={
          <div className="flex gap-2">
            <Button icon="download" variant="outline" size="sm" onClick={() => downloadBackup()}>Export Backup (.NARCHI)</Button>
            {projects.length === 0 && (
              <Button icon="spark" variant="outline" size="sm" onClick={creerDemo}>Beispielprojekt (Demo)</Button>
            )}
            <Button icon="building" variant="primary" size="sm" onClick={() => setShowModal(true)}>Neues Projekt</Button>
          </div>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={query} onChange={setQuery} placeholder="Projekt oder Kunde suchen…" className="sm:w-80" />
        <SegmentedControl options={STATUSES} value={status} onChange={setStatus} />
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((p) => {
          const meta = projectStatusMeta(p.status);
          const s = stats[p.id] ?? { count: 0, carbon: 0, validated: 0 };
          const c = carbonByProject[p.id];
          const validatedPct = s.count ? Math.round((s.validated / s.count) * 100) : 0;
          const budgetUsed = p.budget > 0 ? Math.round((p.spent / p.budget) * 100) : 0;
          return (
            <Card key={p.id} className="group overflow-hidden transition-shadow hover:shadow-lg hover:shadow-slate-200/60">
              <div className="h-1.5 w-full" style={{ background: p.accent }} />
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-400">{p.code}</span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </div>
                    <h3 className="mt-1 truncate font-display text-lg font-semibold text-slate-900">{p.name}</h3>
                    <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-500"><Icon name="pin" size={14} /> {p.location}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {confirmDeleteId === p.id ? (
                      <span className="flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 p-1">
                        <button
                          type="button"
                          onClick={() => handleDelete(p)}
                          className="rounded-lg bg-rose-500 px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-rose-600"
                        >
                          Wirklich löschen
                        </button>
                        <button
                          type="button"
                          aria-label="Abbrechen"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-50"
                        >
                          ✕
                        </button>
                      </span>
                    ) : (
                      <>
                        <IconButton icon="x" label="Projekt löschen" className="text-rose-400 opacity-0 transition-opacity hover:text-rose-600 group-hover:opacity-100" onClick={() => setConfirmDeleteId(p.id)} />
                        <IconButton icon="arrowUpRight" label="Öffnen" className="opacity-0 transition-opacity group-hover:opacity-100" onClick={() => open(p.id)} />
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3 text-center">
                  <div>
                    <div className="font-display text-base font-bold text-slate-900">{p.floors}</div>
                    <div className="text-[11px] text-slate-400">Geschosse</div>
                  </div>
                  <div>
                    <div className="font-display text-base font-bold text-slate-900">{formatNumber(p.grossFloorArea)}</div>
                    <div className="text-[11px] text-slate-400">m² BGF</div>
                  </div>
                  <div>
                    <div className="font-display text-base font-bold text-slate-900">{formatNumber(s.count)}</div>
                    <div className="text-[11px] text-slate-400">Bauteile</div>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <div>
                    <div className="mb-1 flex justify-between text-xs"><span className="text-slate-500">Fortschritt</span><span className="font-semibold text-slate-700">{p.progress}%</span></div>
                    <ProgressBar value={p.progress} color={p.accent} />
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-xs"><span className="text-slate-500">Budget verbraucht</span><span className="font-semibold text-slate-700">{budgetUsed}% · {formatMoney(p.spent, settings.currency, true)}</span></div>
                    <ProgressBar value={budgetUsed} color={budgetUsed > 90 ? "#f43f5e" : "#22d3ee"} />
                  </div>
                </div>

                <DinEstimate projectId={p.id} estimateForProject={estimateForProject} budget={p.budget} country={country.currency} />

                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
                  <div className="flex -space-x-2">
                    {p.team.slice(0, 4).map((t) => <Avatar key={t} initials={t} />)}
                    {p.team.length > 4 && <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-[11px] font-bold text-slate-600 ring-2 ring-white">+{p.team.length - 4}</span>}
                  </div>
                  <div className="text-right">
                    {c ? (
                      <>
                        <div className={cn("flex items-center justify-end gap-1 text-xs font-semibold", c.overBudget ? "text-rose-600" : "text-emerald-600")}>
                          <Icon name="leaf" size={13} />
                          {formatCarbon(c.a1a3Kg)}
                          {c.overBudget && <span title="Über dem CO₂-Budget">↑</span>}
                        </div>
                        {c.verdict && (
                          <span className={cn("mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold", VERDICT_META[c.verdict.level].badge)}>
                            ⚑ {VERDICT_META[c.verdict.level].short}
                          </span>
                        )}
                      </>
                    ) : (
                      <div className="flex items-center justify-end gap-1 text-xs font-semibold text-emerald-600"><Icon name="leaf" size={13} /> {formatCarbon(s.carbon)}</div>
                    )}
                    <div className="text-[11px] text-slate-400">{c ? (c.overBudget ? "über CO₂-Budget" : `${formatNumber(c.usedPct ?? 0, 0)} % vom CO₂-Budget`) : `${validatedPct}% geprüft`}</div>
                  </div>
                </div>

                <AuftraggeberZeile project={p} onSave={(patch) => updateProject(p.id, patch)} />

                <Button className="mt-4 w-full" variant="secondary" size="sm" iconRight="arrowRight" onClick={() => open(p.id)}>
                  Bauteile öffnen
                </Button>
              </div>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center">
            <p className="text-sm font-semibold text-slate-700">Noch keine Projekte</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
              Legen Sie in einem Klick ein <b>Beispielprojekt</b> an, um den
              ganzen Fluss zu sehen — Kostenschätzung DIN 276, Honorare,
              Rechnung — oder importieren Sie Ihr erstes IFC-Modell.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button icon="spark" variant="primary" size="sm" onClick={creerDemo}>Beispielprojekt anlegen (Demo)</Button>
              <Button icon="building" variant="outline" size="sm" onClick={() => setShowModal(true)}>Eigenes Projekt</Button>
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-lg bg-white p-6 dark:bg-ink-900 shadow-2xl">
            <h3 className="font-display text-xl font-bold text-slate-900 dark:text-white">Neues Projekt</h3>
            <p className="mt-1 text-xs text-slate-500">Name, Ort und Auftraggeber kommen aus Ihrer Eingabe — nichts wird ergänzt.</p>
            
            <form onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget as any;
              const newP = {
                id: "prj-" + Math.random().toString(36).slice(2, 8),
                code: form.code.value || "PRJ-NEW",
                name: String(form.pname.value || "").trim() || "Projekt",
                type: form.ptype.value || "Residential",
                location: String(form.loc.value || "").trim(),
                client: String(form.client.value || "").trim(),
                clientStreet: String(form.cstreet?.value || "").trim(),
                clientZip: String(form.czip?.value || "").trim(),
                clientCity: String(form.ccity?.value || "").trim(),
                clientLeitweg: String(form.cleitweg?.value || "").trim(),
                status: "planning" as const,
                progress: 0,
                budget: Number(form.budget.value) || 0,
                spent: 0,
                grossFloorArea: Number(form.bgf.value) || 0,
                floors: Number(form.floors.value) || 1,
                startDate: new Date().toISOString().slice(0, 10),
                endDate: "",
                team: [],
                classificationCode: "DIN-276",
                carbonBudgetKg: 0,
                health: 100,
                riskScore: 10,
                accent: "#3b82f6"
              };
              
              try {
                 // AXE 2 : creation projet via secureFetch (interception 401).
                 await secureFetch("/api/v5/ifc/projects", {
                   method: "POST",
                   headers: { "Content-Type": "application/json" },
                   body: JSON.stringify(newP)
                 });
              } catch (e) {
                 console.warn("[Projects] Backend injoignable — projet conserve en local:", e);
              }

              addProject(newP);
              setShowModal(false);
            }} className="mt-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Projektcode</label>
                  <input name="code" placeholder="z. B. PRJ-2026-01" required className="mt-1 h-10 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-ink-800 px-3 text-sm dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Projektname</label>
                  <input name="pname" placeholder="z. B. Anbau Familie Meyer" required className="mt-1 h-10 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-ink-800 px-3 text-sm dark:text-white" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Typologie</label>
                  <select name="ptype" className="mt-1 h-10 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-ink-800 px-3 text-sm dark:text-white">
                    <option value="Residential">Wohnen (MFH)</option>
                    <option value="Office">Büro</option>
                    <option value="Civic">Öffentlich</option>
                    <option value="Commercial">Handel</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Ort</label>
                  <input name="loc" placeholder="z. B. Hannover" required className="mt-1 h-10 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-ink-800 px-3 text-sm dark:text-white" />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Auftraggeber</label>
                <input name="client" placeholder="z. B. Familie Meyer" required className="mt-1 h-10 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-ink-800 px-3 text-sm dark:text-white" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Straße (optional)</label>
                  <input name="cstreet" placeholder="Musterstraße 1" className="mt-1 h-10 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-ink-800 px-3 text-sm dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">PLZ</label>
                  <input name="czip" placeholder="30159" className="mt-1 h-10 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-ink-800 px-3 text-sm dark:text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Ort Auftraggeber</label>
                  <input name="ccity" placeholder="wenn anders als Projektort" className="mt-1 h-10 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-ink-800 px-3 text-sm dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Leitweg-ID</label>
                  <input name="cleitweg" placeholder="nur öffentliche Auftraggeber" className="mt-1 h-10 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-ink-800 px-3 text-sm dark:text-white" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Budget (€, optional)</label>
                  <input name="budget" type="number" placeholder="0" className="mt-1 h-10 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-ink-800 px-3 text-sm dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">BGF (m²)</label>
                  <input name="bgf" type="number" placeholder="0" className="mt-1 h-10 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-ink-800 px-3 text-sm dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Geschosse</label>
                  <input name="floors" type="number" placeholder="1" className="mt-1 h-10 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-ink-800 px-3 text-sm dark:text-white" />
                </div>
              </div>

              <div className="mt-8 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-4">
                <Button variant="ghost" type="button" onClick={() => setShowModal(false)}>Abbrechen</Button>
                <Button variant="primary" type="submit" icon="check">Anlegen</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}


function AuftraggeberZeile({
  project,
  onSave,
}: {
  project: Project;
  onSave: (patch: Partial<Project>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [street, setStreet] = useState(project.clientStreet ?? "");
  const [zip, setZip] = useState(project.clientZip ?? "");
  const [city, setCity] = useState(project.clientCity ?? "");
  const [leitweg, setLeitweg] = useState(project.clientLeitweg ?? "");

  const resume = [project.client, project.clientStreet, [project.clientZip, project.clientCity].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Auftraggeber (Rechnung)</span>
        <span className="text-[11px] text-brand-600">{open ? "schließen" : "bearbeiten"}</span>
      </button>
      <p className="mt-1 truncate text-xs text-slate-600">{resume || "Noch keine Anschrift — für XRechnung Straße/PLZ eintragen."}</p>
      {open && (
        <div className="mt-3 space-y-2">
          <input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Straße" className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" />
          <div className="grid grid-cols-3 gap-2">
            <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="PLZ" className="h-9 rounded-lg border border-slate-200 px-2 text-sm" />
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ort" className="col-span-2 h-9 rounded-lg border border-slate-200 px-2 text-sm" />
          </div>
          <input value={leitweg} onChange={(e) => setLeitweg(e.target.value)} placeholder="Leitweg-ID (optional)" className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" />
          <Button
            size="sm"
            className="w-full"
            onClick={() => {
              onSave({
                clientStreet: street.trim(),
                clientZip: zip.trim(),
                clientCity: city.trim(),
                clientLeitweg: leitweg.trim(),
              });
              setOpen(false);
            }}
          >
            Anschrift speichern
          </Button>
        </div>
      )}
    </div>
  );
}
