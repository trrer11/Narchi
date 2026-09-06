/** §242 — Beta-Büro: Checkliste + Grenzen. Crew-Agents-Theater entfernt. */
import { useMemo, useState } from "react";
import { Button, Icon } from "@/components/ui";
import { useApp } from "@/store/AppStore";
import { BETA_GRENZEN, betaCheckliste } from "@/lib/betaBuero";

const HIDE_KEY = "narchi:beta:checkliste-weg";
const LIMIT_KEY = "narchi:beta:grenzen-weg";

export function OnboardingBanner() {
  const { navigate, projects, activeElements, costConfig } = useApp();
  const [hideList, setHideList] = useState(() => {
    try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; }
  });
  const [hideLimits, setHideLimits] = useState(() => {
    try { return localStorage.getItem(LIMIT_KEY) === "1"; } catch { return false; }
  });

  const schritte = useMemo(
    () => betaCheckliste({
      projektAnzahl: projects.length,
      bauteileAktiv: activeElements.length,
      ngf: costConfig.ngf,
    }),
    [projects.length, activeElements.length, costConfig.ngf],
  );
  const offen = schritte.filter((s) => !s.ok).length;

  if (hideList && hideLimits) return null;

  return (
    <div className="space-y-3">
      {!hideLimits && (
        <div className="rounded-2xl border border-ink-800 bg-ink-950 p-4 text-white">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-400">NARCHI Beta</p>
              <p className="mt-1 text-sm text-slate-300">Für echte Büros — Grenzen stehen hier, nicht im Kleingedruckten.</p>
            </div>
            <button type="button" className="rounded-lg p-1 text-slate-500 hover:bg-white/10" onClick={() => { try { localStorage.setItem(LIMIT_KEY, "1"); } catch { /* */ } setHideLimits(true); }}>
              <Icon name="x" size={16} />
            </button>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {BETA_GRENZEN.map((g) => (
              <li key={g.titel} className="rounded-xl bg-white/5 px-3 py-2">
                <p className="text-[11px] font-bold text-brand-300">{g.titel}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{g.text}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hideList && (
        <div className="rounded-2xl border border-brand-200 bg-white p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">Erste Stunde im Büro</h3>
              <p className="text-[11px] text-slate-500">
                {offen === 0 ? "Checkliste vollständig — Sie können arbeiten." : `${offen} Punkt(e) offen. Nichts wird erfunden.`}
              </p>
            </div>
            <button type="button" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" onClick={() => { try { localStorage.setItem(HIDE_KEY, "1"); } catch { /* */ } setHideList(true); }}>
              <Icon name="x" size={16} />
            </button>
          </div>
          <ol className="mt-3 grid gap-2 sm:grid-cols-5">
            {schritte.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => navigate(s.href)}
                className={`rounded-xl border p-3 text-left ${s.ok ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50 hover:border-brand-300"}`}
              >
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{s.ok ? "erledigt" : "offen"}</p>
                <p className="mt-1 text-xs font-semibold text-slate-800">{s.titel}</p>
                <p className="mt-1 text-[11px] text-slate-500">{s.warum}</p>
              </button>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => navigate("/app/projects")}>Beispielprojekt (Demo)</Button>
            <Button size="sm" variant="ghost" onClick={() => navigate("/app/feedback")}>Feedback</Button>
          </div>
        </div>
      )}
    </div>
  );
}
