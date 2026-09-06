import { useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, Icon, PageHeader } from "@/components/ui";
import { getRemoteConfig, setRemoteConfig, clearRemoteConfig } from "@/lib/remoteConfig";
import { testConnection } from "@/lib/supabase";
import { checkBackendHealth, fetchSystemStatus, getApiBase, setApiBase, getApiMode, setApiMode, type ApiMode, type SystemStatus } from "@/lib/apiClient";
import { cn } from "@/utils/cn";

export default function Backend() {
  const [config, setConfig] = useState(() => getRemoteConfig());
  const [url, setUrl] = useState(config?.url ?? "");
  const [anonKey, setAnonKey] = useState(config?.anonKey ?? "");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [apiBase, setApiBaseState] = useState(getApiBase());
  const [apiMode, setApiModeState] = useState<ApiMode>(getApiMode());
  const [pyHealth, setPyHealth] = useState<{ ok: boolean; version?: string } | null>(null);
  const [sysStatus, setSysStatus] = useState<SystemStatus | null>(null);
  const online = !!config;

  // detect Python FastAPI backend
  useEffect(() => {
    void checkBackendHealth().then((h) => setPyHealth(h));
    const iv = window.setInterval(() => void checkBackendHealth().then(setPyHealth), 10000);
    return () => window.clearInterval(iv);
  }, [apiBase]);

  // §178 — statut système profond (DB + capacités prouvées).
  useEffect(() => {
    void fetchSystemStatus().then(setSysStatus);
    const iv = window.setInterval(() => void fetchSystemStatus().then(setSysStatus), 15000);
    return () => window.clearInterval(iv);
  }, [apiBase]);

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    const ok = await testConnection(url, anonKey);
    setResult({ ok, text: ok ? "Verbindung erfolgreich! Die Backend-Datenbank reagiert." : "Verbindung fehlgeschlagen — URL und Anon-Key prüfen." });
    setTesting(false);
  };

  const handleSave = () => {
    setRemoteConfig(url, anonKey);
    setConfig(getRemoteConfig());
    setResult({ ok: true, text: "Backend aktiviert. Bitte neu anmelden, damit alle Geräte synchronisieren." });
  };

  const handleDisconnect = () => {
    clearRemoteConfig();
    setConfig(null);
    setUrl("");
    setAnonKey("");
    setResult({ ok: true, text: "Backend deaktiviert — Narchi läuft jetzt offline (lokale Datenbank)." });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backend"
        subtitle="Self-Host: Docker + FastAPI + PostgreSQL — kein Pflicht-Cloud"
        actions={pyHealth?.ok
          ? <Badge tone="emerald" dot>Stack erreichbar</Badge>
          : <Badge tone="amber" dot>API nicht erreichbar</Badge>}
      />

      {/* status banner */}
      <Card className={cn("overflow-hidden", online ? "border-emerald-200" : "border-amber-200")}>
        <div className={cn("grid gap-6 p-6 lg:grid-cols-[1fr_auto] lg:items-center", online ? "bg-gradient-to-br from-emerald-50 to-white" : "bg-gradient-to-br from-amber-50 to-white")}>
          <div className="flex items-start gap-4">
            <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white", online ? "bg-emerald-500" : "bg-amber-500")}>
              <Icon name={online ? "shield" : "lock"} size={24} />
            </span>
            <div>
              <h3 className="font-display text-lg font-bold text-slate-900">
                {pyHealth?.ok ? "Self-Host-Stack läuft" : "API nicht erreicht — Browser allein"}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                Der offizielle Weg ist <strong>Docker Desktop</strong> auf diesem PC
                (<code>http://localhost:8080</code>). Postgres, Chat, Rechnungen und Sync leben dort.
                Supabase unten ist ein <strong>Altpfad</strong>, kein empfohlenes Cloud-Backend.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone={pyHealth?.ok ? "emerald" : "amber"}>{pyHealth?.ok ? "Docker / FastAPI" : "kein API-Ping"}</Badge>
                <Badge tone="slate">Kein Pflicht-Cloud</Badge>
                <Badge tone={online ? "amber" : "slate"}>{online ? "Supabase-Altpfad aktiv" : "kein Supabase"}</Badge>
              </div>
            </div>
          </div>
          {online && (
            <div className="shrink-0 rounded-2xl bg-white p-4 text-center ring-1 ring-emerald-100">
              <div className="text-xs text-slate-400">Verbunden mit</div>
              <div className="font-mono text-xs font-semibold text-slate-700">{config?.url.replace("https://", "").replace("http://", "")}</div>
            </div>
          )}
        </div>
      </Card>

      {/* Python FastAPI engine status */}
      <Card>
        <CardHeader title="Berechnungs-Engine (Python FastAPI)" subtitle="IFC-Mengen, DIN 276, HOAI, GAEB, XRechnung — keine erfundene Stückpreisliste" action={
          pyHealth?.ok ? <Badge tone="emerald" dot>Verbunden · v{pyHealth.version}</Badge> : <Badge tone="slate" dot>Lokal (Browser-Engine)</Badge>
        } />
        <div className="space-y-4 p-5">
          <p className="text-sm text-slate-600">
            Wenn der Narchi-Server (Docker, <code>localhost:8000</code>) läuft, laufen alle Berechnungen mit voller Präzision
            (IFC-Takeoff, Ihre Preisbibliothek, LCA, GAEB). Ohne Server bleibt die Browser-Engine — ehrlich eingeschränkt.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-semibold text-slate-500">API-URL</label>
              <input value={apiBase} onChange={(e) => { setApiBaseState(e.target.value); setApiBase(e.target.value); }} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-mono focus:border-brand-400 focus:outline-none" />
            </div>
            <Button variant="secondary" icon="refresh" onClick={async () => setPyHealth(await checkBackendHealth())}>Neu prüfen</Button>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Modus</label>
            <div className="mt-1 inline-flex rounded-xl bg-slate-100 p-1">
              {(["auto", "remote", "local"] as ApiMode[]).map((m) => (
                <button key={m} onClick={() => { setApiModeState(m); setApiMode(m); }} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold capitalize", apiMode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>
                  {m === "auto" ? "Auto (empfohlen)" : m === "remote" ? "Nur Server" : "Nur Browser"}
                </button>
              ))}
            </div>
          </div>
          {pyHealth?.ok && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
              <Icon name="check" size={13} className="mr-1 inline" /> FastAPI-Engine v{pyHealth.version} erreichbar — volle Präzision aktiv.
            </div>
          )}
        </div>
      </Card>

      {/* §178 — System-Status : la preuve de fiabilité, en clair. */}
      {sysStatus && (
        <Card>
          <CardHeader
            title="System-Status (Selbstdiagnose)"
            subtitle="Echtzeit-Prüfung: Datenbank, Version und nachgewiesene Fähigkeiten — kein Marketing, nur Messwerte."
            action={
              sysStatus.status === "operational"
                ? <Badge tone="emerald" dot>Betriebsbereit</Badge>
                : <Badge tone="rose" dot>Eingeschränkt</Badge>
            }
          />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Datenbank</span><span className={cn("font-semibold", sysStatus.database === "ok" ? "text-emerald-600" : "text-rose-600")}>{sysStatus.database === "ok" ? "Erreichbar" : "Fehler"}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Version</span><span className="font-semibold text-slate-800">{sysStatus.version}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Serverzeit</span><span className="font-mono text-xs text-slate-500">{new Date(sysStatus.server_time).toLocaleTimeString("de-DE")}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">LLM</span><span className="font-semibold text-slate-800">{sysStatus.llm?.mode === "ollama" ? `lokal ${sysStatus.llm.model}` : sysStatus.llm?.mode === "cloud" ? "Cloud" : "aus"}</span></div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">E-Rechnung (nachgewiesen)</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                <Cap cap={sysStatus.capabilities.xrechnung_kosit} label="XRechnung 3.0.2 (KoSIT-Validator)" />
                <Cap cap={sysStatus.capabilities.zugferd_pdfa3} label="ZUGFeRD / Factur-X PDF/A-3b" />
                <Cap cap={sysStatus.capabilities.ubl_2_1} label="UBL 2.1" />
                <Cap cap={sysStatus.capabilities.versand_eml} label="Versand (.eml)" />
                <Cap cap={sysStatus.capabilities.peppol_network} label="Peppol-Netzwerk (Access Point)" note="offen" />
              </ul>
            </div>
          </div>
        </Card>
      )}

      {/* setup wizard — §255 zugeklappt: kein Cloud-Theater in der Beta */}
      <Card>
        <CardHeader title="Supabase (kein Beta-Weg)" subtitle="Nur Altpfad — zugeklappt, nicht empfohlen" />
        <details className="space-y-5 p-5">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">Altpfad anzeigen (Labor)</summary>
        <div className="mt-4 space-y-5">
          {!online && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Nicht nötig für den Bürobetrieb. Felder nur für Labore / Altinstallationen.
            </p>
          )}

          <div className="grid gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500">Supabase Project URL</label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://xxxxxxxx.supabase.co"
                className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-mono text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Anon Public Key</label>
              <textarea
                value={anonKey}
                onChange={(e) => setAnonKey(e.target.value)}
                rows={2}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
              />
            </div>
          </div>

          {result && (
            <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm", result.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700")}>
              <Icon name={result.ok ? "check" : "alert"} size={15} /> {result.text}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon="target" disabled={testing || !url || !anonKey} onClick={handleTest}>{testing ? "Teste…" : "Verbindung testen"}</Button>
            <Button icon="check" disabled={!url || !anonKey} onClick={handleSave}>{online ? "Aktualisieren" : "Verbinden & aktivieren"}</Button>
            {online && <Button variant="ghost" icon="x" onClick={handleDisconnect}>Trennen (offline)</Button>}
          </div>
        </div>
        </details>
      </Card>

      {/* what syncs */}
      <Card>
        <CardHeader title="Was der Self-Host-Stack schon trägt" subtitle="Ohne Supabase — sobald Docker läuft" />
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          {[
            { icon: "lock" as const, t: "Authentifizierung", d: "Server-seitige Auth — Konten auf jedem Gerät verfügbar" },
            { icon: "pulse" as const, t: "Team-Messages", d: "Chat-Nachrichten in Echtzeit zwischen allen Büros" },
            { icon: "spark" as const, t: "Büro-Klima", d: "Stimmungs-Check-ins teamweit sichtbar" },
            { icon: "layers" as const, t: "Planprüfung", d: "Review-Pins auf Plänen synchronisiert" },
          ].map((f) => (
            <div key={f.t} className="flex items-start gap-3 rounded-xl border border-slate-100 p-3">
              <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", online ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400")}>
                <Icon name={f.icon} size={18} />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800">{f.t}</p>
                <p className="text-xs text-slate-500">{f.d}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <p className="text-center text-xs text-slate-400">
        <Icon name="shield" size={12} className="mr-1 inline" />
        Empfohlen: Stack lokal (1_DEMARRER / 2_REDEMARRER). Supabase ist kein Produktversprechen.
      </p>
    </div>
  );
}

function Cap({ cap, label, note }: { cap: boolean; label: string; note?: string }) {
  return (
    <li className="flex items-center gap-2">
      <Icon name={cap ? "check" : "x"} size={14} className={cap ? "text-emerald-500" : "text-slate-300"} />
      <span className={cn("flex-1", cap ? "text-slate-700" : "text-slate-400")}>{label}</span>
      {note && <span className="text-[10px] text-slate-400">({note})</span>}
    </li>
  );
}

function Step({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-ink-950">{n}</span>
      <div>
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-xs leading-snug text-slate-500">{desc}</p>
      </div>
    </li>
  );
}
