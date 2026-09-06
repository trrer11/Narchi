import { useMemo, useState } from "react";
import { useApp } from "@/store/AppStore";
import { baueLeistungskette, ngfLabor } from "@/lib/leistungskette";
import { deriveCostResult } from "@/store/LegacyDerivedSlice";
import { fmtMoney } from "@/lib/costEngine";
import { Button, Card } from "@/components/ui";
import { cn } from "@/utils/cn";

const TONE: Record<string, string> = {
  leer: "border-slate-200 bg-slate-50 text-slate-500",
  messung: "border-emerald-300 bg-emerald-50 text-emerald-900",
  eingabe: "border-amber-300 bg-amber-50 text-amber-900",
  bereit: "border-cyan-300 bg-cyan-50 text-cyan-900",
};

export function Leistungskette() {
  const {
    activeElements, costConfig, costResult, hoaiConfig, hoaiResult,
    energyConfig, navigate, activeProject,
  } = useApp();
  const schritte = useMemo(
    () =>
      baueLeistungskette({
        bauteile: activeElements.length,
        ngf: costConfig.ngf,
        ngfQuelle: costConfig.ngfQuelle,
        dinNetto: costConfig.ngf > 0 ? costResult.netTotal : 0,
        hoaiAnrechenbar: hoaiConfig.anrechenbareKosten,
        hoaiNetto: hoaiConfig.anrechenbareKosten > 0 ? hoaiResult.total : 0,
        gegTfa: energyConfig.tfa,
        rechnungenMitProjekt: 0,
      }),
    [activeElements.length, costConfig, costResult.netTotal, hoaiConfig, hoaiResult.total, energyConfig.tfa],
  );

  const [delta, setDelta] = useState(0);
  const previewNgf = ngfLabor(costConfig.ngf, delta);
  const previewCost = useMemo(() => {
    if (previewNgf <= 0) return null;
    return deriveCostResult({ ...costConfig, ngf: previewNgf });
  }, [costConfig, previewNgf]);

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 bg-ink-950 px-5 py-4 text-white">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-400">Digitale Leistungskette</p>
        <h3 className="font-display text-lg font-bold">{activeProject.name || "Kein Projekt"}</h3>
        <p className="text-xs text-slate-400">IFC → DIN 276 → HOAI → GEG — nur was wirklich da ist.</p>
      </div>
      <div className="grid gap-px bg-slate-100 sm:grid-cols-5">
        {schritte.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => navigate(s.href)}
            className={cn("p-4 text-left transition hover:brightness-95", TONE[s.status])}
          >
            <p className="text-[10px] font-bold uppercase tracking-wide opacity-70">{s.titel}</p>
            <p className="mt-1 font-display text-sm font-bold">{s.wert}</p>
            <p className="mt-1 text-[11px] leading-snug opacity-80">{s.hinweis}</p>
          </button>
        ))}
      </div>
      <div className="space-y-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">NGF-Labor (Vorschau)</p>
            <p className="text-xs text-slate-500">Speichert nichts. Zeigt DIN neu bei ± Fläche.</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setDelta(0)}>0 %</Button>
        </div>
        <input
          type="range"
          min={-20}
          max={20}
          step={1}
          value={delta}
          disabled={costConfig.ngf <= 0}
          onChange={(e) => setDelta(Number(e.target.value))}
          className="narchi-range w-full"
        />
        <p className="text-sm text-slate-700">
          {costConfig.ngf <= 0
            ? "Ohne NGF kein Labor."
            : `${delta >= 0 ? "+" : ""}${delta} % → ${previewNgf.toLocaleString("de-DE")} m² · ${previewCost ? fmtMoney(previewCost.netTotal) : "—"} netto (Vorschau)`}
        </p>
      </div>
    </Card>
  );
}
