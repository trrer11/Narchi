import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { BuildingElement, LevelInfo, Material } from "@/data/types";
import { useApp } from "@/store/AppStore";
import { ELEMENTS, MATERIALS, PROJECTS } from "@/data/seed";
import { NMC_TREE } from "@/data/classification";
import { Button, Icon, Badge, ProgressBar } from "@/components/ui";
import { LogoMark } from "@/components/Logo";
import { Reveal, useCountUp } from "@/components/Reveal";
import { IsometricBuilding } from "@/components/IsometricBuilding";
import { BarChart, Sparkline } from "@/components/charts";
import { formatCarbon, formatMoney } from "@/lib/format";
import { cn } from "@/utils/cn";

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

const NAV = [
  { id: "import", label: "Modell-Import" },
  { id: "features", label: "Plattform" },
  { id: "cost", label: "DIN 276 Kosten" },
  { id: "data", label: "Daten" },
  { id: "twin", label: "3D-Zwilling" },
  { id: "sync", label: "Synchronisierung" },
  { id: "pricing", label: "Preise" },
  { id: "faq", label: "FAQ" },
];

export default function Landing() {
  const { navigate } = useApp();
  const [open, setOpen] = useState(false);
  const sample = ELEMENTS[120] ?? ELEMENTS[0];
  const sampleMaterial = MATERIALS.find((m) => m.id === sample.materialId) ?? MATERIALS[0];

  const goApp = () => navigate("/app");

  return (
    <div className="min-h-screen bg-white">
      {/* ============================ NAV ============================ */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
          <button onClick={() => scrollTo("top")} className="flex items-center gap-2.5">
            <LogoMark size={32} />
            <span className="font-display text-xl font-bold tracking-tight text-slate-900">Narchi</span>
          </button>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <button key={n.id} onClick={() => scrollTo(n.id)} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900">
                {n.label}
              </button>
            ))}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            <Button variant="ghost" size="sm" onClick={goApp}>Anmelden</Button>
            <Button size="sm" iconRight="arrowRight" onClick={goApp}>Plattform starten</Button>
          </div>
          <button className="rounded-lg p-2 text-slate-700 md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            <Icon name={open ? "x" : "menu"} size={22} />
          </button>
        </div>
        {open && (
          <div className="border-t border-slate-100 bg-white px-5 py-3 md:hidden">
            {NAV.map((n) => (
              <button key={n.id} onClick={() => { scrollTo(n.id); setOpen(false); }} className="block w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-100">
                {n.label}
              </button>
            ))}
            <Button className="mt-2 w-full" onClick={goApp}>Plattform starten</Button>
          </div>
        )}
      </header>

      {/* ============================ HERO ============================ */}
      <section id="top" className="relative overflow-hidden bg-ink-950 pt-16">
        <div className="absolute inset-0 bp-grid-animated radial-fade opacity-70" />
        <div className="pointer-events-none absolute -left-40 top-10 h-96 w-96 rounded-full bg-brand-500/25 blur-[120px]" />
        <div className="pointer-events-none absolute -right-32 top-40 h-96 w-96 rounded-full bg-cyan-500/20 blur-[120px]" />
        <div className="pointer-events-none absolute bottom-0 left-1/2 h-72 w-[40rem] -translate-x-1/2 rounded-full bg-violet-500/10 blur-[120px]" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 py-20 lg:grid-cols-[1.05fr_1fr] lg:py-28">
          <div className="animate-fade-up">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-cyan-200 backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
              </span>
              Self-Host für deutsche Architekturbüros · IFC → DIN 276
            </div>
            <h1 className="mt-6 font-display text-5xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl">
              Konstruktionsdaten,
              <span className="block text-gradient">endlich gemeistert.</span>
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-slate-300">
              Vom IFC-Modell zur Kostenschätzung nach DIN 276, Honorar nach HOAI 2021
              und E-Rechnung (XRechnung) — im Browser, auf Ihrem eigenen Rechner. Kein Cloud-Zwang.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" icon="cube" iconRight="arrowRight" onClick={goApp}>Modell importieren</Button>
              <Button size="lg" variant="secondary" className="bg-white/10 text-white ring-white/20 hover:bg-white/15" icon="box" onClick={() => scrollTo("twin")}>
                Digitalen Zwilling ansehen
              </Button>
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-slate-400">
              {["IFC im Browser", "DIN 276 mit Herkunft", "XRechnung KoSIT"].map((t) => (
                <span key={t} className="flex items-center gap-2"><Icon name="check" size={16} className="text-emerald-400" /> {t}</span>
              ))}
            </div>
          </div>

          {/* Hero digital twin */}
          <div className="relative animate-fade-up [animation-delay:120ms]">
            <HeroTwin />
          </div>
        </div>

        {/* sector marquee */}
        <div className="relative border-t border-white/10 bg-ink-900/40">
          <div className="mx-auto max-w-7xl overflow-hidden px-5 py-5">
            <div className="flex w-max animate-marquee-slow gap-12 text-sm font-medium text-slate-500">
              {[...SECTORS, ...SECTORS].map((s, i) => (
                <span key={i} className="flex items-center gap-2 whitespace-nowrap"><span className="h-1.5 w-1.5 rounded-full bg-brand-500/60" />{s}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ============================ STATS ============================ */}
      <section className="border-b border-slate-100 bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px overflow-hidden lg:grid-cols-4">
          {[
            { end: 276, suffix: "", l: "Kostengruppen nach DIN 276", dec: 0 },
            { end: 8, suffix: "", l: "HOAI-Leistungsphasen", dec: 0 },
            { end: 2024, suffix: "", l: "GEG-Energiebilanz", dec: 0 },
            { end: 3.0, suffix: "", l: "XRechnung-Profil (KoSIT)", dec: 1 },
          ].map((s) => (
            <div key={s.l} className="bg-white px-6 py-9 text-center">
              <div className="font-display text-4xl font-bold text-slate-900">
                <CountUp end={s.end} decimals={s.dec} />{s.suffix}
              </div>
              <div className="mt-1 text-sm text-slate-500">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ============================ TRUST STRIP ============================ */}
      <section className="border-y border-slate-100 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-5 py-6 text-sm text-slate-600">
          {[
            { icon: "shield" as const, t: "Self-Host — Daten bleiben auf Ihrer Infrastruktur" },
            { icon: "lock" as const, t: "DSGVO-freundlich · kein Pflicht-Cloud · kein Tracking" },
            { icon: "download" as const, t: "Vollständiger Export & Backup jederzeit" },
          ].map((b) => (
            <span key={b.t} className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><Icon name={b.icon} size={15} /></span>
              {b.t}
            </span>
          ))}
        </div>
      </section>

      {/* ============================ MODEL IMPORT (HERO FEATURE) ============================ */}
      <section id="import" className="mx-auto max-w-7xl px-5 py-24">
        <Reveal>
          <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-8 sm:p-12">
            <div className="grid items-center gap-10 lg:grid-cols-2">
              <div>
                <Badge tone="amber" dot>Die Kernfunktion</Badge>
                <h2 className="mt-4 font-display text-4xl font-bold tracking-tight text-slate-900">
                  Modell ablegen.<br /><span className="text-gradient">Schätzung erhalten.</span>
                </h2>
                <p className="mt-4 text-pretty text-lg text-slate-600">
                  Datei <strong>IFC / IFCZIP / IFCXML / STEP</strong> hochladen (DXF über ezdxf).
                  <strong>DWG und RVT werden abgelehnt</strong> — der Browser kann sie nicht ehrlich lesen.
                  NARCHI misst Mengen und liefert eine <strong>Kostenschätzung nach DIN 276</strong> mit Herkunft (Messung / Richtwert / Regel).
                </p>
                <ul className="mt-6 space-y-3">
                  {[
                    "IFC-BaseQuantities im Browser — kein Plugin",
                    "Zuordnung: Wand → KG 320, Decke → KG 330, Fenster → KG 340…",
                    "Kein Blind-Import: Zuordnung kontrolliert, kein erfundener Preis",
                    "CO₂ A1–A3 und VE-Studio auf den echten Mengen des Takeoffs",
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-3 text-sm text-slate-700">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500 text-ink-950"><Icon name="check" size={14} /></span>
                      {t}
                    </li>
                  ))}
                </ul>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Button size="lg" iconRight="arrowRight" onClick={goApp}>Modell importieren</Button>
                  <Button size="lg" variant="secondary" icon="spark" onClick={goApp}>Demo-Modell testen</Button>
                </div>
              </div>
              <div className="relative">
                <ImportPreview goApp={goApp} />
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ============================ FEATURES ============================ */}
      <section id="features" className="mx-auto max-w-7xl px-5 py-24">
        <Reveal><SectionHead eyebrow="Plattform" title="Ein Arbeitsplatz für das deutsche Büro" subtitle="Sechs Bausteine, die schon existieren — kein Marketing-Theater." /></Reveal>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 70}>
              <div className="group relative h-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 lift hover:shadow-xl hover:shadow-slate-200/60">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 transition-colors group-hover:bg-brand-500 group-hover:text-ink-950">
                  <Icon name={f.icon} size={22} />
                </div>
                <h3 className="mt-5 font-display text-lg font-semibold text-slate-900">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{f.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ===================== TWIN SHOWCASE ===================== */}
      <section id="twin" className="relative overflow-hidden border-y border-slate-100 bg-ink-950">
        <div className="absolute inset-0 bp-grid radial-fade opacity-60" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 py-24 lg:grid-cols-2">
          <div>
            <span className="text-sm font-semibold uppercase tracking-wider text-brand-400">Digitaler Zwilling</span>
            <h2 className="mt-3 font-display text-4xl font-bold text-white">Das Gebäude sehen,<br />nicht die Dateien</h2>
            <p className="mt-4 text-slate-300">
              Ebenen, Bauteile und Kennwerte in einer interaktiven isometrischen Ansicht.
              Fortschritt, inkarniertes CO₂, Kosten — ein Klick wechselt die Sicht.
            </p>
            <ul className="mt-7 space-y-3">
              {["Ebene anklicken und prüfen", "Einfärbung nach Fortschritt, CO₂ oder Kosten", "Heutiger Fortschritt sichtbar", "Direkt zu den Bauteilen der Ebene"].map((t) => (
                <li key={t} className="flex items-center gap-3 text-sm text-slate-200">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500/20 text-brand-300"><Icon name="check" size={14} /></span>
                  {t}
                </li>
              ))}
            </ul>
            <Button className="mt-8" iconRight="arrowRight" onClick={goApp}>Zwilling öffnen</Button>
          </div>
          <div className="relative">
            <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-tr from-brand-500/15 to-cyan-500/15 blur-2xl" />
            <div className="relative rounded-2xl border border-white/10 bg-ink-900/70 p-5 backdrop-blur">
              <TwinPreview />
            </div>
          </div>
        </div>
      </section>

      {/* ============================ DIN 276 COST ENGINE ============================ */}
      <section id="cost" className="mx-auto max-w-7xl px-5 py-24">
        <Reveal>
          <SectionHead
            eyebrow="DIN 276 · Kostenschätzung"
            title="Kosten nach deutscher Norm — mit Herkunft"
            subtitle="Kein Preis ohne Quelle. Messung aus dem Modell, Richtwert mit Jahr, Regel nur wenn normativ begründet. Baukostenindex Destatis, regionale Faktoren."
          />
        </Reveal>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <Reveal>
            <div className="rounded-2xl border border-slate-200 bg-white p-7">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="amber">🇩🇪 DIN 276-1:2008-12</Badge>
                <Badge tone="slate">DIN 277</Badge>
                <Badge tone="emerald" dot>Preisstand wählbar</Badge>
              <Badge tone="amber" dot>IFC · IFCZIP · STEP · DXF</Badge>
              </div>
              <h3 className="mt-4 font-display text-xl font-bold text-slate-900">Kostengliederung vollständig</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Jede Schätzung gliedert nach Kostengruppen KG 300 (Baukonstruktionen),
                KG 400 (Technische Anlagen), KG 500 (Außenanlagen) und KG 700 (Nebenkosten) —
                dreistellig, USt. 19 % und Flächen nach DIN 277 (NGF/BGF).
              </p>
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { k: "KG 300", v: "Baukonstruktionen", c: "#f59e0b" },
                  { k: "KG 400", v: "Technische Anlagen", c: "#22d3ee" },
                  { k: "KG 500", v: "Außenanlagen", c: "#34d399" },
                  { k: "KG 700", v: "Nebenkosten", c: "#a78bfa" },
                ].map((g) => (
                  <div key={g.k} className="rounded-xl border border-slate-100 p-3">
                    <span className="flex h-2 w-8 rounded-full" style={{ background: g.c }} />
                    <div className="mt-2 font-mono text-xs font-bold text-slate-700">{g.k}</div>
                    <div className="text-[11px] text-slate-400">{g.v}</div>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap gap-3 text-xs text-slate-500">
                {["Regionale Faktoren (Bundesländer)", "Ausstattungsstandard", "Baukostenindex Destatis", "USt. 19 % · DIN 277 NGF/BGF"].map((t) => (
                  <span key={t} className="flex items-center gap-1.5"><Icon name="check" size={14} className="text-emerald-500" /> {t}</span>
                ))}
              </div>
              <Button className="mt-6" iconRight="arrowRight" onClick={goApp}>DIN-276-Rechner</Button>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <CostPreview goApp={goApp} />
          </Reveal>
        </div>
      </section>

      {/* ============================ DATA STRUCTURES ============================ */}
      <section id="data" className="relative overflow-hidden border-b border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-7xl px-5 py-24">
          <Reveal><SectionHead eyebrow="Datenmodell" title="Jedes Bauteil typisiert" subtitle="Klassifikation, Menge, Stoff, Kosten und CO₂ — keine Zahl ohne Feld." /></Reveal>
          <div className="mt-14 grid gap-6 lg:grid-cols-2">
            <Reveal>
              <div className="overflow-hidden rounded-2xl border border-slate-800 bg-ink-950 shadow-xl">
                <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-300"><Icon name="cube" size={16} className="text-brand-400" /> BuildingElement</div>
                  <Badge tone="emerald" dot>typisiert</Badge>
                </div>
                <pre className="scroll-thin overflow-x-auto px-5 py-4 text-[12.5px] font-mono leading-relaxed text-slate-300">
                  <ElementJson el={sample} mat={sampleMaterial} />
                </pre>
              </div>
            </Reveal>
            <Reveal delay={120}>
              <div className="grid gap-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-6">
                  <div className="mb-4 flex items-center gap-2"><Icon name="branch" size={18} className="text-brand-500" /><h3 className="font-display font-semibold text-slate-900">Klassifikation NARCHI (NMC)</h3></div>
                  <ul className="space-y-2.5">
                    {NMC_TREE.map((g) => (
                      <li key={g.code} className="flex items-center gap-3 text-sm">
                        <span className="w-20 shrink-0 rounded-md bg-slate-100 px-2 py-1 text-center font-mono text-[11px] font-semibold text-slate-600">{g.code}</span>
                        <span className="font-medium text-slate-700">{g.label}</span>
                        <span className="ml-auto text-xs text-slate-400">{g.children?.length ?? 0} Unterklassen</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-6">
                  <div className="mb-4 flex items-center gap-2"><Icon name="leaf" size={18} className="text-emerald-500" /><h3 className="font-display font-semibold text-slate-900">Stoff & Fußabdruck</h3></div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-slate-800">{sampleMaterial.name}</p>
                      <p className="text-sm text-slate-500">{sampleMaterial.category} · {sampleMaterial.fireRating}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-lg font-bold text-emerald-600">{formatCarbon(sample.carbonKg)}</p>
                      <p className="text-xs text-slate-400">CO₂ inkarniert</p>
                    </div>
                  </div>
                  <div className="mt-4"><div className="mb-1 flex justify-between text-xs text-slate-500"><span>Recyclinganteil</span><span>{sampleMaterial.recycledContent}%</span></div><ProgressBar value={sampleMaterial.recycledContent} color="#34d399" /></div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ============================ COMPLIANCE COCKPIT (DE) ============================ */}
      <section className="relative overflow-hidden bg-ink-950">
        <div className="absolute inset-0 bp-grid radial-fade opacity-50" />
        <div className="pointer-events-none absolute right-0 top-0 h-80 w-80 rounded-full bg-emerald-500/15 blur-[120px]" />
        <div className="relative mx-auto max-w-7xl px-5 py-24">
          <Reveal>
            <div className="max-w-2xl">
              <span className="text-sm font-semibold uppercase tracking-wider text-brand-400">Unentbehrlich für deutsche Architekten</span>
              <h2 className="mt-3 font-display text-4xl font-bold text-white">Drei Normen. Ein Modell. Eine Antwort.</h2>
              <p className="mt-4 text-slate-300">
                Ein Cockpit für <strong className="text-white">GEG 2024 (Energie)</strong>,
                <strong className="text-white"> DIN 276 (Kosten)</strong> und <strong className="text-white">HOAI 2021 (Honorar)</strong>
                {" "}am selben Modell — mit echter Bauphysik, ohne Blackbox.
              </p>
            </div>
          </Reveal>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {[
              { code: "GEG 2024", title: "Energiebilanz", icon: "bolt" as const, color: "#22d3ee", points: ["Heizwärmebedarf (DIN V 18599)", "Primärenergie & CO₂", "Konformität GEG / KfW 40 / 55"], val: "≤ 55 kWh/(m²a)" },
              { code: "DIN 276", title: "Baukosten", icon: "gauge" as const, color: "#f59e0b", points: ["Kostengruppen KG 300–700", "Regionale Faktoren (Bundesländer)", "Marktreferenzen & Baukostenindex"], val: "€/m² NGF" },
              { code: "HOAI 2021", title: "Architektenhonorar", icon: "scale" as const, color: "#a78bfa", points: ["Leistungsbild Gebäude & Innenräume", "Honorarzonen I–V", "8 Leistungsphasen, Zuschläge"], val: "netto + MwSt." },
            ].map((m, i) => (
              <Reveal key={m.code} delay={i * 90}>
                <div className="group h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:bg-white/[0.06]">
                  <div className="flex items-center justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: m.color + "22", color: m.color }}><Icon name={m.icon} size={22} /></span>
                    <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-slate-300">{m.code}</span>
                  </div>
                  <h3 className="mt-4 font-display text-lg font-bold text-white">{m.title}</h3>
                  <ul className="mt-3 space-y-2">
                    {m.points.map((p) => <li key={p} className="flex items-start gap-2 text-sm text-slate-300"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-emerald-400" /> {p}</li>)}
                  </ul>
                  <div className="mt-4 border-t border-white/10 pt-3 text-xs text-slate-400">Kennwert: <span className="font-semibold text-white">{m.val}</span></div>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={120}>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-gradient-to-r from-emerald-500/10 to-transparent p-5">
              <p className="flex items-center gap-2 text-sm text-slate-200">
                <Icon name="spark" size={18} className="text-emerald-400" />
                Wärmepumpe gegen Gaskessel tauschen — NARCHI zeigt den GEG-Effekt sofort.
              </p>
              <Button iconRight="arrowRight" onClick={goApp}>Cockpit öffnen</Button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============================ SYNC FLOW ============================ */}
      <section id="sync" className="mx-auto max-w-7xl px-5 py-24">
        <Reveal><SectionHead eyebrow="Synchronisation" title="Vom Rohmodell zum belastbaren Stand" subtitle="Vier Schritte, die im Büro wirklich laufen — nicht sieben Marketing-Stufen." /></Reveal>
        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {SYNC_STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 80}>
              <div className="relative h-full rounded-2xl border border-slate-200 bg-white p-6">
                <span className="font-display text-5xl font-bold text-slate-100">0{i + 1}</span>
                <div className="-mt-6 flex h-11 w-11 items-center justify-center rounded-xl bg-ink-900 text-brand-400"><Icon name={s.icon} size={20} /></div>
                <h3 className="mt-4 font-display font-semibold text-slate-900">{s.title}</h3>
                <p className="mt-2 text-sm text-slate-500">{s.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <div className="mt-8 flex justify-center"><Button variant="dark" icon="refresh" onClick={goApp}>Plattform öffnen</Button></div>
      </section>

      {/* ============================ OUTCOMES ============================ */}
      <section className="relative overflow-hidden bg-ink-950">
        <div className="absolute inset-0 bp-grid-fine opacity-60" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 py-24 lg:grid-cols-2">
          <Reveal>
            <span className="text-sm font-semibold uppercase tracking-wider text-brand-400">Was schon läuft</span>
            <h2 className="mt-3 font-display text-4xl font-bold text-white">Schneller entscheiden, Daten behalten</h2>
            <p className="mt-4 text-slate-300">Kein erfundenes Dashboard. Die Zahlen unten sind Produktfähigkeiten, keine Kundenstatistik.</p>
            <div className="mt-8 space-y-5">
              {[
                { label: "Mengen aus dem IFC statt Excel-Tipperei", from: "Tage", to: "Minuten", pct: 85 },
                { label: "Kosten + CO₂ am selben Takeoff", from: "Getrennt", to: "Ein Modell", pct: 100 },
                { label: "E-Rechnung KoSIT XRechnung 3.0", from: "Excel", to: "ACCEPTABLE", pct: 100 },
              ].map((o) => (
                <div key={o.label}>
                  <div className="mb-1.5 flex items-center justify-between text-sm"><span className="text-slate-300">{o.label}</span><span className="font-semibold text-white">{o.from} → <span className="text-brand-300">{o.to}</span></span></div>
                  <ProgressBar value={o.pct} color="#fbbf24" trackClass="bg-white/10" />
                </div>
              ))}
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
              <div className="mb-4 flex items-center justify-between"><span className="text-sm font-medium text-slate-300">Beispiel-Portfolio (Seed, keine Kundenmessung)</span><Badge tone="emerald" dot>Demo</Badge></div>
              <BarChart height={200} color="#22d3ee" data={[{ label: "S1", value: 142 }, { label: "S2", value: 188 }, { label: "S3", value: 221 }, { label: "S4", value: 276 }, { label: "S5", value: 318 }, { label: "S6", value: 392 }]} format={(n) => `${n}k`} />
              <div className="mt-5 grid grid-cols-3 gap-4 border-t border-white/10 pt-5">
                {[{ v: formatMoney(187_000_000), l: "Beispiel-Budget" }, { v: formatCarbon(14_500_000), l: "Beispiel-CO₂" }, { v: "Seed", l: "keine Live-Statistik" }].map((s) => (
                  <div key={s.l}><div className="font-display text-xl font-bold text-white">{s.v}</div><div className="text-xs text-slate-400">{s.l}</div></div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============================ TESTIMONIALS ============================ */}
      <section className="mx-auto max-w-7xl px-5 py-24">
        <Reveal><SectionHead eyebrow="Büroalltag" title="Was NARCHI konkret ersetzt" subtitle="Keine erfundenen Kundenstimmen. Drei echte Arbeitsschritte." /></Reveal>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {TESTIMONIALS.map((t, i) => (
            <Reveal key={t.name} delay={i * 90}>
              <figure className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6">
                <div className="mb-4 flex gap-0.5 text-brand-400">{Array.from({ length: 5 }).map((_, j) => (<Icon key={j} name="spark" size={16} />))}</div>
                <blockquote className="flex-1 text-[15px] leading-relaxed text-slate-700">“{t.quote}”</blockquote>
                <figcaption className="mt-5 flex items-center gap-3 border-t border-slate-100 pt-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ink-900 text-sm font-bold text-brand-400">{t.initials}</span>
                  <div><div className="text-sm font-semibold text-slate-900">{t.name}</div><div className="text-xs text-slate-500">{t.role}</div></div>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ============================ PRICING ============================ */}
      <section id="pricing" className="border-y border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-7xl px-5 py-24">
          <Reveal><SectionHead eyebrow="Preise" title="Ehrlich, nicht 19 €/Monat" subtitle="Beta gegen schriftliches Feedback kostenlos. Danach Bürolizenz — kein Enterprise-Nebel." /></Reveal>
          <div className="mt-14 grid gap-6 lg:grid-cols-3">
            {PRICING.map((p, i) => (
              <Reveal key={p.name} delay={i * 90}>
                <div className={`relative flex h-full flex-col rounded-2xl border bg-white p-7 ${p.featured ? "border-brand-300 shadow-xl shadow-brand-100 ring-1 ring-brand-200" : "border-slate-200"}`}>
                  {p.featured && <span className="absolute -top-3 left-7 rounded-full bg-brand-500 px-3 py-1 text-xs font-bold text-ink-950">Empfohlen</span>}
                  <h3 className="font-display text-lg font-semibold text-slate-900">{p.name}</h3>
                  <p className="mt-1 text-sm text-slate-500">{p.for}</p>
                  <div className="mt-5 flex items-baseline gap-1"><span className="font-display text-4xl font-bold text-slate-900">{p.price}</span>{p.period && <span className="text-sm text-slate-400">/{p.period}</span>}</div>
                  <ul className="mt-6 flex-1 space-y-3">
                    {p.features.map((f) => (<li key={f} className="flex items-start gap-2.5 text-sm text-slate-600"><Icon name="check" size={16} className="mt-0.5 shrink-0 text-emerald-500" /> {f}</li>))}
                  </ul>
                  <Button className="mt-7 w-full" variant={p.featured ? "primary" : "secondary"} iconRight="arrowRight" onClick={goApp}>{p.cta}</Button>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ FAQ ============================ */}
      <section id="faq" className="mx-auto max-w-3xl px-5 py-24">
        <Reveal><SectionHead eyebrow="FAQ" title="Häufige Fragen" /></Reveal>
        <div className="mt-12 space-y-3">{FAQ.map((f, i) => <Reveal key={i} delay={i * 50}><FaqItem {...f} /></Reveal>)}</div>
      </section>

      {/* ============================ CTA ============================ */}
      <section className="relative overflow-hidden bg-ink-950">
        <div className="absolute inset-0 bp-grid-animated radial-fade opacity-70" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500/25 blur-[130px]" />
        <div className="relative mx-auto max-w-3xl px-5 py-24 text-center">
          <h2 className="font-display text-4xl font-bold text-white sm:text-5xl">IFC ablegen. Schätzung erhalten.</h2>
          <p className="mx-auto mt-4 max-w-xl text-slate-300">Self-Host unter Windows + Docker. Browser: Edge auf http://localhost:8080.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" iconRight="rocket" onClick={goApp}>Plattform starten</Button>
            <Button size="lg" variant="secondary" className="bg-white/10 text-white ring-white/20 hover:bg-white/15" onClick={() => scrollTo("pricing")}>Preise ansehen</Button>
          </div>
          <p className="mt-6 text-xs text-slate-500">Tipp: in der Plattform <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono">Strg+K</kbd> öffnet die Befehlspalette.</p>
        </div>
      </section>

      {/* ============================ FOOTER ============================ */}
      <footer className="border-t border-slate-800 bg-ink-950 text-slate-400">
        <div className="mx-auto max-w-7xl px-5 py-14">
          <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
            <div>
              <div className="flex items-center gap-2.5"><LogoMark size={30} /><span className="font-display text-lg font-bold text-white">Narchi</span></div>
              <p className="mt-4 max-w-xs text-sm leading-relaxed">Gebaut für deutsche Architekturbüros. Self-Host. DIN 276, HOAI, GEG, XRechnung.</p>
            </div>
            {FOOTER.map((col) => (
              <div key={col.title}>
                <h4 className="text-sm font-semibold text-white">{col.title}</h4>
                <ul className="mt-4 space-y-2.5 text-sm">{col.links.map((l) => (<li key={l}><button className="transition-colors hover:text-white" onClick={() => scrollTo(l.toLowerCase().replace(/\s/g, "-"))}>{l}</button></li>))}</ul>
              </div>
            ))}
          </div>
          <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs sm:flex-row">
            <span>© {new Date().getFullYear()} NARCHI. Alle Rechte vorbehalten.</span>
            <div className="flex gap-5">
              <button type="button" className="hover:text-white" onClick={() => navigate("/impressum")}>Impressum</button>
              <button type="button" className="hover:text-white" onClick={() => navigate("/datenschutz")}>Datenschutz</button>
              <button type="button" className="hover:text-white" onClick={() => navigate("/agb")}>AGB (Entwurf)</button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* --------------------------- count up --------------------------- */
function CountUp({ end, decimals = 0, duration = 1600 }: { end: number; decimals?: number; duration?: number }) {
  const v = useCountUp(end, duration);
  return <>{v.toFixed(decimals)}</>;
}

/* --------------------------- sub components --------------------------- */
function SectionHead({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <span className="text-sm font-semibold uppercase tracking-wider text-brand-600">{eyebrow}</span>
      <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
      {subtitle && <p className="mt-4 text-pretty text-lg text-slate-500">{subtitle}</p>}
    </div>
  );
}

/* Hero twin — live isometric building built from real seed data */
function HeroTwin() {
  const levels = useMemo<LevelInfo[]>(() => {
    const proj = PROJECTS[0] ?? { id: "prj-master", grossFloorArea: 750 };
    const els = ELEMENTS.filter((e) => e.projectId === proj.id);
    const byLevel = new Map<string, BuildingElement[]>();
    for (const e of els) { const a = byLevel.get(e.level) ?? []; a.push(e); byLevel.set(e.level, a); }
    const names = ["Roof", "L-06", "L-05", "L-04", "L-03", "L-02", "L-01", "L-00", "B-01"];
    const types: LevelInfo["type"][] = ["mechanical", "typical", "typical", "typical", "typical", "typical", "typical", "ground", "basement"];
    return names.map((name, i) => {
      const le = byLevel.get(name) ?? [];
      return {
        index: 8 - i, name, elevation: i * 3.4, height: 3.4,
        grossArea: Math.round(proj.grossFloorArea / 9), elementCount: le.length,
        carbonKg: le.reduce((s, e) => s + e.carbonKg, 0), cost: le.reduce((s, e) => s + e.cost, 0),
        completion: Math.max(10, Math.min(100, proj.progress + ((i % 5) - 2) * 8)), type: types[i],
      };
    });
  }, []);
  return (
    <div className="relative">
      <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-tr from-brand-500/20 to-cyan-500/20 blur-2xl" />
      <div className="relative rounded-2xl border border-white/10 bg-ink-900/80 p-5 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-rose-400/80" /><span className="h-3 w-3 rounded-full bg-brand-400/80" /><span className="h-3 w-3 rounded-full bg-emerald-400/80" />
          </div>
          <span className="text-xs font-medium text-slate-400">narchi · digitaler Zwilling</span>
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>
        </div>
        <div className="grid grid-cols-3 gap-3 py-4">
          {[{ l: "Bauteile", v: "Demo", c: "text-white", s: [8, 12, 9, 14, 11, 16] }, { l: "Budget", v: "Seed", c: "text-brand-300", s: [10, 9, 13, 12, 15, 17] }, { l: "CO₂", v: "Seed", c: "text-cyan-300", s: [12, 11, 10, 13, 11, 12] }].map((s) => (
            <div key={s.l} className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-[11px] text-slate-400">{s.l}</div>
              <div className={`mt-1 font-display text-lg font-bold ${s.c}`}>{s.v}</div>
              <div className="mt-1"><Sparkline data={s.s} color={s.c.includes("brand") ? "#fbbf24" : s.c.includes("cyan") ? "#22d3ee" : "#34d399"} width={70} height={22} /></div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <IsometricBuilding levels={levels} metric="completion" height={220} />
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3">
          <Icon name="refresh" size={16} className="text-emerald-400" />
          <span className="text-xs text-emerald-200">Beispielansicht · keine Live-Messung</span>
        </div>
      </div>
      <div className="absolute -right-3 top-24 hidden animate-float rounded-xl border border-white/10 bg-ink-900/90 px-3 py-2 shadow-xl backdrop-blur sm:block">
        <div className="flex items-center gap-2 text-xs text-slate-300"><Icon name="leaf" size={14} className="text-emerald-400" /> −18 % CO₂</div>
      </div>
      <div className="absolute -left-4 bottom-16 hidden animate-float-slow rounded-xl border border-white/10 bg-ink-900/90 px-3 py-2 shadow-xl backdrop-blur sm:block">
        <div className="flex items-center gap-2 text-xs text-slate-300"><Icon name="shield" size={14} className="text-cyan-400" /> Self-Host</div>
      </div>
    </div>
  );
}

/* Twin preview on the showcase section */
function TwinPreview() {
  const levels = useMemo<LevelInfo[]>(() => {
    const proj = PROJECTS[1] ?? PROJECTS[0] ?? { id: "prj-master", grossFloorArea: 750 };
    const els = ELEMENTS.filter((e) => e.projectId === proj.id);
    const byLevel = new Map<string, BuildingElement[]>();
    for (const e of els) { const a = byLevel.get(e.level) ?? []; a.push(e); byLevel.set(e.level, a); }
    const names = ["Roof", "L-05", "L-04", "L-03", "L-02", "L-01", "L-00"];
    const types: LevelInfo["type"][] = ["mechanical", "typical", "typical", "typical", "typical", "typical", "ground"];
    return names.map((name, i) => {
      const le = byLevel.get(name) ?? [];
      return {
        index: 6 - i, name, elevation: i * 3.4, height: 3.4,
        grossArea: Math.round(proj.grossFloorArea / 7), elementCount: le.length,
        carbonKg: le.reduce((s, e) => s + e.carbonKg, 0), cost: le.reduce((s, e) => s + e.cost, 0),
        completion: Math.max(8, Math.min(100, proj.progress + ((i % 5) - 2) * 9)), type: types[i],
      };
    });
  }, []);
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full items-center justify-between px-1">
        <span className="text-xs font-medium text-slate-300">Meridian Civic Hub</span>
        <Badge tone="cyan" dot>live</Badge>
      </div>
      <div className="w-full"><IsometricBuilding levels={levels} metric="carbon" height={300} /></div>
    </div>
  );
}

/* Live DIN 276 cost preview — runs the real engine on a sample typology */
function CostPreview({ goApp }: { goApp: () => void }) {
  const { typologies } = useAppTypes();
  const [typeId, setTypeId] = useState("office");
  const [ngf, setNgf] = useState(5200);
  const { result } = useEstimate(typeId, ngf);
  const cur = "EUR";
  const groups = [
    { code: "KG 300", label: "Baukonstruktionen", value: result.kg300, color: "#f59e0b" },
    { code: "KG 400", label: "Technische Anlagen", value: result.kg400, color: "#22d3ee" },
    { code: "KG 500", label: "Außenanlagen", value: result.kg500, color: "#34d399" },
    { code: "KG 700", label: "Nebenkosten", value: result.kg700, color: "#a78bfa" },
  ];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-ink-950 p-6 text-white shadow-xl">
      <div className="absolute inset-0 bp-grid radial-fade-center opacity-40" />
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400">🇩🇪 Live-Kostenschätzung · Deutschland</span>
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-medium text-slate-400">Bauaufgabe</label>
            <select
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-white/15 bg-white/5 px-2 text-sm text-white focus:border-brand-400 focus:outline-none"
            >
              {typologies.map((t) => <option key={t.id} value={t.id} className="bg-ink-900">{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-slate-400">NGF (m²)</label>
            <input
              type="number"
              value={ngf}
              onChange={(e) => setNgf(Math.max(1, Number(e.target.value) || 0))}
              className="mt-1 h-10 w-full rounded-lg border border-white/15 bg-white/5 px-3 text-sm font-semibold text-white focus:border-brand-400 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[11px] text-slate-400">Baukosten (netto)</div>
              <div className="font-display text-3xl font-bold text-brand-300">{fmtEUR(result.netTotal, cur)}</div>
            </div>
            <div className="text-right">
              <div className="font-display text-xl font-bold text-white">{fmtEUR(result.perM2Ngf)}</div>
              <div className="text-[11px] text-slate-400">€/m² NGF</div>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {groups.map((g) => (
              <div key={g.code}>
                <div className="mb-1 flex justify-between text-[11px] text-slate-300">
                  <span><span className="font-mono text-slate-400">{g.code}</span> {g.label}</span>
                  <span className="font-semibold">{fmtEUR(g.value, cur)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full" style={{ width: `${(g.value / result.netTotal) * 100}%`, background: g.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <button onClick={goApp} className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg bg-brand-500 py-2 text-sm font-semibold text-ink-950 transition-colors hover:bg-brand-400">
          Vollständige Schätzung <Icon name="arrowRight" size={14} />
        </button>
      </div>
    </div>
  );
}

/* German currency helper (de-DE) for the preview */
function fmtEUR(n: number, currency: "EUR" | "CHF" = "EUR"): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

/* hook shims so the preview stays self-contained */
function useAppTypes() {
  const { typologies } = useApp();
  return { typologies };
}
function useEstimate(typeId: string, ngf: number) {
  const { costConfig, setCostConfig, costResult } = useApp();
  useEffect(() => {
    if (costConfig.typologyId !== typeId) setCostConfig({ typologyId: typeId });
    if (costConfig.ngf !== ngf) setCostConfig({ ngf });
  }, [typeId, ngf]);
  return { result: costResult };
}

/* Visual preview of the model-import → takeoff flow */
function ImportPreview({ goApp }: { goApp: () => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (step >= 3) return;
    const t = setTimeout(() => setStep((s) => s + 1), 1100);
    return () => clearTimeout(t);
  }, [step]);

  const flow = [
    { label: "Wohnhaus.ifc", icon: "cube" as const, detail: "Modell erkannt" },
    { label: "Bauteile auslesen", icon: "refresh" as const, detail: "42 Bauteile · 240 m² NGF" },
    { label: "DIN 276 klassifizieren", icon: "branch" as const, detail: "KG 300–340 zugeordnet" },
    { label: "Schätzung fertig", icon: "check" as const, detail: "864.000 € netto" },
  ];

  return (
    <div className="relative">
      <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-tr from-brand-500/15 to-cyan-500/15 blur-2xl" />
      <div className="relative rounded-2xl border border-slate-800 bg-ink-950 p-5 text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-rose-400/80" /><span className="h-3 w-3 rounded-full bg-brand-400/80" /><span className="h-3 w-3 rounded-full bg-emerald-400/80" />
          </div>
          <span className="text-xs font-medium text-slate-400">narchi · modell-import</span>
        </div>

        {/* dropzone mock */}
        <div className="mt-4 rounded-xl border-2 border-dashed border-white/15 bg-white/5 p-5 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500 text-ink-950"><Icon name="cube" size={22} /></span>
          <p className="mt-2 text-sm font-medium text-slate-200">IFC · IFCZIP · STEP · DXF hierher ziehen</p>
          <p className="text-[11px] text-slate-500">.ifc · .ifczip · .step · .dxf — kein DWG/RVT</p>
        </div>

        {/* flow steps */}
        <div className="mt-4 space-y-2">
          {flow.map((f, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <div key={i} className={cn("flex items-center gap-3 rounded-lg border px-3 py-2 transition-all",
                done ? "border-emerald-400/30 bg-emerald-400/5" : active ? "border-brand-400/40 bg-brand-400/5" : "border-white/10 opacity-40")}>
                <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg",
                  done ? "bg-emerald-500 text-white" : active ? "bg-brand-500 text-ink-950" : "bg-white/10 text-slate-400")}>
                  <Icon name={done ? "check" : f.icon} size={14} className={active ? "animate-spin" : ""} />
                </span>
                <span className="flex-1">
                  <span className="block text-xs font-semibold text-slate-100">{f.label}</span>
                  <span className="block text-[10px] text-slate-400">{done || active ? f.detail : "—"}</span>
                </span>
              </div>
            );
          })}
        </div>

        {/* result card */}
        <div className={cn("mt-4 rounded-xl border border-white/10 bg-white/5 p-4 transition-all duration-500", step < 3 && "opacity-30")}>
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[11px] text-slate-400">Baukosten (netto)</div>
              <div className="font-display text-2xl font-bold text-brand-300">864.000 €</div>
            </div>
            <div className="text-right">
              <div className="font-display text-lg font-bold text-white">3.600 €/m²</div>
              <div className="text-[11px] text-slate-400">NGF</div>
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            {[{ k: "KG 320 Wände", v: 60, c: "#f59e0b" }, { k: "KG 330 Tragwerk", v: 80, c: "#22d3ee" }, { k: "KG 340 Dach/Fenster", v: 45, c: "#34d399" }].map((r) => (
              <div key={r.k}>
                <div className="mb-0.5 flex justify-between text-[10px] text-slate-300"><span>{r.k}</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${r.v}%`, background: r.c }} /></div>
              </div>
            ))}
          </div>
        </div>
        <button onClick={goApp} className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg bg-brand-500 py-2 text-sm font-semibold text-ink-950 transition-colors hover:bg-brand-400">
          Jetzt testen <Icon name="arrowRight" size={14} />
        </button>
      </div>
    </div>
  );
}

function ElementJson({ el, mat }: { el: BuildingElement; mat: Material }) {
  const str = (v: string) => <span className="text-brand-300">"{v}"</span>;
  const num = (v: number) => <span className="text-violet-300">{v.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>;
  const numFine = (v: number) => <span className="text-violet-300">{v.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>;
  const Row = ({ label, children, last = false }: { label: string; children: ReactNode; last?: boolean }) => (
    <div>{"  "}<span className="text-cyan-300">"{label}"</span>: {children}{last ? "" : ","}</div>
  );
  return (
    <div>
      <div>{"{"}</div>
      <Row label="id">{str(el.id)}</Row>
      <Row label="code">{str(el.code)}</Row>
      <Row label="classification">{str(el.classificationLabel)}</Row>
      <Row label="type">{str(el.type)}</Row>
      <Row label="material">{str(mat.name)}</Row>
      <div>{"  "}<span className="text-cyan-300">"quantity"</span>: {"{ "}<span className="text-cyan-300">"value"</span>: {numFine(el.qty)}, <span className="text-cyan-300">"unit"</span>: <span className="text-emerald-300">"{el.unit}"</span>{" }"},</div>
      <Row label="weightKg">{num(el.weightKg)}</Row>
      <Row label="carbonKg">{num(Math.round(el.carbonKg))}</Row>
      <Row label="status" last>{str(el.status)}</Row>
      <div>{"}"}</div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left">
        <span className="font-medium text-slate-900">{q}</span>
        <Icon name={open ? "x" : "chevronDown"} size={18} className={`shrink-0 text-slate-400 transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
      {open && <p className="px-5 pb-4 text-sm leading-relaxed text-slate-500">{a}</p>}
    </div>
  );
}

/* --------------------------- content --------------------------- */
const SECTORS = ["Architekturbüros", "Ingenieurbüros", "AVA", "HOAI-Honorar", "GEG / LCA", "XRechnung"];

const FEATURES = [
  { icon: "branch", title: "DIN 276 aus dem Modell", desc: "Mengen aus IFC, Kostengruppen KG 300–700, Herkunft Messung / Richtwert / Regel — kein Preis ohne Quelle." },
  { icon: "refresh", title: "Sync im Büro", desc: "Projekte, Mängel und Medien zwischen Geräten des Büros. Fotos vom Handy: WhatsApp/Telegram, Import in Baustelle." },
  { icon: "scale", title: "HOAI 2021", desc: "Honorar aus anrechenbaren Kosten, Leistungsphasen, Abschlag, Nachtrag — keine Blackbox." },
  { icon: "leaf", title: "GEG & VE-Studio", desc: "Energie GEG 2024 und Substitutionen mit ΔCO₂ und Δ€ auf den echten Takeoff-Mengen." },
  { icon: "shield", title: "E-Rechnung", desc: "XRechnung 3.0 CII + UBL, ZUGFeRD PDF/A-3, .eml zum Versand. Peppol-Netz bleibt bewusst offen." },
  { icon: "pulse", title: "Self-Host", desc: "Docker auf Ihrem Windows-PC. Kein Pflicht-Cloud. Session-Cookie HttpOnly, Daten im eigenen Stack." },
] as const;

const SYNC_STEPS = [
  { icon: "link", title: "IFC laden", desc: "IFC / IFCZIP / STEP / DXF. DWG und Revit werden ehrlich abgelehnt." },
  { icon: "branch", title: "Zuordnen", desc: "Bauteile zu DIN-276-Gruppen — kontrolliert, kein Blind-Import." },
  { icon: "scale", title: "Rechnen", desc: "Mengen, Kosten, CO₂, HOAI — dieselben Zahlen im UI und auf dem Server." },
  { icon: "shield", title: "Liefern", desc: "PDF, GAEB, XRechnung, ZUGFeRD. Was fehlt, wird gesagt." },
] as const;

const TESTIMONIALS = [
  { quote: "IFC ablegen, Mengen und DIN-276-Schätzung im Browser — statt zwei Tage Excel.", name: "Schritt 1", role: "Kostenschätzung", initials: "01" },
  { quote: "Honorar HOAI aus denselben anrechenbaren Kosten, Abschlag je Leistungsphase.", name: "Schritt 2", role: "Honorar & Rechnung", initials: "02" },
  { quote: "Baustellenfotos per Messenger, Import am Schreibtisch, Mängel mit Datum der Aufnahme.", name: "Schritt 3", role: "Baustelle", initials: "03" },
];

const PRICING = [
  { name: "Beta", for: "Befreundete Büros, schriftliches Feedback", price: "0 €", period: "Beta", cta: "Starten", featured: false, features: ["Voller Self-Host-Stack", "IFC → DIN 276 → HOAI", "XRechnung / ZUGFeRD", "Kein SLA, Daten nicht kritisch"] },
  { name: "Büro-Lizenz", for: "1–15 Personen, ein Mandant", price: "1.790 €", period: "Jahr", cta: "Lizenz wählen", featured: true, features: ["Unbegrenzte Projekte im Büro", "GAEB LV / Angebote", "VE-Studio + Baustelle", "Eigene Infrastruktur"] },
  { name: "Kauf + Pflege", for: "Einmalig plus Jahrespflege", price: "3.900 €", period: "+ 690 €/J", cta: "Variante wählen", featured: false, features: ["Gleiche Funktionen wie Lizenz", "Kein 19-€-Monatstheater", "Kein Enterprise auf Zuruf", "Peppol-Netz extra / später"] },
];

const FAQ = [
  { q: "Welche Dateien kann ich wirklich importieren?", a: "IFC, IFCZIP, IFCXML und STEP. DXF über ezdxf. DWG und Revit (.rvt) werden abgelehnt — der Browser liest sie nicht zuverlässig. Das ist Absicht, kein fehlendes Häkchen." },
  { q: "Liegen die Daten in einer Cloud?", a: "Nein, nicht zwingend. Der empfohlene Weg ist Docker Desktop auf Ihrem Windows-PC (http://localhost:8080, Edge). Die Daten bleiben in Ihrer Stack (PostgreSQL + Dateivolumen)." },
  { q: "Kann ich vom Handy fotografieren und hochladen?", a: "Fotos per WhatsApp oder Telegram ans Büro, dann Import auf der Seite Baustelle. Es gibt keinen offiziellen Messenger-Bot und keinen empfohlenen HTTPS-Handyweg." },
  { q: "Ist die XRechnung echt gültig?", a: "Das Profil XRechnung 3.0 wurde mit dem offiziellen KoSIT-Validator als ACCEPTABLE gemessen (CII und UBL). Peppol-Versand über ein Access Point ist noch nicht Teil des Produkts." },
  { q: "Woher kommen die Preise?", a: "Ihre Bibliothek, Importe CSV/GAEB, Beobachtungen aus Angeboten. Jede Zahl trägt Messung, Richtwert (mit Jahr) oder Regel. Es gibt keine erfundenen Stückpreise auf der Landing." },
];

const FOOTER = [
  { title: "Produkt", links: ["Plattform", "DIN 276 Kosten", "Synchronisierung", "Preise"] },
  { title: "Normen", links: ["DIN 276", "HOAI 2021", "GEG 2024", "XRechnung"] },
  { title: "Betrieb", links: ["Self-Host", "Datenschutz", "AGB-Entwurf", "FAQ"] },
];
