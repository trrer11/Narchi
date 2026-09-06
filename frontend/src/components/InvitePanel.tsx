import { useCallback, useEffect, useState } from "react";
import { Button, Card, Icon, IconButton } from "@/components/ui";
import { secureFetch } from "@/auth/SecuritySanitizer";

// §68 — Panneau « Einladungslink » : invite un testeur/collègue par LIEN
// SIGNÉ (72 h, usage unique, révocable). Le jeton est créé côté serveur,
// le compte de l'invité rejoint CET Arbeitsraum (même tenant). Aucune
// donnée inventée : la liste ci-dessous vient du serveur, états réels.
type InviteItem = {
  id: string;
  invited_email: string | null;
  created_at: string | null;
  expires_at: string;
  used_at: string | null;
  used_by_email: string | null;
  revoked_at: string | null;
  state: "offen" | "benutzt" | "abgelaufen" | "widerrufen";
};

const STATE_META: Record<InviteItem["state"], { label: string; cls: string }> = {
  offen: { label: "Offen", cls: "bg-emerald-50 text-emerald-700" },
  benutzt: { label: "Benutzt", cls: "bg-sky-50 text-sky-700" },
  abgelaufen: { label: "Abgelaufen", cls: "bg-amber-50 text-amber-700" },
  widerrufen: { label: "Widerrufen", cls: "bg-rose-50 text-rose-700" },
};

// Lit le « detail » FastAPI (chaîne) sans casser sur les autres formats.
async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.clone().json();
    if (body && typeof body.detail === "string") return body.detail;
  } catch {
    /* corps non JSON */
  }
  return fallback;
}

export default function InvitePanel() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InviteItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await secureFetch("/api/v5/invites");
      if (!res.ok) throw new Error(await readApiError(res, "Einladungen konnten nicht geladen werden."));
      setItems((await res.json()) as InviteItem[]);
      setError(null);
    } catch (err) {
      setItems(null);
      setError(err instanceof Error ? err.message : "Ladefehler.");
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const createLink = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await secureFetch("/api/v5/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error(await readApiError(res, "Einladung konnte nicht erstellt werden."));
      const body = (await res.json()) as { invite_path: string };
      setLink(`${window.location.origin}${body.invite_path}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Erstellen.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      const res = await secureFetch(`/api/v5/invites/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(await readApiError(res, "Widerruf fehlgeschlagen."));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Widerruf fehlgeschlagen.");
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Zwischenablage nicht verfügbar — Link bitte manuell kopieren.");
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-300 hover:shadow"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-brand-400">
          <Icon name="users" size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-900">Einladungslink erstellen</span>
          <span className="block truncate text-xs text-slate-500">
            Testeur per Link einladen — Konto landet direkt in DIESEM Arbeitsraum (72 h gültig)
          </span>
        </span>
        <Icon name="chevronRight" size={16} className="shrink-0 text-slate-300" />
      </button>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 text-brand-400">
            <Icon name="users" size={17} />
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Einladungslink</h3>
            <p className="text-xs text-slate-500">Signiert · 72 h gültig · einmalig verwendbar · jederzeit widerrufbar</p>
          </div>
        </div>
        <IconButton icon="chevronDown" label="Schließen" onClick={() => setOpen(false)} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" icon="spark" onClick={() => void createLink()} disabled={busy}>
          {busy ? "Erstellen…" : "Neuen Link erstellen"}
        </Button>
        {link && (
          <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 font-mono text-[11px] text-slate-600">{link}</code>
        )}
        {link && (
          <Button size="sm" variant="secondary" icon={copied ? "check" : "download"} onClick={() => void copy()}>
            {copied ? "Kopiert ✓" : "Kopieren"}
          </Button>
        )}
      </div>

      {error && (
        <p className="mt-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <Icon name="alert" size={13} /> {error}
        </p>
      )}

      {items && items.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100">
          {items.map((item) => {
            const meta = STATE_META[item.state] ?? STATE_META.offen;
            return (
              <li key={item.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.cls}`}>{meta.label}</span>
                <span className="min-w-0 flex-1 truncate text-slate-600">
                  {item.used_by_email || item.invited_email || item.id}
                </span>
                <span className="shrink-0 text-slate-400">
                  bis {new Date(item.expires_at).toLocaleDateString("de-DE")}
                </span>
                {item.state === "offen" && (
                  <IconButton icon="x" label="Widerrufen" onClick={() => void revoke(item.id)} className="text-rose-400 hover:text-rose-600" />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {items && items.length === 0 && (
        <p className="mt-3 text-xs text-slate-400">Noch keine Einladungen — der erste Link erscheint hier.</p>
      )}
    </Card>
  );
}
