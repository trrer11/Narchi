import { useApp } from "@/store/AppStore";
import { useEffect, useMemo, useState } from "react";
import { HONORARZONEN, HONORARZUSAETZE, HONORAR_MODEN, HOAI_LEGAL_NOTE, LEISTUNGSPHASEN } from "@/data/hoai";
import { Disclaimer } from "@/components/Disclaimer";
import { Badge, Button, Card, CardHeader, Icon, PageHeader, ProgressBar } from "@/components/ui";
import { fmtEUR, fmtEUR2 } from "@/lib/hoaiEngine";
import { buildNachtrag, type NachtragGrund } from "@/lib/nachtragEngine";
import {
  addEntscheidung,
  entscheidungenFuerProjekt,
  entscheidungsProtokoll,
  listEntscheidungen,
  makeEntscheidung,
  migriereEntscheidungenProjektId,
  offeneEntscheidungen,
  removeEntscheidung,
  setEntscheidungStatus,
  STATUS_META,
  QUELLE_LABEL,
  type Entscheidung,
  type EntscheidungQuelle,
} from "@/lib/entscheidungsLog";
import {
  addStunden,
  deckungsbeitrag,
  ersetzeStunden,
  ladeStunden,
  ladeStundensatz,
  migriereStundenProjektId,
  setzeStundensatz,
  stundenFuerProjekt,
  stundenNachLp,
  stundenOhneProjekt,
  type StundenEintrag,
} from "@/lib/projektStunden";
import { pullOfficeBlob, pushOfficeBlob } from "@/lib/officeBlobSync";
import { abschlagLpsAusPayload, abschlagPayloadMerken, abschlagToInvoiceLines, abschlagsrechnung } from "@/lib/abschlagsrechnung";
import { createInvoice } from "@/lib/invoices";
import { useToast } from "@/components/Toaster";
import { invoiceBuyerFromProject } from "@/lib/invoiceBuyer";
import { anrechenbareAusKg300400 } from "@/lib/hoaiAnrechenbar";
import { cn } from "@/utils/cn";
import { StundenBruecke } from "@/components/StundenBruecke";
import { downloadHoaiHonorarPdf } from "@/lib/hoaiHonorarPdf";

export default function HoaiHonorar() {
  const { hoaiConfig, setHoaiConfig, hoaiResult: r, navigate, activeProject, costResult } = useApp();
  const toast = useToast();
  const projektId = (activeProject?.id || "").trim();
  const hatProjekt = projektId.length > 0;

  // §176 — Nachtragsmanagement (scope creep → payé). Le delta d'honoraires est
  // calculé à la volée depuis le moteur HOAI réel, jamais stocké.
  const [ntBeschreibung, setNtBeschreibung] = useState("");
  const [ntDelta, setNtDelta] = useState(0);
  const [ntGrund, setNtGrund] = useState<NachtragGrund>("aenderungswunsch");
  const [ntPhasen, setNtPhasen] = useState<number[]>([3, 5]);
  const nachtrag = useMemo(
    () =>
      buildNachtrag({
        baseKosten: hoaiConfig.anrechenbareKosten,
        deltaKosten: ntDelta || 0,
        honorarzone: hoaiConfig.honorarzone,
        zusatzId: hoaiConfig.zusatzId,
        modeId: hoaiConfig.modeId,
        leistungsphasen: ntPhasen,
        beschreibung: ntBeschreibung.trim(),
        grund: ntGrund,
      }),
    [hoaiConfig, ntDelta, ntPhasen, ntBeschreibung, ntGrund],
  );
  const copyNachtrag = async () => {
    try {
      await navigator.clipboard.writeText(nachtrag.begruendung);
      toast.push({ kind: "success", title: "Nachtragsbegründung kopiert" });
    } catch {
      toast.push({ kind: "warn", title: "Kopieren nicht möglich (Sandbox)" });
    }
  };

  // §177 — Entscheidungslog (la piste écrite qui justifie le Nachtrag).
  const [entscheidungen, setEntscheidungen] = useState<Entscheidung[]>(() => listEntscheidungen());
  const [eThema, setEThema] = useState("");
  const [eBeschreibung, setEBeschreibung] = useState("");
  const [eQuelle, setEQuelle] = useState<EntscheidungQuelle>("besprechung");
  const [eVerantwortlich, setEVerantwortlich] = useState("");
  const entsHier = useMemo(
    () => (hatProjekt ? entscheidungenFuerProjekt(entscheidungen, projektId) : []),
    [entscheidungen, hatProjekt, projektId],
  );
  const offen = offeneEntscheidungen(entsHier);
  const speichereEntscheidung = () => {
    if (!hatProjekt) {
      toast.push({ kind: "warn", title: "Kein Projekt — erst unter Projekte anlegen" });
      return;
    }
    if (!eThema.trim()) return;
    const next = addEntscheidung(
      makeEntscheidung({
        projektId,
        thema: eThema.trim(),
        beschreibung: eBeschreibung.trim(),
        status: "vorgeschlagen",
        quelle: eQuelle,
        verantwortlich: eVerantwortlich.trim() || "—",
      }),
    );
    setEntscheidungen(next);
    void pushOfficeBlob("entscheidungen", { items: next });
    setEThema("");
    setEBeschreibung("");
  };
  const copyProtokoll = async () => {
    try {
      await navigator.clipboard.writeText(entscheidungsProtokoll(entsHier, activeProject.name || "Projekt"));
      toast.push({ kind: "success", title: "Entscheidungsprotokoll kopiert" });
    } catch {
      toast.push({ kind: "warn", title: "Kopieren nicht möglich" });
    }
  };

  // §180 — Projektstunden → Deckungsbeitrag (le projet rapporte-t-il ?).
  const [stunden, setStunden] = useState<StundenEintrag[]>(() => ladeStunden());
  const [stundensatz, setStundensatzState] = useState<number>(() => ladeStundensatz());

  useEffect(() => {
    let live = true;
    void (async () => {
      const e = await pullOfficeBlob("entscheidungen");
      if (live && e && !e.empty && Array.isArray(e.payload.items)) {
        let items = e.payload.items as Entscheidung[];
        if (projektId) {
          const m = migriereEntscheidungenProjektId(items, projektId);
          if (m.geaendert > 0) {
            items = m.list;
            void pushOfficeBlob("entscheidungen", { items });
          }
        }
        setEntscheidungen(items);
        try {
          localStorage.setItem("narchi:entscheidungslog", JSON.stringify(items));
        } catch { /* */ }
      } else if (live && projektId) {
        const lokal = listEntscheidungen();
        const m = migriereEntscheidungenProjektId(lokal, projektId);
        if (m.geaendert > 0) {
          setEntscheidungen(m.list);
          try {
            localStorage.setItem("narchi:entscheidungslog", JSON.stringify(m.list));
          } catch { /* */ }
          void pushOfficeBlob("entscheidungen", { items: m.list });
        }
      }
      const s = await pullOfficeBlob("stunden");
      if (live && s && !s.empty) {
        if (Array.isArray(s.payload.eintraege)) {
          let list = s.payload.eintraege as StundenEintrag[];
          if (projektId) {
            const m = migriereStundenProjektId(list, projektId);
            if (m.geaendert > 0) {
              list = m.list;
              void pushOfficeBlob("stunden", { eintraege: list, stundensatz });
            }
          }
          setStunden(ersetzeStunden(list));
        }
        if (typeof s.payload.stundensatz === "number") {
          setStundensatzState(setzeStundensatz(s.payload.stundensatz));
        }
      } else if (live && projektId) {
        const lokal = ladeStunden();
        const m = migriereStundenProjektId(lokal, projektId);
        if (m.geaendert > 0) {
          setStunden(ersetzeStunden(m.list));
          void pushOfficeBlob("stunden", { eintraege: m.list, stundensatz });
        }
      }
      const a = await pullOfficeBlob("abschlag");
      if (live && a && !a.empty && Array.isArray(a.payload.lps)) {
        const lps = (a.payload.lps as unknown[]).filter((n): n is number => typeof n === "number");
        setFakturierteLps(lps);
      }
    })();
    return () => {
      live = false;
    };
  }, [projektId]);
  const [sLp, setSLp] = useState(3);
  const [sStd, setSStd] = useState("");
  const aggr = stundenFuerProjekt(stunden, projektId);
  const deckung = deckungsbeitrag(r.total, aggr.totalStunden, stundensatz);
  const erfasseStunden = () => {
    if (!hatProjekt) {
      toast.push({ kind: "warn", title: "Kein Projekt — erst unter Projekte anlegen" });
      return;
    }
    const h = Number(sStd.replace(",", "."));
    if (!Number.isFinite(h) || h <= 0) return;
    const next = addStunden({ projektId, lp: sLp, stunden: h, datum: new Date().toISOString().slice(0, 10) });
    setStunden(next);
    void pushOfficeBlob("stunden", { eintraege: next, stundensatz });
    setSStd("");
  };
  const changeSatz = (v: string) => {
    const n = Number(v);
    const s = setzeStundensatz(n);
    setStundensatzState(s);
    void pushOfficeBlob("stunden", { eintraege: stunden, stundensatz: s });
  };

  const [abschlagBlob, setAbschlagBlob] = useState<unknown>(null);

  // §182 — Abschlagsrechnung : facturer par Leistungsphase.
  const [fakturierteLps, setFakturierteLps] = useState<number[]>([]);
  const [neueLps, setNeueLps] = useState<number[]>([]);
  const abschlag = abschlagsrechnung(r, fakturierteLps, neueLps);
  const toggleNeueLp = (nr: number) =>
    setNeueLps((prev) => (prev.includes(nr) ? prev.filter((n) => n !== nr) : [...prev, nr]));
  const [rechnungBusy, setRechnungBusy] = useState(false);
  const creerRechnungAusAbschlag = async () => {
    if (!hatProjekt) {
      toast.push({ kind: "warn", title: "Kein Projekt — Abschlag braucht einen Auftrag" });
      return;
    }
    if (hoaiConfig.anrechenbareKosten <= 0) {
      toast.push({ kind: "warn", title: "Keine anrechenbaren Kosten — kein Betrag erfunden" });
      return;
    }
    const lines = abschlagToInvoiceLines(abschlag, neueLps);
    if (lines.length === 0) {
      toast.push({ kind: "warn", title: "Keine Leistungsphase gewählt" });
      return;
    }
    const dest = invoiceBuyerFromProject(activeProject);
    const buyerName = (activeProject.client || "").trim();
    if (!buyerName || buyerName === "-") {
      toast.push({ kind: "warn", title: "Auftraggeber-Name im Projekt fehlt — nichts erfunden" });
      return;
    }
    setRechnungBusy(true);
    try {
      let seller: Record<string, string> = {};
      try {
        const raw = localStorage.getItem("narchi:rechnungen:absender");
        if (raw) seller = JSON.parse(raw) as Record<string, string>;
      } catch { /* leer */ }
      await createInvoice({
        buyer_name: buyerName,
        buyer_street: dest.buyer_street,
        buyer_zip: dest.buyer_zip,
        buyer_city: dest.buyer_city,
        buyer_reference: dest.buyer_reference,
        project_id: projektId,
        seller_name: seller.name || undefined,
        seller_street: seller.street || undefined,
        seller_zip: seller.zip || undefined,
        seller_city: seller.city || undefined,
        seller_vat_id: seller.vat || undefined,
        seller_iban: seller.iban || undefined,
        seller_bic: seller.bic || undefined,
        seller_account_name: seller.kontoInhaber || undefined,
        seller_email: seller.email || undefined,
        seller_contact_name: seller.kontaktName || undefined,
        seller_contact_phone: seller.kontaktTelefon || undefined,
        seller_contact_email: seller.kontaktEmail || undefined,
        notes: [
          dest.note,
          "Aus HOAI-Abschlag erstellt — Beträge und Vertrag prüfen.",
          `Leistungsphasen: ${neueLps.join(", ")}.`,
        ],
        lines,
      });
      toast.push({ kind: "success", title: "Rechnungsentwurf für dieses Projekt angelegt" });
      navigate("/app/rechnungen");
    } catch (e) {
      toast.push({ kind: "warn", title: e instanceof Error ? e.message : "Rechnung nicht angelegt" });
    } finally {
      setRechnungBusy(false);
    }
  };
  const freigebenAbschlag = () => {
    if (!hatProjekt) {
      toast.push({ kind: "warn", title: "Kein Projekt" });
      return;
    }
    const next = Array.from(new Set([...fakturierteLps, ...neueLps]));
    setFakturierteLps(next);
    setNeueLps([]);
    const payload = abschlagPayloadMerken(abschlagBlob, projektId, next);
    setAbschlagBlob(payload);
    void pushOfficeBlob("abschlag", payload);
    toast.push({ kind: "success", title: "Abschlag als fakturiert markiert (dieses Projekt)" });
  };
  const copyAbschlag = async () => {
    try {
      await navigator.clipboard.writeText(abschlag.text);
      toast.push({ kind: "success", title: "Abschlagsrechnung kopiert" });
    } catch {
      toast.push({ kind: "warn", title: "Kopieren nicht möglich" });
    }
  };

  const exportCsv = () => {
    const rows: string[][] = [];
    rows.push(["HOAI-Honorarberechnung", "Leistungsbild Gebäude und Innenräume — Honorartafel 2013 als Orientierung (HOAI 2021: freie Vereinbarung)"]);
    rows.push(["Anrechenbare Kosten (€)", fmtEUR(r.input.anrechenbareKosten)]);
    rows.push(["Honorarzone", String(r.input.honorarzone)]);
    rows.push(["Leistungsphase", "Bezeichnung", "Honorarsatz %", "Betrag (€)"]);
    for (const p of r.phases) rows.push([`LP ${p.nr}`, p.name, (p.satz * 100).toFixed(0) + " %", fmtEUR2(p.betrag)]);
    rows.push(["Netto-Honorar", "", "", fmtEUR2(r.total)]);
    rows.push(["zzgl. MwSt. 19 %", "", "", fmtEUR2(r.mwst)]);
    rows.push(["Brutto-Honorar", "", "", fmtEUR2(r.brutto)]);
    const csv = "\ufeff" + rows.map((row) => row.map((c) => `"${c}"`).join(";")).join("\r\n");
    download(csv, "narchi-hoai-honorar.csv");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="HOAI-Honorar"
        subtitle={hatProjekt
          ? `Honorar für « ${activeProject.name} » — andere Projekte haben eigene Zahlen.`
          : "Kein Projekt — Zahlen gelten nirgends, bis ein Auftrag gewählt ist."}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon="download" onClick={exportCsv}>CSV-Export</Button>
            <Button
              size="sm"
              variant="secondary"
              icon="download"
              onClick={() => downloadHoaiHonorarPdf(r, activeProject?.name || "")}
            >
              PDF Orientierung
            </Button>
          </div>
        }
      />

      <Disclaimer level="orientation" domain="HOAI — Honorartafel 2013 als Vergleich, freie Vereinbarung (Stand 2026)" />
      <StundenBruecke hier="hoai" />

      {hoaiConfig.anrechenbareKosten <= 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Keine anrechenbaren Kosten — Honorar, MwSt und Leistungsphasen sind 0,00 €. Es wird nicht bei 1 € interpoliert. Betrag tippen oder DIN-276-Schätzung übernehmen.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[400px_1fr]">
        {/* INPUT */}
        <div className="space-y-6">
          <Card className="p-5">
            <Label icon="scale">Anrechenbare Kosten</Label>
            <p className="mt-1 text-xs text-slate-400">HOAI-Praxis: KG 300 + 400 (KG 500 nur wenn vertraglich — hier nicht dazugerechnet)</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                value={hoaiConfig.anrechenbareKosten || ""}
                onChange={(e) => setHoaiConfig({ anrechenbareKosten: Number(e.target.value) || 0 })}
                placeholder="0"
                className="h-12 w-full rounded-xl border border-slate-200 px-3 text-lg font-bold text-slate-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
              />
              <span className="shrink-0 text-sm font-semibold text-slate-400">€</span>
            </div>
            <button
              type="button"
              className="mt-3 w-full rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-left text-xs font-semibold text-brand-800 hover:bg-brand-100"
              onClick={() => {
                const n = anrechenbareAusKg300400(costResult.kg300, costResult.kg400);
                if (n <= 0) {
                  toast.push({ kind: "warn", title: "Keine DIN-276-Zahlen — Schätzung zuerst oder Betrag tippen" });
                  return;
                }
                setHoaiConfig({ anrechenbareKosten: n });
                toast.push({
                  kind: "success",
                  title: `KG 300+400 übernommen: ${fmtEUR(n)}`,
                  detail: "Parametrische Schätzung — kein Aufmaß. Vertrag prüfen.",
                });
              }}
            >
              Aus DIN-276-Schätzung übernehmen (KG 300 + 400)
            </button>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[500_000, 1_000_000, 2_500_000].map((v) => (
                <button key={v} onClick={() => setHoaiConfig({ anrechenbareKosten: v })} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200">
                  {fmtEUR(v)}
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <Label icon="gauge">Honorarzone (Anforderungen)</Label>
            <div className="mt-3 space-y-1.5">
              {HONORARZONEN.map((z) => (
                <button
                  key={z.zone}
                  onClick={() => setHoaiConfig({ honorarzone: z.zone })}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-all",
                    hoaiConfig.honorarzone === z.zone ? "border-brand-400 bg-brand-50" : "border-slate-200 hover:border-slate-300"
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold", hoaiConfig.honorarzone === z.zone ? "bg-brand-500 text-ink-950" : "bg-slate-100 text-slate-500")}>{z.zone}</span>
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">Zone {z.zone}</span>
                      <span className="block text-[11px] text-slate-400">{z.name}</span>
                    </span>
                  </span>
                  <span className="font-display text-sm font-bold text-slate-900">{fmtEUR(r.zonenHonorar[z.zone - 1])}</span>
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <Label icon="sliders">Honorarmodus (freie Vereinbarung — Stand 2026)</Label>
            <div className="mt-3 space-y-1.5">
              {HONORAR_MODEN.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setHoaiConfig({ modeId: m.id })}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-all",
                    hoaiConfig.modeId === m.id ? "border-brand-400 bg-brand-50" : "border-slate-200 hover:border-slate-300"
                  )}
                >
                  <span>
                    <span className="block text-sm font-semibold text-slate-800">{m.name}</span>
                    <span className="block text-[11px] text-slate-400">{m.desc}</span>
                  </span>
                  <span className="font-semibold text-brand-600">×{m.factor}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
              <Icon name="shield" size={12} className="mr-1 inline" />{HOAI_LEGAL_NOTE}
            </div>
          </Card>

          <Card className="p-5">
            <Label icon="sliders">Zuschläge</Label>
            <div className="mt-3 space-y-1.5">
              {HONORARZUSAETZE.map((z) => (
                <button
                  key={z.id}
                  onClick={() => setHoaiConfig({ zusatzId: z.id })}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-all",
                    hoaiConfig.zusatzId === z.id ? "border-brand-400 bg-brand-50" : "border-slate-200 hover:border-slate-300"
                  )}
                >
                  <span>
                    <span className="block text-sm font-semibold text-slate-800">{z.name}</span>
                    <span className="block text-[11px] text-slate-400">{z.desc}</span>
                  </span>
                  <span className="font-semibold text-brand-600">×{z.factor}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* RESULTS */}
        <div className="space-y-6">
          <Card className="overflow-hidden bg-ink-950 text-white">
            <div className="bp-grid-fine relative">
              <div className="grid gap-px sm:grid-cols-3">
                <Big label="Netto-Honorar" value={fmtEUR2(r.total)} />
                <Big label="zzgl. MwSt. 19 %" value={fmtEUR2(r.mwst)} />
                <Big label="Brutto-Honorar" value={fmtEUR2(r.brutto)} highlight />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Leistungsphasen" subtitle="Honorarsatz nach Anlage 10 HOAI" action={<Badge tone="slate">8 LP · 100 %</Badge>} />
            <div className="p-5">
              <div className="space-y-3">
                {r.phases.map((p) => (
                  <div key={p.nr} className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 font-mono text-xs font-bold text-slate-600">LP{p.nr}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="truncate text-sm font-medium text-slate-700">{p.name}</span>
                        <span className="ml-2 shrink-0 text-xs font-semibold text-slate-400">{(p.satz * 100).toFixed(0)} %</span>
                      </div>
                      <div className="mt-1"><ProgressBar value={p.satz * 100 * 3.33} color="#f59e0b" /></div>
                    </div>
                    <span className="w-28 shrink-0 text-right font-display text-sm font-bold text-slate-900">{fmtEUR(p.betrag)}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="font-display font-semibold text-slate-900">Honorarvergleich der Zonen</h3>
              <p className="mt-1 text-xs text-slate-400">Spannweite HZ I (min) bis HZ V (max)</p>
              <div className="mt-4 space-y-2.5">
                {HONORARZONEN.map((z) => {
                  const v = r.zonenHonorar[z.zone - 1];
                  const isSel = hoaiConfig.honorarzone === z.zone;
                  return (
                    <div key={z.zone} className={cn("rounded-xl border px-3 py-2", isSel ? "border-brand-300 bg-brand-50/50" : "border-slate-100")}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-slate-600">
                          {isSel && <Icon name="check" size={14} className="text-brand-500" />}
                          HZ {z.zone} · {z.name}
                        </span>
                        <span className={cn("font-bold", isSel ? "text-brand-600" : "text-slate-800")}>{fmtEUR(v)}</span>
                      </div>
                      <div className="mt-1.5"><ProgressBar value={(v / r.zonenHonorar[4]) * 100} color={isSel ? "#f59e0b" : "#cbd5e1"} /></div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="font-display font-semibold text-slate-900">Honorarquote</h3>
              <p className="mt-1 text-xs text-slate-400">Anteil des Honorars an den Baukosten</p>
              <div className="mt-6 flex items-center gap-6">
                <div className="relative flex h-32 w-32 items-center justify-center">
                  <svg className="-rotate-90" width={128} height={128}>
                    <circle cx={64} cy={64} r={54} fill="none" stroke="#eef1f6" strokeWidth={12} />
                    <circle cx={64} cy={64} r={54} fill="none" stroke="#f59e0b" strokeWidth={12} strokeLinecap="round"
                      strokeDasharray={`${(r.input.anrechenbareKosten > 0 ? (r.total / r.input.anrechenbareKosten) * 100 : 0) * 3.39} 999`} />
                  </svg>
                  <span className="absolute font-display text-xl font-bold text-slate-900">{r.input.anrechenbareKosten > 0 ? ((r.total / r.input.anrechenbareKosten) * 100).toFixed(1) : "—"}%</span>
                </div>
                <div className="flex-1 space-y-3 text-sm">
                  <Row label="Baukosten" value={fmtEUR(r.input.anrechenbareKosten)} />
                  <Row label="Honorar (netto)" value={fmtEUR(r.total)} />
                  <Row label="Honorarquote" value={r.input.anrechenbareKosten > 0 ? ((r.total / r.input.anrechenbareKosten) * 100).toFixed(2) + " %" : "—"} accent />
                  <p className="pt-1 text-xs text-slate-400">Gebäudebau: üblich 8–14 % je nach Komplexität.</p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* §176 — Nachtragsmanagement : le scope creep devient PAYÉ, avec Begründung. */}
      <Card>
        <CardHeader
          title="Nachtragsmanagement — Änderungen werden bezahlt"
          subtitle="Auftraggeber ändert den Umfang → Zusatzhonorar aus dem echten HOAI-Rechner, mit Begründung für das Nachtragsangebot."
        />
        <div className="p-5">
          <div className="grid gap-4 lg:grid-cols-3">
            <div>
              <Label icon="spark">Beschreibung der Änderung</Label>
              <input
                type="text"
                value={ntBeschreibung}
                onChange={(e) => setNtBeschreibung(e.target.value)}
                placeholder="z. B. Ausbau des Dachbodens zu Wohnraum"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none"
              />
            </div>
            <div>
              <Label icon="scale">Zusätzliche anrechenbare Kosten (€)</Label>
              <input
                type="number"
                value={ntDelta || ""}
                onChange={(e) => setNtDelta(Number(e.target.value) || 0)}
                placeholder="z. B. 200000"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 focus:border-brand-400 focus:outline-none"
              />
            </div>
            <div>
              <Label icon="flag">Anlass</Label>
              <select
                value={ntGrund}
                onChange={(e) => setNtGrund(e.target.value as NachtragGrund)}
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none"
              >
                <option value="aenderungswunsch">Änderungswunsch des Auftraggebers</option>
                <option value="planungsaenderung">Planungsänderung (Behörde/Norm)</option>
                <option value="zusatzleistung">Zusätzliche Leistung</option>
                <option value="stoerung">Behinderung/Störung</option>
              </select>
            </div>
          </div>

          <div className="mt-4">
            <Label icon="layers">Betroffene Leistungsphasen</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {LEISTUNGSPHASEN.map((p) => {
                const on = ntPhasen.includes(p.nr);
                return (
                  <button
                    key={p.nr}
                    onClick={() =>
                      setNtPhasen((prev) =>
                        on ? prev.filter((n) => n !== p.nr) : [...prev, p.nr],
                      )
                    }
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
                      on ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                    )}
                  >
                    LP {p.nr}
                  </button>
                );
              })}
            </div>
          </div>

          {ntDelta > 0 && (
            <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Icon name="scale" size={16} className="text-emerald-600" />
                  <span className="font-display text-base font-bold text-slate-900">
                    Zusätzliches Honorar: {nachtrag.deltaHonorarNetto.toLocaleString("de-DE")} € netto
                  </span>
                  <span className="text-sm text-slate-500">
                    ({nachtrag.deltaHonorarBrutto.toLocaleString("de-DE")} € brutto · {nachtrag.deltaPct.toLocaleString("de-DE", { maximumFractionDigits: 1 })} % · {nachtrag.phasenAnteilPct.toLocaleString("de-DE", { maximumFractionDigits: 1 })} % der Phasen)
                  </span>
                </div>
                <Button icon="download" variant="secondary" size="sm" onClick={() => void copyNachtrag()}>
                  Begründung kopieren
                </Button>
              </div>
              <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-white p-3 text-xs leading-relaxed text-slate-700">
                {nachtrag.begruendung}
              </pre>
            </div>
          )}
        </div>
      </Card>

      {/* §182 — Abschlagsrechnung : facturer par Leistungsphase (Teilrechnungen). */}
      <Card>
        <CardHeader
          title="Abschlagsrechnung — nach Leistungsphase fakturieren"
          subtitle="Teilrechnungen basierend auf den HOAI-Leistungsphasen (nicht manuell geraten) — klicken Sie die fertigen Phasen, Narchi rechnet."
        />
        <div className="p-5">
          <div className="flex flex-wrap gap-1.5">
            {abschlag.positionen.map((p) => {
              const fertig = fakturierteLps.includes(p.lp);
              const neu = neueLps.includes(p.lp);
              return (
                <button
                  key={p.lp}
                  type="button"
                  disabled={fertig}
                  onClick={() => toggleNeueLp(p.lp)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
                    fertig
                      ? "bg-emerald-100 text-emerald-700"
                      : neu
                        ? "bg-brand-500 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                  )}
                  title={`${p.name} · ${p.satzPct} % · ${p.betragNetto.toLocaleString("de-DE")} €`}
                >
                  LP {p.lp} · {p.satzPct.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %
                  {fertig ? " ✓" : ""}
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Bereits fakturiert</p>
              <p className="font-display text-base font-bold text-slate-900">{abschlag.fakturiertNetto.toLocaleString("de-DE")} € netto</p>
            </div>
            <div className={cn("rounded-xl p-3", abschlag.betragNetto > 0 ? "bg-brand-50" : "bg-slate-50")}>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Diese Abschlagsrechnung</p>
              <p className="font-display text-base font-bold text-brand-700">{abschlag.betragNetto.toLocaleString("de-DE")} € netto</p>
              <p className="text-[11px] text-slate-500">{abschlag.betragBrutto.toLocaleString("de-DE")} € brutto</p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button icon="download" variant="secondary" size="sm" onClick={() => void copyAbschlag()}>Text kopieren</Button>
              <Button icon="scale" variant="secondary" size="sm" onClick={() => void creerRechnungAusAbschlag()} disabled={neueLps.length === 0 || rechnungBusy}>
                → Rechnung (Entwurf)
              </Button>
              <Button icon="check" variant="primary" size="sm" onClick={freigebenAbschlag} disabled={neueLps.length === 0}>Fakturiert merken</Button>
            </div>
          </div>

          {neueLps.length > 0 && (
            <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
              {abschlag.text}
            </pre>
          )}
        </div>
      </Card>

      {/* §177 — Entscheidungslog : la communication client devient une piste. */}
      <Card>
        <CardHeader
          title="Entscheidungslog — wer hat was wann freigegeben"
          subtitle={`${hatProjekt ? activeProject.name + " · " : "Kein Projekt · "}${offen.length} offene Entscheidung(en) — nur dieses Projekt.`}
          action={
            <Button icon="download" variant="secondary" size="sm" onClick={() => void copyProtokoll()}>
              Protokoll kopieren
            </Button>
          }
        />
        <div className="p-5">
          <div className="grid gap-3 md:grid-cols-[1fr_2fr_auto_auto_auto]">
            <input
              type="text"
              value={eThema}
              onChange={(e) => setEThema(e.target.value)}
              placeholder="Thema (z. B. Dachboden)"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none"
            />
            <input
              type="text"
              value={eBeschreibung}
              onChange={(e) => setEBeschreibung(e.target.value)}
              placeholder="Beschreibung der Entscheidung"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none"
            />
            <select
              value={eQuelle}
              onChange={(e) => setEQuelle(e.target.value as EntscheidungQuelle)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none"
            >
              {(Object.keys(QUELLE_LABEL) as EntscheidungQuelle[]).map((q) => (
                <option key={q} value={q}>{QUELLE_LABEL[q]}</option>
              ))}
            </select>
            <input
              type="text"
              value={eVerantwortlich}
              onChange={(e) => setEVerantwortlich(e.target.value)}
              placeholder="Verantw."
              className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none"
            />
            <Button icon="check" variant="primary" size="sm" onClick={speichereEntscheidung}>
              Erfassen
            </Button>
          </div>

          {entsHier.length > 0 ? (
            <ul className="mt-4 divide-y divide-slate-100">
              {entsHier.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">{e.datum}</span>
                      <span className="truncate text-sm font-semibold text-slate-800">{e.thema}</span>
                      <Badge tone={STATUS_META[e.status].tone}>{STATUS_META[e.status].label}</Badge>
                      <span className="text-[11px] text-slate-400">{QUELLE_LABEL[e.quelle]}</span>
                    </div>
                    {e.beschreibung && <p className="mt-0.5 truncate text-xs text-slate-500">{e.beschreibung}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const next = setEntscheidungStatus(e.id, "freigegeben");
                        setEntscheidungen(next);
                        void pushOfficeBlob("entscheidungen", { items: next });
                      }}
                      className="rounded-lg px-2 py-1 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-50"
                    >
                      Freigeben
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = removeEntscheidung(e.id);
                        setEntscheidungen(next);
                        void pushOfficeBlob("entscheidungen", { items: next });
                      }}
                      className="rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-500 hover:bg-rose-50"
                    >
                      Löschen
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-400">Noch keine Entscheidungen erfasst — erfassen Sie die erste, und der Nachtrag darüber hat seine Begründung.</p>
          )}
        </div>
      </Card>

      {/* §180 — Projektstunden → Deckungsbeitrag : le projet rapporte-t-il ? */}
      <Card>
        <CardHeader
          title="Projektstunden & Deckungsbeitrag"
          subtitle={hatProjekt
            ? `Stunden und Deckungsbeitrag für « ${activeProject.name} » — nicht für andere Projekte.`
            : "Kein Projekt gewählt — Stunden würden keinem Auftrag gehören."}
        />
        <div className="p-5">
          <div className="grid gap-3 md:grid-cols-[auto_auto_auto_auto]">
            <div>
              <Label icon="layers">Leistungsphase</Label>
              <select
                value={sLp}
                onChange={(e) => setSLp(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none"
              >
                {LEISTUNGSPHASEN.map((p) => (
                  <option key={p.nr} value={p.nr}>LP {p.nr} — {p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label icon="clock">Stunden (z. B. 2,5)</Label>
              <input
                type="text"
                value={sStd}
                onChange={(e) => setSStd(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && erfasseStunden()}
                placeholder="2,5"
                className="mt-1 w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none"
              />
            </div>
            <div>
              <Label icon="scale">Stundensatz (€/h)</Label>
              <input
                type="number"
                value={stundensatz}
                onChange={(e) => changeSatz(e.target.value)}
                className="mt-1 w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none"
              />
            </div>
            <div className="flex items-end">
              <Button icon="check" variant="primary" size="sm" onClick={erfasseStunden}>Erfassen</Button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Honorar netto</p>
              <p className="font-display text-lg font-bold text-slate-900">{fmtEUR(r.total)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Aufwand (Stunden × Satz)</p>
              <p className="font-display text-lg font-bold text-slate-900">
                {aggr.totalStunden.toLocaleString("de-DE", { maximumFractionDigits: 1 })} h · {deckung.aufwandEuro.toLocaleString("de-DE")} €
              </p>
            </div>
            <div className={cn("rounded-xl p-4", deckung.deckungsbeitrag >= 0 ? "bg-emerald-50" : "bg-rose-50")}>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Deckungsbeitrag</p>
              <p className={cn("font-display text-lg font-bold", deckung.deckungsbeitrag >= 0 ? "text-emerald-700" : "text-rose-700")}>
                {deckung.deckungsbeitrag >= 0 ? "+" : "−"}{Math.abs(deckung.deckungsbeitrag).toLocaleString("de-DE")} €
              </p>
              {deckung.realisationPct !== null && (
                <p className="text-[11px] text-slate-500">{deckung.realisationPct.toLocaleString("de-DE", { maximumFractionDigits: 0 })} % des Honorars verbraucht</p>
              )}
            </div>
          </div>

          {aggr.totalStunden > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Stunden nach Leistungsphase</p>
              <ul className="mt-2 divide-y divide-slate-100">
                {stundenNachLp(aggr.perLp).map((x) => (
                  <li key={x.lp} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-slate-600">LP {x.lp} · {x.name}</span>
                    <span className="font-semibold text-slate-900">{x.stunden.toLocaleString("de-DE", { maximumFractionDigits: 1 })} h</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  if (!hatProjekt) return;
                  const next = ersetzeStunden(stundenOhneProjekt(stunden, projektId));
                  setStunden(next);
                  void pushOfficeBlob("stunden", { eintraege: next, stundensatz });
                }}
                className="mt-2 text-xs font-semibold text-slate-400 hover:text-rose-500"
              >
                Stunden dieses Projekts löschen
              </button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function download(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function Label({ icon, children }: { icon: Parameters<typeof Icon>[0]["name"]; children: React.ReactNode }) {
  return <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400"><Icon name={icon} size={14} /> {children}</div>;
}
function Big({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-white/[0.03] p-6 backdrop-blur">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={cn("mt-1 font-display font-bold", highlight ? "text-2xl text-brand-300" : "text-xl text-white")}>{value}</div>
    </div>
  );
}
function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <div className="flex items-center justify-between"><span className="text-slate-500">{label}</span><span className={cn("font-display font-bold", accent ? "text-brand-600" : "text-slate-900")}>{value}</span></div>;
}
void LEISTUNGSPHASEN;
