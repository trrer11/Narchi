import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, CardHeader, Icon, PageHeader } from "@/components/ui";
import {
  autoBack,
  downloadBackup,
  getVaultStatus,
  readBackupFile,
  restoreSnapshot,
  startAutoBackup,
  type VaultStatus,
} from "@/lib/dataVault";
import { relativeTime } from "@/lib/format";
import { cn } from "@/utils/cn";

export default function DataVault() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => setStatus(await getVaultStatus());
  useEffect(() => {
    startAutoBackup();
    void refresh();
    const iv = window.setInterval(refresh, 5000);
    return () => window.clearInterval(iv);
  }, []);

  const doBackup = async () => {
    setBusy(true);
    await autoBack();
    await refresh();
    setMsg({ ok: true, text: "Sicherung gespeichert." });
    setBusy(false);
    setTimeout(() => setMsg(null), 3000);
  };

  const doExport = () => {
    downloadBackup();
    setMsg({ ok: true, text: "Backup-Datei heruntergeladen." });
    setTimeout(() => setMsg(null), 3000);
  };

  const doImport = async (file: File) => {
    setBusy(true);
    try {
      const snap = await readBackupFile(file);
      const { restored } = await restoreSnapshot(snap);
      await refresh();
      setMsg({ ok: true, text: `${restored} Datenpunkte wiederhergestellt — Seite lädt neu…` });
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Import fehlgeschlagen." });
    } finally {
      setBusy(false);
    }
  };

  const kb = status ? (status.bytes / 1024).toFixed(1) : "—";

  return (
    <div className="space-y-6">
      <PageHeader
        title="DataVault"
        subtitle="Zusätzlicher Browser-Tresor — die Bürodaten liegen bereits in Ihrem Docker-Stack"
        actions={<Badge tone="emerald" dot>{status?.autoBackupActive ? "Auto-Sync aktiv" : "…"}</Badge>}
      />

      {/* trust banner */}
      <Card className="overflow-hidden border-emerald-200 bg-gradient-to-br from-emerald-50 to-white">
        <div className="grid gap-6 p-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white"><Icon name="shield" size={24} /></span>
            <div>
              <h3 className="font-display text-lg font-bold text-slate-900">Self-Host + lokaler Tresor</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                NARCHI speichert Projekte, Mängel, Medien und Büro-Blobs auf <strong>Ihrer</strong> Docker-Infrastruktur
                (PostgreSQL + Dateivolumen) — kein Pflicht-Cloud. Dieser DataVault ist ein <strong>zusätzlicher</strong>{" "}
                Browser-Export (IndexedDB / .narchi), kein Ersatz für <code>5_SAUVEGARDE_EXTERNE.bat</code>.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone="emerald">Self-Host</Badge>
                <Badge tone="cyan">Offline-fähig</Badge>
                <Badge tone="slate">Kein Pflicht-Cloud</Badge>
                <Badge tone="amber">Browser-Export</Badge>
              </div>
            </div>
          </div>
          <div className="shrink-0 rounded-2xl bg-white p-4 text-center ring-1 ring-emerald-100">
            <div className="text-xs text-slate-400">Letzte Sicherung</div>
            <div className="font-display text-base font-bold text-slate-900">{status?.lastBackup ? relativeTime(status.lastBackup) : "—"}</div>
            <div className="mt-0.5 text-[11px] text-emerald-600">{kb} KB · {status?.itemCount ?? 0} Datenpunkte</div>
          </div>
        </div>
      </Card>

      {/* actions */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Icon name="refresh" size={20} /></span>
          <h4 className="mt-3 font-display font-semibold text-slate-900">Jetzt sichern</h4>
          <p className="mt-1 text-xs text-slate-500">Erstellt sofort eine lokale Sicherung im Tresor.</p>
          <Button className="mt-3 w-full" size="sm" icon="check" disabled={busy} onClick={doBackup}>Sichern</Button>
        </Card>
        <Card className="p-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600"><Icon name="download" size={20} /></span>
          <h4 className="mt-3 font-display font-semibold text-slate-900">Backup exportieren</h4>
          <p className="mt-1 text-xs text-slate-500">Lädt den kompletten Arbeitsbereich als <code>.narchi</code>-Datei.</p>
          <Button className="mt-3 w-full" size="sm" variant="secondary" icon="download" onClick={doExport}>Exportieren</Button>
        </Card>
        <Card className="p-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><Icon name="layers" size={20} /></span>
          <h4 className="mt-3 font-display font-semibold text-slate-900">Backup importieren</h4>
          <p className="mt-1 text-xs text-slate-500">Stellt eine <code>.narchi</code>-Datei wieder her (überschreibt lokal).</p>
          <Button className="mt-3 w-full" size="sm" variant="secondary" icon="cube" onClick={() => fileRef.current?.click()}>Importieren</Button>
          <input ref={fileRef} type="file" accept=".narchi,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ""; }} />
        </Card>
      </div>

      {msg && (
        <div className={cn("flex items-center gap-2 rounded-xl border px-4 py-3 text-sm", msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700")}>
          <Icon name={msg.ok ? "check" : "alert"} size={16} /> {msg.text}
        </div>
      )}

      {/* legal / liability note */}
      <Card>
        <CardHeader title="Haftung & Datenschutz" subtitle="Wichtig für Planungsbüros" />
        <div className="space-y-4 p-5 text-sm leading-relaxed text-slate-600">
          <p><strong className="text-slate-800">Zwei Ebenen.</strong> Der Stack (Postgres, Dateien) hält die Bürodaten. Der Browser hält Kopien und diesen Tresor. Es ist falsch zu sagen « nichts geht auf einen Server » — der Server ist Ihrer.</p>
          <p><strong className="text-slate-800">Backup-Empfehlung.</strong> Exportiere regelmäßig ein <code>.narchi</code>-Backup und bewahre es mit deinen Projektakten auf. Narchi erstellt automatisch eine lokale Sicherung, ersetzt aber nicht deine eigene Archivierungspflicht.</p>
          <p><strong className="text-slate-800">Normative Berechnungen.</strong> Die Rechenmotoren (DIN 276, GEG, HOAI) liefern belastbare Orientierungswerte. Für rechtsverbindliche Nachweise (Baueingabe, Energieausweis) ist die Prüfung durch einen zugelassenen Sachverständigen erforderlich.</p>
          <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500"><Icon name="shield" size={13} className="mr-1 inline" /> Narchi unterstützt deine Arbeit — die fachliche Verantwortung verbleibt beim Planer.</p>
        </div>
      </Card>
    </div>
  );
}
