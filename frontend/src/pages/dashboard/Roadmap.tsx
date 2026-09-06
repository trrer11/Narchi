import { Badge, Card, Icon, PageHeader } from "@/components/ui";
import { cn } from "@/utils/cn";

/**
 * §201 — page HONNÊTE. Plus de Vercel/Supabase/« 2.384 Stückpreise » /
 * « 78 % Beta bereit » : le produit est déjà self-host Docker + Postgres
 * + WS. Les % ci-dessous sont des JALONS de récit, pas une mesure.
 * Readiness beta pondérée documentée : ~74 % (docs/REPRISE_2026-08-16.md).
 */
interface Milestone {
  pct: string;
  title: string;
  status: "done" | "next" | "future";
  items: { label: string; done: boolean; note?: string }[];
}

const MILESTONES: Milestone[] = [
  {
    pct: "Livré (self-host)",
    title: "Cœur métier déjà dans NARCHI",
    status: "done",
    items: [
      { label: "DIN 276 Kostenschätzung + Preisbibliothek + Destatis", done: true },
      { label: "HOAI + Nachtrag + Abschlag + Stunden (UI ; persistance souvent locale)", done: true },
      { label: "IFC-Parser navigateur + visionneuse + VE-Studio CO₂/€", done: true },
      { label: "E-Rechnung KoSIT + ZUGFeRD + UBL + .eml (pas Peppol réseau)", done: true },
      { label: "Chat, CRDT, Baustelle, synchro projets/Mängel/médias", done: true },
      { label: "Stack Docker (Postgres, nginx, FastAPI) — pas Vercel, pas Supabase", done: true },
      { label: "E2E Playwright 5/5 mesuré chez le client (23/08/2026, 33,8 s)", done: true },
    ],
  },
  {
    pct: "Beta encadrée",
    title: "Ce qui manque encore pour 3–5 bureaux amis",
    status: "next",
    items: [
      { label: "Téléphone HTTPS : abandonné comme jalon (§206) — WhatsApp → Baustelle", done: true, note: "plus prioritaire" },
      { label: "2 bureaux pilotes + contrat relu par un avocat", done: false },
      { label: "Abschlag + Arbeitszeit + Kalender : miroir office-blob (§210–§211)", done: true },
      { label: "Impressum / Datenschutz / AGB im UI (#/impressum) — Entwurf, Platzhalter, kein Anwalt", done: true, note: "§209" },
    ],
  },
  {
    pct: "Plus tard",
    title: "Hors périmètre actuel (dit, pas vendu)",
    status: "future",
    items: [
      { label: "Peppol Access Point (docs/PEPPOL.md)", done: false },
      { label: "Pentest externe", done: false },
      { label: "Licence BKI officielle / certification GEG tierce", done: false },
      { label: "Österreich / Schweiz (ÖNORM / SIA)", done: false },
    ],
  },
];

const STATUS_META = {
  done: { label: "Geliefert", tone: "emerald" as const, color: "#10b981", icon: "check" as const },
  next: { label: "Als Nächstes", tone: "amber" as const, color: "#f59e0b", icon: "bolt" as const },
  future: { label: "Später", tone: "slate" as const, color: "#94a3b8", icon: "clock" as const },
};

export default function Roadmap() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Roadmap"
        subtitle="Was NARCHI wirklich liefert — und was noch offen ist. Keine Marketing-Prozente."
      />

      <Card className="overflow-hidden border-brand-200 bg-gradient-to-br from-brand-50 to-white">
        <div className="grid gap-4 p-6 lg:grid-cols-4">
          <div className="lg:col-span-1">
            <div className="font-display text-4xl font-bold text-brand-600">~74 %</div>
            <div className="text-sm text-slate-500">Beta-Readiness (gewichtet, Stand 16.08.2026)</div>
            <Badge tone="amber" dot className="mt-2">
              GO eingekreist — keine 100 %-Marke
            </Badge>
          </div>
          <div className="lg:col-span-3 space-y-2">
            <p className="text-sm font-semibold text-slate-800">Was diese Zahl ist — und was nicht</p>
            <p className="text-xs leading-relaxed text-slate-500">
              Sie kommt aus <code>docs/REPRISE_2026-08-16.md</code> (Gitter mit Gewichten). Sie ist{" "}
              <strong>kein</strong> Fortschrittsbalken und kein Verkaufsargument. Self-Host läuft bereits
              (Docker, nicht Vercel). Echte Mehrgeräte-Sync läuft bereits (nicht « bald Supabase »).
              Eine inventierte Stückpreisliste « 2.384 Berliner Preise » existiert nicht.
            </p>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        {MILESTONES.map((m, idx) => {
          const meta = STATUS_META[m.status];
          return (
            <Card key={idx} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
                    style={{ background: meta.color }}
                  >
                    <Icon name={meta.icon} size={18} />
                  </span>
                  <div>
                    <h3 className="font-display text-base font-bold text-slate-900">{m.title}</h3>
                    <p className="text-[11px] text-slate-400">{m.pct}</p>
                  </div>
                </div>
                <Badge tone={meta.tone} dot>
                  {meta.label}
                </Badge>
              </div>
              <div className="divide-y divide-slate-50">
                {m.items.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-2.5">
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]",
                        item.done ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-400",
                      )}
                    >
                      {item.done ? "✓" : "○"}
                    </span>
                    <span className={cn("flex-1 text-sm", item.done ? "text-slate-600" : "text-slate-700")}>
                      {item.label}
                    </span>
                    {item.note && (
                      <span className="text-[10px] font-semibold text-amber-700">{item.note}</span>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="border-amber-200 bg-amber-50/50 p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <Icon name="alert" size={20} />
          </span>
          <div>
            <h4 className="font-display font-bold text-slate-900">Ehrliche Einschätzung</h4>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              NARCHI ist ein <strong>self-gehostetes</strong> Büro-Werkzeug, kein SaaS auf Vercel.
              Der nächste sinnvolle Schritt ist kein « Backend deployen für 15 €/Monat » — das Backend
              läuft schon — sondern echte Pilotbüros. Fotos: Messenger, Import am Schreibtisch.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
