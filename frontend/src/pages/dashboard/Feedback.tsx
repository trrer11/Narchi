import { useMemo, useState } from "react";
import { useApp } from "@/store/AppStore";
import { useAuth } from "@/store/AuthStore";
import { Badge, Button, Card, CardHeader, Icon, IconButton, PageHeader, SegmentedControl } from "@/components/ui";
import { FEEDBACK_CATEGORIES, type Feedback as FeedbackItem } from "@/lib/auth";
import { relativeTime } from "@/lib/format";
import { cn } from "@/utils/cn";

const RATING_TONE = ["slate", "rose", "rose", "amber", "amber", "emerald"] as const;

export default function FeedbackView() {
  const { user, isOwner } = useAuth();
  const { route } = useApp();

  const [rating, setRating] = useState(5);
  const [category, setCategory] = useState(FEEDBACK_CATEGORIES[0]);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  const pageLabel = route.path.split("/").pop() ?? "Dashboard";

  const owner = useOwnerInbox();
  const mine = owner.feedback.filter((f) => f.userId === user?.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feedback"
        subtitle={isOwner ? "Rückmeldungen der Architekten-Tester im Überblick" : "Helfen Sie uns, Narchi zu verbessern"}
      />

      {isOwner ? <OwnerInbox owner={owner} /> : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* submit form */}
          <Card>
            <CardHeader title="Feedback senden" subtitle={`Bezogen auf: ${pageLabel}`} />
            <div className="space-y-5 p-5">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bewertung</label>
                <div className="mt-2 flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setRating(n)}
                      className={cn("flex h-11 w-11 items-center justify-center rounded-xl border text-xl transition-all", rating >= n ? "border-brand-300 bg-brand-50 text-brand-500" : "border-slate-200 text-slate-300 hover:bg-slate-50")}
                    >
                      <Icon name="spark" size={20} />
                    </button>
                  ))}
                  <span className="ml-2 text-sm font-semibold text-slate-600">{rating}/5</span>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Kategorie</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30">
                  {FEEDBACK_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Nachricht</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  placeholder="Was funktioniert gut? Was fehlt? Welcher Bug ist aufgetaucht?"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
                />
              </div>
              {sent && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  <Icon name="check" size={16} /> Vielen Dank! Ihr Feedback wurde gesendet.
                </div>
              )}
              <Button
                icon="arrowRight"
                disabled={message.trim().length < 3}
                onClick={() => {
                  owner.submit({ rating, category, page: pageLabel, message });
                  setMessage(""); setRating(5); setSent(true);
                  setTimeout(() => setSent(false), 4000);
                }}
              >
                Feedback senden
              </Button>
            </div>
          </Card>

          {/* my feedback history */}
          <Card>
            <CardHeader title="Mein Feedback" subtitle={`${mine.length} Beitrag/Beiträge`} />
            <div className="p-4">
              {mine.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-slate-400">
                  <Icon name="spark" size={26} className="text-slate-300" />
                  Noch kein Feedback gesendet.
                </div>
              ) : (
                <ul className="space-y-3">
                  {mine.map((f) => <FeedbackCard key={f.id} f={f} owner={false} />)}
                </ul>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function useOwnerInbox() {
  const { feedback, submitFeedback, setFbStatus, removeFeedback } = useAuth();
  return { feedback, submit: submitFeedback, setFbStatus, removeFeedback };
}

function OwnerInbox({ owner }: { owner: ReturnType<typeof useOwnerInbox> }) {
  const [filter, setFilter] = useState<"all" | FeedbackItem["status"]>("all");
  const list = owner.feedback.filter((f) => filter === "all" || f.status === filter);

  const stats = useMemo(() => {
    const total = owner.feedback.length;
    const avg = total ? owner.feedback.reduce((s, f) => s + f.rating, 0) / total : 0;
    const neu = owner.feedback.filter((f) => f.status === "new").length;
    return { total, avg, neu };
  }, [owner.feedback]);

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Feedback gesamt" value={String(stats.total)} icon="spark" tone="amber" />
        <Stat label="Ø Bewertung" value={stats.total ? stats.avg.toFixed(1) + " / 5" : "—"} icon="target" tone="emerald" />
        <Stat label="Neu" value={String(stats.neu)} icon="bell" tone="cyan" />
        <Stat label="Kategorien" value={String(new Set(owner.feedback.map((f) => f.category)).size)} icon="branch" tone="violet" />
      </div>

      <div className="flex items-center justify-between">
        <SegmentedControl
          value={filter}
          onChange={(v) => setFilter(v as "all" | FeedbackItem["status"])}
          options={[
            { value: "all", label: "Alle" },
            { value: "new", label: "Neu" },
            { value: "read", label: "Gelesen" },
            { value: "acknowledged", label: "Erledigt" },
          ]}
        />
        {stats.total > 0 && (
          <Button size="sm" variant="secondary" icon="download" onClick={() => exportCsv(owner.feedback)}>CSV-Export</Button>
        )}
      </div>

      {list.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Icon name="spark" size={26} /></span>
          <p className="font-semibold text-slate-700">Noch kein Feedback</p>
          <p className="max-w-sm text-sm text-slate-400">Sobald ein Architekt Feedback sendet, erscheint es hier.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((f) => (
            <FeedbackCard key={f.id} f={f} owner
              onStatus={(s) => owner.setFbStatus(f.id, s)}
              onDelete={() => owner.removeFeedback(f.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function FeedbackCard({ f, owner, onStatus, onDelete }: {
  f: FeedbackItem;
  owner: boolean;
  onStatus?: (s: FeedbackItem["status"]) => void;
  onDelete?: () => void;
}) {
  const tone = RATING_TONE[f.rating];
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-brand-400">{f.userName.slice(0, 2).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-800">{f.userName}</span>
            <Badge tone={tone}>{f.rating}/5</Badge>
            <Badge tone="slate">{f.category}</Badge>
            {f.page && <span className="text-xs text-slate-400">· {f.page}</span>}
            <span className="text-xs text-slate-400">· {relativeTime(f.createdAt)}</span>
            {owner && f.status === "new" && <Badge tone="amber" dot>Neu</Badge>}
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{f.message}</p>
          {owner && (
            <div className="mt-3 flex items-center gap-1.5">
              {onStatus && f.status !== "read" && <Button size="sm" variant="ghost" icon="check" onClick={() => onStatus("read")}>Gelesen</Button>}
              {onStatus && f.status !== "acknowledged" && <Button size="sm" variant="ghost" icon="shield" onClick={() => onStatus("acknowledged")}>Erledigt</Button>}
              {onDelete && <IconButton icon="x" label="Löschen" onClick={onDelete} />}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function exportCsv(list: FeedbackItem[]) {
  const rows = [["Architekt", "Bewertung", "Kategorie", "Seite", "Status", "Datum", "Nachricht"]];
  for (const f of list) rows.push([f.userName, `${f.rating}/5`, f.category, f.page, f.status, new Date(f.createdAt).toLocaleString("de-DE"), f.message]);
  const csv = "\ufeff" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "narchi-feedback.csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function Stat({ label, value, icon, tone }: { label: string; value: string; icon: Parameters<typeof Icon>[0]["name"]; tone: "cyan" | "emerald" | "amber" | "violet" }) {
  const c = { cyan: "bg-cyan-50 text-cyan-600", emerald: "bg-emerald-50 text-emerald-600", amber: "bg-brand-50 text-brand-600", violet: "bg-violet-50 text-violet-600" }[tone];
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", c)}><Icon name={icon} size={20} /></span>
      <div><div className="font-display text-lg font-bold text-slate-900">{value}</div><div className="text-xs text-slate-500">{label}</div></div>
    </Card>
  );
}
