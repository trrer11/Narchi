/**
 * §50 — Preisbibliothek : la bibliothèque de prix DU BUREAU.
 *
 * Assistant en 3 étapes HONNÊTES (rien d'écrit avant validation explicite) :
 *   1. Datei + Preisstand-Jahr → envoi en /preview (parse, base NON touchée) ;
 *   2. Rapport d'analyse (acceptées/rejetées AVEC raisons) → décision du
 *      bureau (« so übernehmen » ou annuler) ;
 *   3. Import idempotent + rapport final. En dessous : bibliothèque réelle,
 *      recherche, statistiques de provenance (charte §36 : aucun prix sans
 *      millésime ni note d'indexation Destatis).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { secureFetch } from "@/auth/SecuritySanitizer";
import { useAuth } from "@/store/AuthStore";
import { claimLock, fetchLocks, lockBanner, releaseLock, type LockInfo } from "@/lib/collab";
import { Badge, Button, Card, CardHeader, EmptyState, Icon, PageHeader, SearchInput, StatCard } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import {
  beobachtungenLabel,
  eurFromCents,
  hatGemischteJahrgaenge,
  jahrgangText,
  spiegelResponseOf,
  spiegelSubline,
  streuungText,
  SPIEGEL_PATH,
  type SpiegelResponse,
} from "@/lib/priceSpiegel";
import {
  buildChartView,
  DEFAULT_GEOM,
  quarterLabel,
  yoyText,
} from "@/lib/indexChart";
import {
  DESTATIS_WOHNGEBAEUDE,
  INDEX_LATEST,
  INDEX_SOURCE_LABEL,
  indexStandLabel,
} from "@/data/destatisIndex";
import {
  batchDeleteSummary,
  deleteLibraryBatch,
  fetchLibraryStats,
  fetchLibraryVerlauf,
  importOfficePrices,
  importSummary,
  isAcceptedLibraryFile,
  kgCoverageBadge,
  preisstandYearOptions,
  previewOfficePrices,
  purgeOfficePrices,
  searchOfficePrices,
  type ImportCommit,
  type ImportPreview,
  type LibraryStats,
  type LibraryVerlauf,
  type OfficePriceItem,
} from "@/lib/officeLibrary";

type WizardStep = "auswahl" | "vorschau" | "fertig";

export default function Preisbibliothek() {
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [wizardKey, setWizardKey] = useState(0);
  const [purgeArm, setPurgeArm] = useState(false);
  const [purging, setPurging] = useState(false);

  const reloadStats = useCallback(() => {
    setStatsError(null);
    fetchLibraryStats().then(setStats).catch((e) => setStatsError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(reloadStats, [reloadStats, wizardKey]);

  const coverage = stats ? kgCoverageBadge(stats) : null;

  async function handlePurge() {
    if (!purgeArm) { setPurgeArm(true); return; }
    setPurging(true);
    try {
      await purgeOfficePrices();
      setPurgeArm(false);
      setWizardKey((k) => k + 1);
    } finally {
      setPurging(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Preisbibliothek"
        subtitle="Eigene Büro-Einheitspreise importieren (CSV / GAEB X31) — sie ersetzen die Richtwerte im Schnell-Schätzer, Destatis-indexiert auf 2026"
        actions={
          stats && stats.total > 0 ? (
            <Button size="sm" variant={purgeArm ? "primary" : "secondary"} disabled={purging} onClick={handlePurge}>
              {purgeArm ? "Wirklich alles löschen?" : "Bibliothek leeren"}
            </Button>
          ) : undefined
        }
      />

      {statsError && (
        <Card className="border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Bibliothek nicht erreichbar: {statsError}
        </Card>
      )}

      {stats && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Positionen der Bibliothek" value={stats.total} icon="database" tone="emerald"
            sub={Object.keys(stats.by_jahr).length > 0 ? `Preisstände: ${Object.keys(stats.by_jahr).sort().join(", ")}` : "noch leer"} />
          <StatCard label="KG-Abdeckung" value={coverage!.label} icon="gauge" tone="amber"
            sub="für den Schnell-Schätzer nutzbar" />
          <StatCard label="Indexfirma" value="Destatis" icon="scale" tone="sky"
            sub={stats.index_quelle} />
          <StatCard label="Letzter Import" value={stats.letzter_import ? new Date(stats.letzter_import).toLocaleDateString("de-DE") : "—"} icon="refresh" tone="slate"
            sub="Upsert: erneutes Importieren aktualisiert nur" />
        </div>
      )}

      <IndexChartCard />
      <VerlaufCard refreshKey={wizardKey} onChanged={() => setWizardKey((k) => k + 1)} />
      <SpiegelCard refreshKey={wizardKey} />
      <ImportWizard key={wizardKey} onDone={() => setWizardKey((k) => k + 1)} />
      <LibraryTable refreshKey={wizardKey} statsLoaded={stats !== null && stats.total > 0} />
    </div>
  );
}

/* ----------------- §73 V2.6 — Verlauf & Aktualität (historique réel) ----------------- */

function VerlaufCard({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [verlauf, setVerlauf] = useState<LibraryVerlauf | null>(null);
  const [confirmFile, setConfirmFile] = useState<string | null>(null);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [deletedNote, setDeletedNote] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchLibraryVerlauf()
      .then((v) => { if (live) setVerlauf(v); })
      .catch(() => { /* carte bonus : l'erreur est déjà affichée via les stats */ });
    return () => { live = false; };
  }, [refreshKey]);

  // §76 — suppression CHIRURGICALE d'un lot : deux clics armés (doctrine du
  // bouton « Bibliothek leeren »), compte RÉEL du serveur dans la note finale.
  async function handleDeleteBatch(sourceFile: string) {
    if (confirmFile !== sourceFile) { setConfirmFile(sourceFile); return; }
    setBusyFile(sourceFile);
    setDeleteError(null);
    try {
      const result = await deleteLibraryBatch(sourceFile);
      setDeletedNote(batchDeleteSummary(result));
      setConfirmFile(null);
      onChanged(); // recharge stats + verlauf + bibliothèque — rien de caché
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyFile(null);
    }
  }

  // La note de preuve doit survivre même si c'était le DERNIER lot — sinon
  // la carte disparaîtrait avec la confirmation (faux silence).
  if ((!verlauf || verlauf.imports.length === 0) && !deletedNote && !deleteError) return null;

  return (
    <Card>
      <CardHeader
        title="Verlauf & Aktualität"
        subtitle="Echte Import-Historie — Hinweis, kein Fehler: Preise älter als 12 Monate bitte auffrischen; Destatis/BKI werden jährlich fortgeschrieben. Ein einzelnes Los (z. B. ein Testimport) lässt sich gezielt löschen — alle anderen Preise bleiben unberührt."
      />
      {deletedNote && (
        <div className="mx-5 mb-3 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">
          <span aria-hidden>✓</span>
          <span>{deletedNote}</span>
        </div>
      )}
      {deleteError && (
        <div className="mx-5 mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800">
          Löschen fehlgeschlagen: {deleteError}
        </div>
      )}
      {verlauf && verlauf.imports.length > 0 && (
        <>
          {verlauf.veraltet === true && (
            <div className="mx-5 mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
              <span aria-hidden>⚠️</span>
              <span>
                Ihre Büro-Preise sind seit {verlauf.alter_monate ?? "mehr als 12"} Monaten unverändert (älter als 12 Monate).
                Bitte aktuelle Einheitspreise importieren — bis dahin bleibt die Index-Fortschreibung eine Annäherung.
              </span>
            </div>
          )}
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {verlauf.imports.map((b) => (
              <li key={b.source_file} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-xs">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-600 ring-1 ring-slate-200">
                  {b.source_kind.toUpperCase()}
                </span>
                <span className="font-semibold text-slate-800">{b.source_file}</span>
                <span className="text-slate-500">{b.positionen.toLocaleString("de-DE")} Positionen</span>
                <span className="text-slate-500">
                  Preisstand {b.preisstand_von}{b.preisstand_bis !== b.preisstand_von ? `–${b.preisstand_bis}` : ""}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <span className="text-slate-400">
                    zuletzt {b.letzte_aktualisierung ? new Date(b.letzte_aktualisierung).toLocaleDateString("de-DE") : "—"}
                  </span>
                  <Button
                    size="sm"
                    variant={confirmFile === b.source_file ? "primary" : "secondary"}
                    disabled={busyFile !== null}
                    onClick={() => handleDeleteBatch(b.source_file)}
                  >
                    {busyFile === b.source_file
                      ? "Lösche…"
                      : confirmFile === b.source_file
                        ? `Wirklich ${b.positionen.toLocaleString("de-DE")} Positionen löschen?`
                        : "Los löschen"}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/* ----------------- §98 (#6) — Verlaufsgraphik des offiziellen Baupreisindex ----------------- */

function IndexChartCard() {
  // Données = série officielle embarquée (miroir backend, épinglée par
  // tests des DEUX côtés) ; aucune valeur n'est codée dans le graphe.
  const view = buildChartView(DESTATIS_WOHNGEBAEUDE);
  if (!view) return null; // carte muette plutôt qu'un faux graphique
  const g = DEFAULT_GEOM;
  const fmt = (v: number) =>
    v.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const trend = yoyText(INDEX_LATEST, DESTATIS_WOHNGEBAEUDE);

  return (
    <Card>
      <CardHeader
        title="Baupreisindex — Neubau Wohngebäude"
        subtitle={`${INDEX_SOURCE_LABEL} · ${indexStandLabel()} · Quelle: Statistisches Bundesamt (Destatis), GENESIS-Online. Dies ist die Referenzreihe, mit der Ihre Büro-Preise fortgeschrieben werden (Preisstand bis heute) — andere Gebäudearten haben eigene Reihen.`}
      />
      <div className="mx-5 mb-3 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-800 ring-1 ring-sky-100">
          {quarterLabel(INDEX_LATEST.quarter)}: {fmt(INDEX_LATEST.value)}
        </span>
        {trend && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800 ring-1 ring-emerald-100">
            {trend}
          </span>
        )}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500 ring-1 ring-slate-200">
          Achse {view.axisFrom}–{view.axisTo} (nicht ab 0 — angezeigt)
        </span>
      </div>
      <div className="px-5 pb-4">
        <svg
          viewBox={`0 0 ${g.width} ${g.height}`}
          className="w-full"
          role="img"
          aria-label={`Baupreisindex Wohngebäude, ${indexStandLabel()}`}
        >
          {view.yTicks.map((t) => (
            <g key={t.value}>
              <line
                x1={g.padLeft} y1={t.y} x2={g.width - g.padRight} y2={t.y}
                stroke={t.value === view.axisFrom ? "#94a3b8" : "#e2e8f0"}
                strokeWidth={t.value === view.axisFrom ? 1.2 : 1}
              />
              <text
                x={g.padLeft - 6} y={t.y + 3} textAnchor="end"
                className="fill-slate-400" fontSize={9}
              >
                {t.value}
              </text>
            </g>
          ))}
          {view.xTicks.map((t) => (
            <text
              key={t.year} x={t.x} y={g.height - 6} textAnchor="middle"
              className="fill-slate-400" fontSize={9}
            >
              {t.year}
            </text>
          ))}
          <path d={view.linePath} fill="none" stroke="#0284c7" strokeWidth={2} />
          {view.points.map((p) => (
            <circle key={p.point.quarter} cx={p.x} cy={p.y} r={2} fill="#0284c7">
              <title>{`${quarterLabel(p.point.quarter)}: ${fmt(p.point.value)}`}</title>
            </circle>
          ))}
          <circle cx={view.latest.x} cy={view.latest.y} r={3.5} fill="#0f766e" />
          <text
            x={Math.min(view.latest.x, g.width - g.padRight - 46)}
            y={Math.max(view.latest.y - 8, 10)}
            className="fill-teal-700 font-semibold" fontSize={10}
          >
            {fmt(view.latest.point.value)}
          </text>
        </svg>
        <p className="mt-1 text-[10px] leading-snug text-slate-400">
          Vierteljährliche amtliche Reihe (Punkte = Berichtsquartale, Stand s. o.).
          Ein Fortschreiben ersetzt kein aktuelles Angebot — dafür gibt es
          « Angebote » und den Preisspiegel unten.
        </p>
      </div>
    </Card>
  );
}

/* ----------------- §96 — Preisspiegel (observations réelles d'offres) ----------------- */

function SpiegelCard({ refreshKey }: { refreshKey: number }) {
  const [spiegel, setSpiegel] = useState<SpiegelResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    secureFetch(SPIEGEL_PATH)
      .then((res) => {
        if (!res.ok) throw new Error(`Preisspiegel fehlgeschlagen (HTTP ${res.status})`);
        return res.json();
      })
      .then((body) => {
        if (!live) return;
        setSpiegel(spiegelResponseOf(body));
      })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [refreshKey]);

  // Rien à montrer = carte muette plutôt qu'un tableau vide (même doctrine
  // que VerlaufCard) ; l'erreur, elle, s'affiche toujours.
  if (error) {
    return (
      <Card>
        <CardHeader title="Preisspiegel aus Angeboten" />
        <div className="mx-5 mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800">
          {error}
        </div>
      </Card>
    );
  }
  if (!spiegel || spiegel.items.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Preisspiegel aus Angeboten"
        subtitle="Min / Median / Max der echten EP, die per « → Bibliothek » aus geprüften Angeboten übernommen wurden. Angezeigt werden nur Positionen mit mindestens 2 Beobachtungen — eine Einzelbeobachtung ist ein Wert, kein Spiegel."
      />
      <div className="overflow-x-auto border-t border-slate-100">
        <table className="w-full border-collapse text-left">
          <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">OZ</th>
              <th className="px-3 py-2">Kurztext</th>
              <th className="px-3 py-2 text-center">n</th>
              <th className="px-3 py-2 text-right">Min</th>
              <th className="px-3 py-2 text-right">Median</th>
              <th className="px-3 py-2 text-right">Max</th>
              <th className="px-3 py-2 text-right">Streuung</th>
              <th className="px-3 py-2">Letzte Beobachtung</th>
            </tr>
          </thead>
          <tbody>
            {spiegel.items.map((item) => (
              <tr key={item.oz} className="border-t border-slate-100">
                <td className="px-3 py-1.5 font-mono text-[11px] text-slate-700">{item.oz}</td>
                <td className="max-w-56 truncate px-3 py-1.5 text-[11px] text-slate-600" title={item.kurztext}>
                  {item.kurztext || "—"}
                  {item.einheit ? <span className="text-slate-400"> · je {item.einheit}</span> : null}
                </td>
                <td className="px-3 py-1.5 text-center text-[11px] text-slate-500" title={beobachtungenLabel(item.n)}>
                  {item.n}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-[11px] text-slate-600">
                  {eurFromCents(item.minCents)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-[11px] font-semibold text-slate-800">
                  {item.medianCents !== null ? eurFromCents(item.medianCents) : "—"}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-[11px] text-slate-600">
                  {eurFromCents(item.maxCents)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-[10px] text-slate-400">
                  {streuungText(item.minCents, item.medianCents, item.maxCents) ?? "—"}
                </td>
                <td className="px-3 py-1.5 text-[10px] text-slate-500" title={item.latestSource}>
                  {item.latestCompany} · {item.latestJahr} · {eurFromCents(item.latestEpCents)}
                  {/* §97 — Jahrgänge du lot : mélange d'années = marqué
                      honnêtement (valeurs brutes, non indexées). */}
                  <span
                    className={`block ${hatGemischteJahrgaenge(item.minJahr, item.maxJahr) ? "font-semibold text-amber-700" : "text-slate-400"}`}
                  >
                    {jahrgangText(item.minJahr, item.maxJahr)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-5 py-3 text-[10px] leading-snug text-slate-400">
        {spiegel.hinweis}
        {spiegelSubline(spiegel.singleOzCount, spiegel.capped)
          ? ` ${spiegelSubline(spiegel.singleOzCount, spiegel.capped)}.`
          : ""}
      </p>
    </Card>
  );
}

/* ------------------------------ assistant 3 étapes ------------------------------ */

function ImportWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<WizardStep>("auswahl");
  const [file, setFile] = useState<File | null>(null);
  const [jahr, setJahr] = useState<number>(new Date().getFullYear() - 1);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [commit, setCommit] = useState<ImportCommit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileRejected, setFileRejected] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const yearOptions = useMemo(() => preisstandYearOptions(), []);

  // §78 — verrou DOUX réel : un seul collègue importe à la fois (Redis, TTL
  // 15 min côté serveur). Pas un verrou dur : la bannière le dit.
  const { user } = useAuth();
  const LOCK_TARGET = "preisbibliothek-import";
  const [heldBy, setHeldBy] = useState<LockInfo | null>(null);
  const [lockNotice, setLockNotice] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const tick = () => fetchLocks("buero")
      .then((r) => {
        if (!live) return;
        const l = r.locks.find((x) => x.target === LOCK_TARGET && x.owner_id !== user?.id);
        setHeldBy(l ?? null);
      })
      .catch(() => { /* verrou bonus : la bannière disparaît, rien de simulé */ });
    tick();
    const t = setInterval(tick, 10_000);
    return () => { live = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reset() {
    setStep("auswahl");
    setFile(null);
    setPreview(null);
    setCommit(null);
    setError(null);
    setFileRejected(false);
    if (inputRef.current) inputRef.current.value = "";
    void releaseLock("buero", LOCK_TARGET).catch(() => { /* le TTL serveur finit le travail */ });
  }

  function acceptFile(candidate: File | null | undefined) {
    setError(null);
    if (!candidate) return;
    if (!isAcceptedLibraryFile(candidate.name)) {
      setFile(null);
      setFileRejected(true);
      return;
    }
    setFileRejected(false);
    setFile(candidate);
    // §78 — je prends le verrou doux AVANT d'analyser ; refus = bannière collègue
    claimLock("buero", LOCK_TARGET)
      .then((r) => {
        if (!r.acquired && r.held_by) setHeldBy(r.held_by);
        setLockNotice(null);
      })
      .catch(() => setLockNotice("Live-Sperre nicht erreichbar — bitte bei Kollegen rückfragen."));
  }

  async function runPreview() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await previewOfficePrices(file, jahr);
      setPreview(result);
      setStep("vorschau");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importOfficePrices(file, jahr);
      setCommit(result);
      setStep("fertig");
      void releaseLock("buero", LOCK_TARGET).catch(() => {});
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Preise importieren"
        subtitle={`Schritt ${step === "auswahl" ? "1 von 3 · Datei wählen" : step === "vorschau" ? "2 von 3 · Analyse prüfen (nichts gespeichert)" : "3 von 3 · Übernommen"}`}
        action={step !== "auswahl" ? <Button size="sm" variant="secondary" onClick={reset}>Neu starten</Button> : undefined}
      />

      {step === "auswahl" && (
        <div className="space-y-4">
          {heldBy && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              {lockBanner(heldBy)}
            </p>
          )}
          {lockNotice && !heldBy && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              {lockNotice}
            </p>
          )}
          <div
            role="button"
            tabIndex={0}
            aria-label="Datei auswählen oder hierher ziehen"
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center transition hover:border-brand-300 hover:bg-brand-50/40"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); acceptFile(e.dataTransfer.files?.[0]); }}
          >
            <Icon name="upload" size={26} className="text-slate-400" />
            <div className="text-sm font-medium text-slate-700">
              {file ? file.name : "CSV oder GAEB X31 hier ablegen"}
            </div>
            <div className="text-xs text-slate-400">
              Spalten: oz; kurztext; einheit; ep; [jahr] — Trennzeichen ; oder , · Format « 189,50 »
            </div>
            {fileRejected && (
              <Badge tone="rose">Format nicht unterstützt — nur .csv / .txt / .x31 / .xml / .gaeb</Badge>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.txt,.x31,.xml,.gaeb"
            className="hidden"
            onChange={(e) => acceptFile(e.target.files?.[0])}
          />

          {/* §57 — barre de paramètres structurée (retouche utilisateur) :
              le champ année n'est plus un select nu écrasé sous la zone de
              dépôt, mais une carte label+icône+select chic ; le bouton
              d'analyse s'aligne à droite. Textes et logique inchangés. */}
          <div className="flex flex-wrap items-end gap-x-5 gap-y-3 rounded-xl border border-slate-200/80 bg-slate-50/70 px-5 py-4">
            <label className="block text-sm text-slate-600">
              <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <Icon name="calendar" size={13} className="text-brand-600" />
                Preisstand-Jahr
              </span>
              <span className="relative block w-36">
                <select
                  className="h-10 w-full appearance-none rounded-lg border border-slate-300 bg-white pl-3 pr-9 text-sm font-semibold text-slate-900 shadow-sm transition hover:border-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  value={jahr}
                  onChange={(e) => setJahr(Number(e.target.value))}
                >
                  {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                <Icon name="chevronDown" size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              </span>
            </label>
            <p className="max-w-md pb-0.5 text-xs leading-relaxed text-slate-400">
              Aus welchem Jahr stammen die Preise? NARCHI spiegelt sie automatisch mit dem
              offiziellen Destatis-Index auf 2026 hoch (z. B. 2024→2026 ≈ +8,1 %).
              Bei GAEB X31 gilt dieses Jahr für ALLE Positionen (die Norm trägt kein Datum).
            </p>
            <div className="ml-auto flex items-center gap-3">
              <Button icon="search" disabled={!file || busy || heldBy !== null} onClick={runPreview}>
                {busy ? "Analysiere…" : "Analysieren (Vorschau)"}
              </Button>
              {error && <Badge tone="rose">{error}</Badge>}
            </div>
          </div>
        </div>
      )}

      {step === "vorschau" && preview && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Badge tone="emerald">{preview.accepted_count} verwendbar</Badge>
            {preview.rejected_count > 0 && <Badge tone="amber">{preview.rejected_count} abgelehnt (mit Grund)</Badge>}
            <Badge tone="slate">Format: {preview.kind.toUpperCase()}</Badge>
            <Badge tone="slate">Preisstand {preview.preisstand_jahr_effektiv} → indexiert 2026</Badge>
          </div>

          {preview.warnings.map((w) => (
            <p key={w} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{w}</p>
          ))}

          {preview.sample_accepted.length > 0 && (
            <PreviewTable title={`Vorschau übernehmbarer Positionen (${preview.sample_accepted.length}/${preview.accepted_count})`} rows={preview.sample_accepted.slice(0, 8).map((p) => (
              <tr key={p.oz} className="border-b border-slate-100">
                <Td mono>{p.oz}</Td>
                <Td>{p.kurztext}</Td>
                <Td>{p.einheit}</Td>
                <Td right>{formatMoney(p.einheitspreis_netto)}</Td>
                <Td right>{p.preisstand_jahr}</Td>
                <Td>{p.kostengruppe ? <Badge tone="sky">{p.kostengruppe.replace(/^kg(\d{3}).*/, "KG $1")}</Badge> : <Badge tone="slate">ohne KG</Badge>}</Td>
              </tr>
            ))} />
          )}

          {preview.sample_rejected.length > 0 && (
            <PreviewTable title={`Abgelehnte Zeilen — mit Grund (${preview.rejected_count})`} rows={preview.sample_rejected.slice(0, 8).map((r) => (
              <tr key={`${r.row}-${r.oz}`} className="border-b border-slate-100">
                <Td mono>#{r.row}</Td>
                <Td mono>{r.oz}</Td>
                <Td>{r.reason}</Td>
              </tr>
            ))} />
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <Button icon="check" disabled={busy || preview.accepted_count === 0} onClick={runImport}>
              {busy ? "Importiere…" : `${preview.accepted_count} Positionen übernehmen`}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={reset}>Abbrechen</Button>
            {error && <Badge tone="rose">{error}</Badge>}
          </div>
        </div>
      )}

      {step === "fertig" && commit && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Icon name="check" size={18} className="text-emerald-500" />
            <span className="text-sm font-medium text-slate-700">{importSummary(commit)}</span>
          </div>
          {commit.warnings.map((w) => (
            <p key={w} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{w}</p>
          ))}
          {commit.sample_rejected.length > 0 && (
            <PreviewTable title="Endgültig abgelehnt (Auszug)" rows={commit.sample_rejected.slice(0, 5).map((r) => (
              <tr key={`${r.row}-${r.oz}`} className="border-b border-slate-100">
                <Td mono>#{r.row}</Td>
                <Td mono>{r.oz}</Td>
                <Td>{r.reason}</Td>
              </tr>
            ))} />
          )}
          <p className="text-xs text-slate-400">
            Ab sofort verwendet der Schnell-Schätzer diese Büropreise (vor den Richtwerten). Jede Position zeigt ihre Quelle.
            Ab 2 Preisen pro Kostengruppe (gleiche Einheit) rechnet er mit dem Median — ein einzelner Ausreißer zieht die Schätzung nicht; andere Einheiten werden nie vermischt.
          </p>
          <Button variant="secondary" size="sm" onClick={reset}>Weitere Datei importieren</Button>
        </div>
      )}
    </Card>
  );
}

function PreviewTable({ title, rows }: { title: string; rows: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-100">
      <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">{title}</div>
      <table className="w-full border-collapse text-[13px]">
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

function Td({ children, mono, right }: { children: React.ReactNode; mono?: boolean; right?: boolean }) {
  return (
    <td className={`px-3 py-1.5 ${mono ? "font-mono text-xs" : ""} ${right ? "text-right" : ""}`}>{children}</td>
  );
}

/* ------------------------------ bibliothèque ------------------------------ */

function LibraryTable({ refreshKey, statsLoaded }: { refreshKey: number; statsLoaded: boolean }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<OfficePriceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    searchOfficePrices(q, null, 100)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [q, refreshKey]);

  if (!statsLoaded && !loading && items.length === 0 && !error) {
    return (
      <Card>
        <EmptyState icon="database" title="Bibliothek noch leer"
          subtitle="Oben die erste Büro-Preisbibliothek importieren — CSV oder GAEB X31 (Export aus Ihrer AVA-Software)." />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Bibliothèque aktuelle"
        subtitle={`${total} Positionen · Quelle und Preisstand je Zeile (kein Preis ohne Herkunft)`}
        action={<SearchInput value={q} onChange={setQ} placeholder="OZ oder Kurztext suchen…" />}
      />
      {error && <Badge tone="rose">{error}</Badge>}
      {loading ? (
        <p className="py-6 text-center text-sm text-slate-400">Lade…</p>
      ) : items.length === 0 ? (
        <EmptyState icon="search" title="Kein Treffer" subtitle="Recherche anpassen oder zusätzliche Preise importieren." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-3 py-2">OZ</th>
                <th className="px-3 py-2">Kurztext</th>
                <th className="px-3 py-2">Einheit</th>
                <th className="px-3 py-2 text-right">EP netto</th>
                <th className="px-3 py-2 text-right">Stand</th>
                <th className="px-3 py-2">Quelle</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-slate-100">
                  <Td mono>{item.oz}</Td>
                  <Td>
                    <div>{item.kurztext}</div>
                    {item.index_note && (
                      <div className="text-[11px] text-brand-600">{item.index_note} (Destatis)</div>
                    )}
                  </Td>
                  <Td>{item.einheit}</Td>
                  <Td right>{formatMoney(item.einheitspreis_netto)}</Td>
                  <Td right><Badge tone="slate">{item.preisstand_jahr}</Badge></Td>
                  <Td>
                    <span className="text-xs text-slate-400">{item.source_file}</span>
                    {item.kostengruppe && <Badge tone="sky">{item.kostengruppe.replace(/^kg(\d{3}).*/, "KG $1")}</Badge>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > items.length && (
            <p className="pt-2 text-center text-xs text-slate-400">
              {items.length} von {total} angezeigt — Suche eingrenzen für den Rest.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
