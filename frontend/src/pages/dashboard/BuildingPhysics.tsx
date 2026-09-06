import { useEffect, useState } from "react";
import { Badge, Button, Card, Icon, PageHeader, ProgressBar, SegmentedControl } from "@/components/ui";
import {
  addBauteil,
  bibliothekStats,
  ersetzeBauteile,
  KATEGORIE_LABEL,
  ladeBauteile,
  removeBauteil,
  sucheBauteile,
  type BauteilKategorie,
  type BauteilStandard,
} from "@/lib/detailBibliothek";
import { pullOfficeBlob, pushOfficeBlob } from "@/lib/officeBlobSync";
import {
  calcDaylight,
  calcSound,
  calcThermalBridge,
  physicsScore,
  type DaylightInput,
  type DaylightResult,
  type SoundInput,
  type SoundResult,
  type ThermalBridgeInput,
  type ThermalBridgeResult,
} from "@/lib/buildingPhysics";
import { Disclaimer } from "@/components/Disclaimer";
import { cn } from "@/utils/cn";

type Tab = "daylight" | "sound" | "thermal";

const SEV_META = {
  ok: { label: "Konform", tone: "emerald" as const, color: "#34d399", bg: "bg-emerald-50" },
  warning: { label: "Warnung", tone: "amber" as const, color: "#f59e0b", bg: "bg-brand-50" },
  critical: { label: "Kritisch", tone: "rose" as const, color: "#f43f5e", bg: "bg-rose-50" },
};

export default function BuildingPhysics() {
  const [tab, setTab] = useState<Tab>("daylight");

  // Daylight state
  const [dlInput, setDlInput] = useState<DaylightInput>({
    roomName: "Wohnzimmer",
    roomDepth: 5.0, roomWidth: 4.0, roomHeight: 2.7,
    windowArea: 4.0, windowHeight: 1.5, sillHeight: 0.6,
    glassTransmission: 0.72, surfaceReflectance: 0.5, maintenanceFactor: 0.85,
    obstructionAngle: 15, orientation: "sued",
  });
  const dlResult: DaylightResult = calcDaylight(dlInput);

  // Sound state
  const [sndInput, setSndInput] = useState<SoundInput>({
    roomType: "wohnung_zu_wohnung",
    layers: [{ name: "KS-Wand", thickness: 24, material: "Kalksandstein 24 cm" }],
    hasFloatingScreed: false, hasAcousticPlasterboard: false, doubleShell: false,
  });
  const sndResult: SoundResult = calcSound(sndInput);

  // Thermal state
  const [tbInput, setTbInput] = useState<ThermalBridgeInput>({
    windowInstallation: "konventionell",
    wallJunction: "gedämmt",
    balcony: "kein",
    cornerDetail: "standard",
    perimeterLength: 120,
    envelopeArea: 800,
  });
  const tbResult: ThermalBridgeResult = calcThermalBridge(tbInput);

  const score = physicsScore(dlResult, sndResult, tbResult);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bauphysik"
        subtitle="Tageslicht (DIN 5034) · Schallschutz (DIN 4109) · Wärmebrücken (DIN EN ISO 14683)"
        actions={
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className={cn("font-display text-2xl font-bold", score.overall >= 80 ? "text-emerald-600" : score.overall >= 50 ? "text-brand-600" : "text-rose-600")}>{score.overall}</div>
              <div className="text-[10px] text-slate-400">Score / 100</div>
            </div>
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-3">
        <ScoreCard label="Tageslicht" norm="DIN 5034" status={score.daylight} />
        <ScoreCard label="Schallschutz" norm="DIN 4109" status={score.sound} />
        <ScoreCard label="Wärmebrücken" norm="DIN EN ISO 14683" status={score.thermal} />
      </div>

      <SegmentedControl value={tab} onChange={(v) => setTab(v as Tab)} options={[
        { value: "daylight", label: "☀️ Tageslicht" },
        { value: "sound", label: "🔊 Schallschutz" },
        { value: "thermal", label: "🌡️ Wärmebrücken" },
      ]} />

      {tab === "daylight" && <DaylightView input={dlInput} setInput={setDlInput} result={dlResult} />}
      {tab === "sound" && <SoundView input={sndInput} setInput={setSndInput} result={sndResult} />}
      {tab === "thermal" && <ThermalView input={tbInput} setInput={setTbInput} result={tbResult} />}

      <BauteilBibliothek />

      <Disclaimer level="orientation" domain="Bauphysik (DIN 5034 / 4109 / EN ISO 14683)" />
    </div>
  );
}

/* ============================ DAYLIGHT ============================ */
function DaylightView({ input, setInput, result }: { input: DaylightInput; setInput: (v: DaylightInput) => void; result: DaylightResult }) {
  const sev = SEV_META[result.severity];
  const upd = (patch: Partial<DaylightInput>) => setInput({ ...input, ...patch });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card className="p-5">
        <Label icon="bolt">Raumgeometrie</Label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <NumField label="Raumtiefe (m)" value={input.roomDepth} onChange={(v) => upd({ roomDepth: v })} step={0.1} />
          <NumField label="Raumbreite (m)" value={input.roomWidth} onChange={(v) => upd({ roomWidth: v })} step={0.1} />
          <NumField label="Raumhöhe (m)" value={input.roomHeight} onChange={(v) => upd({ roomHeight: v })} step={0.1} />
          <NumField label="Fensterfläche (m²)" value={input.windowArea} onChange={(v) => upd({ windowArea: v })} step={0.1} />
          <NumField label="Fensterhöhe (m)" value={input.windowHeight} onChange={(v) => upd({ windowHeight: v })} step={0.1} />
          <NumField label="Brüstungshöhe (m)" value={input.sillHeight} onChange={(v) => upd({ sillHeight: v })} step={0.1} />
        </div>
        <Label icon="sliders" className="mt-4">Material & Umgebung</Label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <NumField label="Lichttransmission τ" value={input.glassTransmission} onChange={(v) => upd({ glassTransmission: v })} step={0.01} />
          <NumField label="Reflexionsgrad ρ" value={input.surfaceReflectance} onChange={(v) => upd({ surfaceReflectance: v })} step={0.05} />
          <NumField label="Hinderniswinkel (°)" value={input.obstructionAngle} onChange={(v) => upd({ obstructionAngle: v })} step={5} />
          <div>
            <label className="text-xs font-semibold text-slate-500">Orientierung</label>
            <select value={input.orientation} onChange={(e) => upd({ orientation: e.target.value as DaylightInput["orientation"] })} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-2 text-sm">
              {["nord", "nordost", "ost", "suedost", "sued", "suedwest", "west", "nordwest"].map((o) => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
            </select>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <Card className={cn("overflow-hidden p-5", sev.bg)}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">Tageslichtquotient T</span>
            <Badge tone={sev.tone} dot>{sev.label}</Badge>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-5xl font-bold" style={{ color: sev.color }}>{result.daylightFactor.toFixed(2)}</span>
            <span className="text-lg text-slate-500">%</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">Mindestwert DIN 5034: 0,9% · Empfehlung: 2,0%</p>
          <div className="mt-3">
            <ProgressBar value={(result.daylightFactor / 4) * 100} color={sev.color} />
            <div className="mt-1 flex justify-between text-[10px] text-slate-400"><span>0%</span><span>2%</span><span>4%+</span></div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3 text-center">
            <div><div className="font-display text-lg font-bold text-slate-900">{result.daylightAutonomy.toFixed(0)}%</div><div className="text-[11px] text-slate-500">Tageslichtautonomie</div></div>
            <div><div className="font-display text-lg font-bold text-slate-900">{(result.awRatio * 100).toFixed(0)}%</div><div className="text-[11px] text-slate-500">Fenster/Boden-Verh.</div></div>
          </div>
        </Card>

        <Card className={cn("p-4 text-xs leading-relaxed", sev.bg)}>
          <Icon name="arrowRight" size={13} className="mr-1 inline" style={{ color: sev.color }} />
          {result.recommendation}
        </Card>
      </div>
    </div>
  );
}

/* ============================ SOUND ============================ */
function SoundView({ input, setInput, result }: { input: SoundInput; setInput: (v: SoundInput) => void; result: SoundResult }) {
  const sev = SEV_META[result.severity];
  const upd = (patch: Partial<SoundInput>) => setInput({ ...input, ...patch });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card className="p-5">
        <Label icon="building">Raumtyp & Anforderung</Label>
        <select value={input.roomType} onChange={(e) => upd({ roomType: e.target.value as SoundInput["roomType"] })} className="mt-2 h-10 w-full rounded-xl border border-slate-200 px-2 text-sm">
          <option value="wohnung_zu_wohnung">Wohnung → Wohnung (53 dB)</option>
          <option value="wohnung_intern">Wohnung intern (40 dB)</option>
          <option value="treppenhaus">→ Treppenhaus/Flur (52 dB)</option>
          <option value="gewerbe">→ Gewerbe (57 dB)</option>
          <option value="schule">Schule (55 dB)</option>
          <option value="krankenhaus">Krankenhaus (57 dB)</option>
        </select>

        <Label icon="layers" className="mt-4">Wandaufbau (Hauptschicht)</Label>
        <select value={input.layers[0].material} onChange={(e) => upd({ layers: [{ ...input.layers[0], material: e.target.value }] })} className="mt-2 h-10 w-full rounded-xl border border-slate-200 px-2 text-sm">
          <option value="Kalksandstein 17,5 cm">Kalksandstein 17,5 cm</option>
          <option value="Kalksandstein 24 cm">Kalksandstein 24 cm</option>
          <option value="Porenbeton (Ytong) 36,5 cm">Porenbeton 36,5 cm</option>
          <option value="Stahlbeton 20 cm">Stahlbeton 20 cm</option>
          <option value="Stahlbeton 25 cm">Stahlbeton 25 cm</option>
          <option value="Hochlochziegel 17,5 cm">Hochlochziegel 17,5 cm</option>
          <option value="Gipskarton einfach">Gipskarton einfach</option>
          <option value="Gipskarton doppelt">Gipskarton doppelt</option>
        </select>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <NumField label="Wandstärke (cm)" value={input.layers[0].thickness} onChange={(v) => upd({ layers: [{ ...input.layers[0], thickness: v }] })} step={0.5} />
        </div>

        <Label icon="shield" className="mt-4">Zusätzliche Maßnahmen</Label>
        <div className="mt-3 space-y-2">
          <ToggleRow label="Trittschalldämmung (Estrich auf Dämmung)" checked={input.hasFloatingScreed} onChange={(v) => upd({ hasFloatingScreed: v })} />
          <ToggleRow label="Vorsatzschale (GK + Minerwolle)" checked={input.hasAcousticPlasterboard} onChange={(v) => upd({ hasAcousticPlasterboard: v })} />
          <ToggleRow label="Doppelschaliger Aufbau (Trennfuge)" checked={input.doubleShell} onChange={(v) => upd({ doubleShell: v })} />
        </div>
      </Card>

      <div className="space-y-4">
        <Card className={cn("p-5", sev.bg)}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">Schalldämmmaß Rw</span>
            <Badge tone={sev.tone} dot>{sev.label}</Badge>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-5xl font-bold" style={{ color: sev.color }}>{result.achievedRw}</span>
            <span className="text-lg text-slate-500">dB</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">Erforderlich: {result.requiredRw} dB (DIN 4109) · Reserve: {result.margin >= 0 ? "+" : ""}{result.margin} dB</p>
          <div className="mt-3"><ProgressBar value={Math.min((result.achievedRw / 65) * 100, 100)} color={sev.color} /></div>
        </Card>
        <Card className={cn("p-4 text-xs leading-relaxed", sev.bg)}>
          <Icon name="arrowRight" size={13} className="mr-1 inline" style={{ color: sev.color }} />
          {result.recommendation}
        </Card>
      </div>
    </div>
  );
}

/* ============================ THERMAL ============================ */
function ThermalView({ input, setInput, result }: { input: ThermalBridgeInput; setInput: (v: ThermalBridgeInput) => void; result: ThermalBridgeResult }) {
  const sev = SEV_META[result.severity];
  const upd = (patch: Partial<ThermalBridgeInput>) => setInput({ ...input, ...patch });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card className="p-5">
        <Label icon="layers">Anschlussdetails</Label>
        <div className="mt-3 space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-500">Fenstereinbau</label>
            <select value={input.windowInstallation} onChange={(e) => upd({ windowInstallation: e.target.value as ThermalBridgeInput["windowInstallation"] })} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-2 text-sm">
              <option value="konventionell">Konventionell (ψ ≈ 0,08)</option>
              <option value="wärmebrückenfrei">Wärmebrückenfrei (ψ ≈ 0,02)</option>
              <option value="nachweis">Mit Nachweis (ψ ≈ 0,05)</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Wandanschluss</label>
            <select value={input.wallJunction} onChange={(e) => upd({ wallJunction: e.target.value as ThermalBridgeInput["wallJunction"] })} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-2 text-sm">
              <option value="ungedämmt">Ungedämmt (ψ ≈ 0,15)</option>
              <option value="gedämmt">Außengedämmt (ψ ≈ 0,05)</option>
              <option value="kerndämmung">Kerndämmung (ψ ≈ 0,10)</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Balkonanschluss</label>
            <select value={input.balcony} onChange={(e) => upd({ balcony: e.target.value as ThermalBridgeInput["balcony"] })} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-2 text-sm">
              <option value="kein">Kein Balkon</option>
              <option value="thermisch_getrennt">Thermisch getrennt (ψ ≈ 0,04)</option>
              <option value="durchlaufend">Durchlaufend (ψ ≈ 0,20)</option>
            </select>
          </div>
        </div>

        <Label icon="scale" className="mt-4">Gebäudegeometrie</Label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <NumField label="Umfang Wärmebrücken (m)" value={input.perimeterLength} onChange={(v) => upd({ perimeterLength: v })} step={1} />
          <NumField label="Hüllfläche (m²)" value={input.envelopeArea} onChange={(v) => upd({ envelopeArea: v })} step={10} />
        </div>
      </Card>

      <div className="space-y-4">
        <Card className={cn("p-5", sev.bg)}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">Wärmebrückenzuschlag ΔUwb</span>
            <Badge tone={sev.tone} dot>{sev.label}</Badge>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-5xl font-bold" style={{ color: sev.color }}>{result.deltaUwb.toFixed(3)}</span>
            <span className="text-sm text-slate-500">W/(m²K)</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">Zielwert: ≤ 0,05 · Durchschnitt ψ: {result.psiTotal.toFixed(3)} W/(mK)</p>
          <div className="mt-3"><ProgressBar value={Math.min((result.deltaUwb / 0.2) * 100, 100)} color={sev.color} /></div>
        </Card>

        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3 text-center">
            <div><div className="font-display text-lg font-bold text-rose-600">{result.heatLossKwh.toFixed(0)}</div><div className="text-[11px] text-slate-500">kWh/a Verlust</div></div>
            <div><div className="font-display text-lg font-bold text-brand-600">{result.heatLossPct.toFixed(0)}%</div><div className="text-[11px] text-slate-500">der Transmissionsverluste</div></div>
          </div>
        </Card>

        <Card className={cn("p-4 text-xs leading-relaxed", sev.bg)}>
          <Icon name="arrowRight" size={13} className="mr-1 inline" style={{ color: sev.color }} />
          {result.recommendation}
        </Card>
      </div>
    </div>
  );
}

/* ============================ §181 — BAUTEIL-STANDARD-BIBLIOTHEK ============ */

function BauteilBibliothek() {
  const [bauteile, setBauteile] = useState<BauteilStandard[]>(() => ladeBauteile());
  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await pullOfficeBlob("bauteile");
      if (!live || !r || r.empty || !Array.isArray(r.payload.items)) return;
      setBauteile(ersetzeBauteile(r.payload.items as BauteilStandard[]));
    })();
    return () => {
      live = false;
    };
  }, []);
  const [name, setName] = useState("");
  const [kategorie, setKategorie] = useState<BauteilKategorie>("wand");
  const [aufbau, setAufbau] = useState("");
  const [uWert, setUWert] = useState("");
  const [kosten, setKosten] = useState("");
  const [notiz, setNotiz] = useState("");
  const [q, setQ] = useState("");

  const speichern = () => {
    if (!name.trim() || !aufbau.trim()) return;
    const next = addBauteil({
      name: name.trim(),
      kategorie,
      aufbau: aufbau.trim(),
      uWert: uWert ? Number(uWert.replace(",", ".")) || null : null,
      kosten: kosten ? Number(kosten.replace(",", ".")) || null : null,
      notiz: notiz.trim(),
    });
    setBauteile(next);
    void pushOfficeBlob("bauteile", { items: next });
    setName(""); setAufbau(""); setUWert(""); setKosten(""); setNotiz("");
  };

  const gefiltert = sucheBauteile(bauteile, q);

  return (
    <Card>
      <div className="border-b border-slate-100 p-5">
        <h3 className="font-display font-semibold text-slate-900">Bauteil-Standards (Detailbibliothek)</h3>
        <p className="mt-1 text-xs text-slate-500">
          {bibliothekStats(bauteile).total} Standards gespeichert — nie wieder einen Anschluss oder eine Wand neu erfinden. Ihre eigenen Richtwerte, keine erfundenen Daten.
        </p>
      </div>
      <div className="p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_2fr_auto_auto_1fr_auto]">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (z. B. Außenwand KS+WDVS)" className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none" />
          <select value={kategorie} onChange={(e) => setKategorie(e.target.value as BauteilKategorie)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none">
            {(Object.keys(KATEGORIE_LABEL) as BauteilKategorie[]).map((k) => (
              <option key={k} value={k}>{KATEGORIE_LABEL[k]}</option>
            ))}
          </select>
          <input value={aufbau} onChange={(e) => setAufbau(e.target.value)} placeholder="Aufbau (z. B. KS 17,5 + WDVS EPS 160)" className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none" />
          <input value={uWert} onChange={(e) => setUWert(e.target.value)} placeholder="U-Wert" className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none" />
          <input value={kosten} onChange={(e) => setKosten(e.target.value)} placeholder="€/m²" className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none" />
          <input value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="Notiz" className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none" />
          <Button icon="check" variant="primary" size="sm" onClick={speichern}>Speichern</Button>
        </div>

        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Standards durchsuchen…" className="mt-4 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none sm:w-72" />

        {gefiltert.length > 0 ? (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {gefiltert.map((b) => (
              <li key={b.id} className="rounded-xl border border-slate-100 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800">{b.name}</span>
                  <Badge tone="slate">{KATEGORIE_LABEL[b.kategorie]}</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500">{b.aufbau}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  {b.uWert != null && <span className="text-slate-600">U = {b.uWert.toLocaleString("de-DE", { maximumFractionDigits: 2 })} W/(m²K)</span>}
                  {b.kosten != null && <span className="text-slate-600">{b.kosten.toLocaleString("de-DE")} €/m²</span>}
                </div>
                {b.notiz && <p className="mt-1.5 text-[11px] italic text-slate-400">{b.notiz}</p>}
                <button type="button" onClick={() => {
                  const next = removeBauteil(b.id);
                  setBauteile(next);
                  void pushOfficeBlob("bauteile", { items: next });
                }} className="mt-2 text-[11px] font-semibold text-rose-500 hover:text-rose-600">Löschen</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-slate-400">Noch keine Standards — speichern Sie Ihren ersten Bauteil-Standard, um ihn projektübergreifend wiederzuverwenden.</p>
        )}
      </div>
    </Card>
  );
}

/* ============================ HELPERS ============================ */
function ScoreCard({ label, norm, status }: { label: string; norm: string; status: string }) {
  const sev = SEV_META[status as keyof typeof SEV_META] ?? SEV_META.warning;
  return (
    <Card className={cn("p-4 text-center transition-all", sev.bg)}>
      <div className="text-xs font-semibold text-slate-600">{label}</div>
      <div className="mt-0.5 text-[10px] text-slate-400">{norm}</div>
      <div className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: sev.color + "22", color: sev.color }}>
        <span className="h-2 w-2 rounded-full" style={{ background: sev.color }} />
        {sev.label}
      </div>
    </Card>
  );
}

function Label({ icon, children, className }: { icon: Parameters<typeof Icon>[0]["name"]; children: React.ReactNode; className?: string }) {
  return <div className={cn("flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400", className)}><Icon name={icon} size={14} /> {children}</div>;
}

function NumField({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500">{label}</label>
      <input type="number" value={value} step={step ?? 1} onChange={(e) => onChange(Number(e.target.value) || 0)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-800 focus:border-brand-400 focus:outline-none" />
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left hover:bg-slate-50">
      <span className="text-sm text-slate-700">{label}</span>
      <span className={cn("flex h-5 w-9 items-center rounded-full p-0.5 transition-colors", checked ? "bg-brand-500" : "bg-slate-300")}>
        <span className={cn("h-4 w-4 rounded-full bg-white transition-transform", checked && "translate-x-4")} />
      </span>
    </button>
  );
}
