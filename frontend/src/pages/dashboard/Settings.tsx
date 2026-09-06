import { useEffect, useRef, useState } from "react";
import { useApp } from "@/store/AppStore";
import { useAuth } from "@/store/AuthStore";
import { Button, Badge, Card, CardHeader, Icon, PageHeader, SegmentedControl, Toggle, sourceStatusMeta } from "@/components/ui";
import { formatNumber, relativeTime } from "@/lib/format";
import { fetchBranding, fileToDataUrl, saveBranding, validateLogoFile, type OfficeBranding } from "@/lib/branding";
import { updateMyProfile } from "@/lib/members";
import { pullOfficeBlob, pushOfficeBlob } from "@/lib/officeBlobSync";
import { EMPTY_LEGAL, legalIsFilled, parseOfficeLegal, type OfficeLegal } from "@/lib/officeLegal";

export default function Settings() {
  const { settings, updateSettings, sources } = useApp();
  const { user } = useAuth();
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => Object.fromEntries(sources.map((s) => [s.id, s.status !== "error"])));

  return (
    <div className="space-y-6">
      <PageHeader title="Einstellungen" subtitle="Profil, Anzeige und Büro-Branding — keine Cloud-Quellen nötig" />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* profile */}
        <Card className="p-6 lg:col-span-1">
          <div className="flex flex-col items-center text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-ink-900 text-2xl font-bold text-brand-400">{(user?.name ?? "N").slice(0, 1)}</span>
            <h3 className="mt-4 font-display text-lg font-semibold text-slate-900">{user?.name}</h3>
            <p className="text-sm text-slate-500">{user?.company ?? "—"}</p>
            <Badge tone={user?.role === "owner" ? "emerald" : "cyan"} dot className="mt-2">{user?.role === "owner" ? "Inhaber" : "Architekt"}</Badge>
          </div>
          <dl className="mt-6 divide-y divide-slate-100 border-t border-slate-100 text-sm">
            <Row label="E-Mail" value={user?.email ?? "—"} />
            <Row label="Konto angelegt" value={user ? relativeTime(user.createdAt) : "—"} />
            <Row label="Letzte Anmeldung" value={user?.lastLogin ? relativeTime(user.lastLogin) : "—"} />
          </dl>
          <ProfileNameSection />
          <PasswordSection />
        </Card>

        <div className="space-y-6 lg:col-span-2">
          {/* preferences */}
          <Card>
            <CardHeader title="Anzeige" subtitle="Nur lokale Vorlieben dieses Browsers" />
            <div className="divide-y divide-slate-100">
              <PrefRow title="CO₂ anzeigen" desc="Inkarniertes CO₂ in Tabellen und Karten hervorheben." >
                <Toggle checked={settings.carbonDisplay} onChange={(v) => updateSettings({ carbonDisplay: v })} />
              </PrefRow>
              <PrefRow title="Automatischer Abgleich" desc="Quellen alle 15 Minuten abgleichen (best effort).">
                <Toggle checked={settings.autoSync} onChange={(v) => updateSettings({ autoSync: v })} />
              </PrefRow>
              <PrefRow title="Benachrichtigungen" desc="Hinweise bei Konflikt oder Abweichung.">
                <Toggle checked={settings.notifications} onChange={(v) => updateSettings({ notifications: v })} />
              </PrefRow>
              <PrefRow title="Maßeinheit" desc="Metrisch (empfohlen) oder imperial.">
                <SegmentedControl
                  value={settings.densityUnit}
                  onChange={(v) => updateSettings({ densityUnit: v })}
                  options={[{ value: "metric", label: "Metrisch" }, { value: "imperial", label: "Imperial" }]}
                />
              </PrefRow>
              <PrefRow title="Währung" desc="Anzeige der Kosten — keine Umrechnung erfunden.">
                <SegmentedControl
                  value={settings.currency}
                  onChange={(v) => updateSettings({ currency: v })}
                  options={[{ value: "EUR", label: "€ EUR" }, { value: "USD", label: "$ USD" }, { value: "GBP", label: "£ GBP" }]}
                />
              </PrefRow>
            </div>
          </Card>

          {/* §77 — Büro-Branding : « PDF mit meinem Logo » (V1.2 waw) */}
          <BrandingSection />
          <LegalSection />
          <PasskeySection />
          <Card className="p-5">
            <h3 className="font-display font-semibold text-slate-900">XRechnung-Absender</h3>
            <p className="mt-1 text-sm text-slate-500">
              USt-IdNr, IBAN und Kontakt liegen unter Rechnungen → Büro-Stammdaten (eine Akte fürs ganze Büro, nicht nur dieser Browser).
            </p>
          </Card>

          {/* data sources */}
          <Card>
            <CardHeader title="Datenquellen" subtitle="Nur angeschlossene Quellen — leere Liste = keine Cloud-Anbindung erfunden" action={<Badge tone="slate">{sources.length} Quellen</Badge>} />
            {sources.length === 0 && (
              <p className="px-5 pb-4 text-sm text-slate-500">Keine Fremdquelle. Der Stack (Postgres) ist die Büroquelle — kein Demo-Marktplatz.</p>
            )}
            <ul className="divide-y divide-slate-100">
              {sources.map((s) => {
                const meta = sourceStatusMeta(s.status);
                return (
                  <li key={s.id} className="flex items-center gap-3 px-5 py-3.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Icon name="database" size={18} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-slate-800">{s.name}</p>
                        <Badge tone={meta.tone} dot>{meta.label}</Badge>
                      </div>
                      <p className="text-xs text-slate-400">{s.kind} · {formatNumber(s.records)} Sätze · {relativeTime(s.lastSync)}</p>
                    </div>
                    <Toggle checked={enabled[s.id] ?? true} onChange={(v) => setEnabled((p) => ({ ...p, [s.id]: v }))} label={`${s.name} aktiv`} />
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* about */}
          <Card className="flex items-center justify-between p-5">
            <div>
              <h3 className="font-display font-semibold text-slate-900">NARCHI Self-Host</h3>
              <p className="text-sm text-slate-500">Kein SaaS-Build, keine eu-west-Region — Stack auf diesem Rechner.</p>
            </div>
            <Badge tone="emerald" dot>Lokal</Badge>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function PrefRow({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div>
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-xs text-slate-500">{desc}</p>
      </div>
      {children}
    </div>
  );
}

function PasswordSection() {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (next !== confirm) { setMsg({ ok: false, text: "Die Passwörter stimmen nicht überein." }); return; }
    setBusy(true);
    try {
      await changePassword(current, next);
      setMsg({ ok: true, text: "Passwort erfolgreich geändert." });
      setCurrent(""); setNext(""); setConfirm("");
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Fehler." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-6 rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400"><Icon name="lock" size={14} /> Passwort ändern</div>
      <div className="mt-3 space-y-2.5">
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Aktuelles Passwort" required className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30" />
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Neues Passwort" required minLength={6} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30" />
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Neues Passwort bestätigen" required minLength={6} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30" />
      </div>
      {msg && <p className={`mt-2 text-xs ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</p>}
      <Button type="submit" size="sm" className="mt-3 w-full" disabled={busy}>{busy ? "Speichert…" : "Passwort ändern"}</Button>
    </form>
  );
}

/* §77 — Büro-Branding : logo + nom sur le PDF Kostenschätzung. Serveur =
   seule vérité (octets magiques, 512 ko, owner) ; ici : miroir + gardes-fous. */
function PasskeySection() {
  const [items, setItems] = useState<{ id: string; device_name: string | null }[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { secureFetch } = await import("@/auth/SecuritySanitizer");
    const r = await secureFetch("/api/v5/auth/passkeys/");
    if (!r.ok) return;
    const d = await r.json();
    setItems(Array.isArray(d.items) ? d.items : []);
  };

  useEffect(() => {
    void load();
  }, []);

  const register = async () => {
    setBusy(true);
    setNote("");
    try {
      const { passkeysSupported, publicKeyFromOptions, credentialToJson } = await import("@/lib/passkeys");
      const { secureFetch } = await import("@/auth/SecuritySanitizer");
      if (!passkeysSupported()) {
        setNote("Dieser Browser unterstützt keine Passkeys.");
        return;
      }
      const opt = await secureFetch("/api/v5/auth/passkeys/register/options", { method: "POST" });
      if (!opt.ok) {
        setNote("Optionen nicht verfügbar — eingeloggt?");
        return;
      }
      const opts = await opt.json();
      const cred = (await navigator.credentials.create({
        publicKey: publicKeyFromOptions(opts),
      })) as PublicKeyCredential | null;
      if (!cred) {
        setNote("Abgebrochen.");
        return;
      }
      const ver = await secureFetch("/api/v5/auth/passkeys/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: credentialToJson(cred), device_name: navigator.platform || "Gerät" }),
      });
      if (!ver.ok) {
        const p = await ver.json().catch(() => null) as { detail?: string } | null;
        setNote(p?.detail || `Registrierung abgelehnt (${ver.status}).`);
        return;
      }
      setNote("Passkey gespeichert.");
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Fehler.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const { secureFetch } = await import("@/auth/SecuritySanitizer");
    await secureFetch(`/api/v5/auth/passkeys/${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <div className="mt-6 rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <Icon name="lock" size={14} /> Passkeys
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Windows Hello / Edge auf localhost. Ohne HTTPS oft nur localhost — LAN gesagt.
      </p>
      <ul className="mt-2 space-y-1 text-xs text-slate-700">
        {items.length === 0 && <li>Kein Passkey hinterlegt.</li>}
        {items.map((it) => (
          <li key={it.id} className="flex items-center justify-between">
            <span>{it.device_name || it.id.slice(0, 8)}</span>
            <button type="button" className="text-rose-600" onClick={() => void remove(it.id)}>Entfernen</button>
          </li>
        ))}
      </ul>
      {note && <p className="mt-2 text-xs text-slate-600">{note}</p>}
      <Button type="button" size="sm" className="mt-3 w-full" disabled={busy} onClick={() => void register()}>
        {busy ? "…" : "Passkey hinzufügen"}
      </Button>
    </div>
  );
}

function BrandingSection() {
  const { user } = useAuth();
  const canEdit = user?.role === "owner";
  const [branding, setBranding] = useState<OfficeBranding | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  // undefined = inchangé ; null = « entfernen » demandé ; string = nouveau data-URL
  const [pendingLogo, setPendingLogo] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    fetchBranding()
      .then((b) => { if (!live) return; setBranding(b); setDraftName(b.office_name ?? ""); })
      .catch((e) => { if (live) setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, []);

  async function onPick(file: File | null | undefined) {
    if (!file) return;
    const problem = validateLogoFile(file);      // même esprit que le serveur
    if (problem) { setError(problem); setNote(null); return; }
    setError(null);
    setPendingLogo(await fileToDataUrl(file));
  }

  async function onSave() {
    setBusy(true); setError(null); setNote(null);
    try {
      const result = await saveBranding({
        officeName: draftName.trim() || null,
        logoDataUrl: pendingLogo === undefined ? (branding?.logo?.data_url ?? null) : pendingLogo,
      });
      setBranding(result);
      setDraftName(result.office_name ?? "");
      setPendingLogo(undefined);
      setNote("Gespeichert — erscheint ab dem nächsten PDF-Export auf dem Deckblatt.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const shownLogo = pendingLogo !== undefined ? pendingLogo : (branding?.logo?.data_url ?? null);
  const dirty = draftName.trim() !== (branding?.office_name ?? "") || pendingLogo !== undefined;

  return (
    <Card>
      <CardHeader
        title="Büro-Branding"
        subtitle="Logo und Büroname erscheinen auf dem PDF-Kostenbericht: Logo oben auf dem Deckblatt, der Büroname als großer Titel und im Kopf jeder Seite — NARCHI bleibt nur diskret im Fuß („erstellt mit NARCHI“). Serverseitig fürs ganze Büro; nur PNG/JPEG bis 512 kB. Ohne Angaben bleibt der Bericht unverändert — nichts wird vorgetäuscht."
      />
      {loadError && (
        <p className="px-5 pb-3 text-xs font-semibold text-rose-600">Branding nicht erreichbar: {loadError}</p>
      )}
      <div className="flex flex-wrap items-start gap-5 px-5 pb-5">
        <div className="flex h-20 w-40 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-200 bg-slate-50">
          {shownLogo ? (
            <img src={shownLogo} alt="Büro-Logo Vorschau" className="max-h-16 max-w-36 object-contain" />
          ) : (
            <span className="px-2 text-center text-[11px] text-slate-400">kein Logo hinterlegt</span>
          )}
        </div>
        <div className="min-w-56 flex-1 space-y-3">
          <label className="block text-sm text-slate-600">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Büroname (Deckblatt)</span>
            <input
              value={draftName}
              maxLength={120}
              disabled={!canEdit || busy}
              onChange={(e) => { setDraftName(e.target.value); setNote(null); }}
              placeholder="z. B. Atelier Müller"
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30 disabled:bg-slate-50"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" icon="upload" disabled={!canEdit || busy} onClick={() => inputRef.current?.click()}>
              Logo wählen…
            </Button>
            {shownLogo && (
              <Button size="sm" variant="secondary" disabled={!canEdit || busy} onClick={() => { setPendingLogo(null); setNote(null); }}>
                Logo entfernen
              </Button>
            )}
            <Button size="sm" disabled={!canEdit || busy || !dirty} onClick={onSave}>
              {busy ? "Speichert…" : "Speichern"}
            </Button>
          </div>
          {!canEdit && (
            <p className="text-[11px] text-slate-400">Nur der Büro-Eigentümer (owner) kann das Branding ändern — sichtbar für alle.</p>
          )}
          {branding?.updated_at && (
            <p className="text-[11px] text-slate-400">
              Zuletzt geändert: {new Date(branding.updated_at).toLocaleString("de-DE")}
            </p>
          )}
          {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
          {note && <p className="text-xs font-semibold text-emerald-600">{note}</p>}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => { void onPick(e.target.files?.[0]); e.currentTarget.value = ""; }}
      />
    </Card>
  );
}

/* §80 — self-service de l'invité : changer son NOM (persisté serveur).
   L'affichage des autres écrans se rafraîchit au prochain chargement
   de session — dit honnêtement au lieu de prétendre une synchro magique. */
function ProfileNameSection() {
  const { user } = useAuth();
  const [draft, setDraft] = useState(user?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = draft.trim() !== (user?.name ?? "") && draft.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await updateMyProfile({ name: draft.trim() });
      setMsg({ ok: true, text: "Name gespeichert — Anzeige aktualisiert sich beim nächsten Laden." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Fehler." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <Icon name="users" size={14} /> Name ändern
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          maxLength={120}
          onChange={(e) => { setDraft(e.target.value); setMsg(null); }}
          className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
        />
        <Button type="submit" size="sm" disabled={busy || !dirty}>{busy ? "…" : "Speichern"}</Button>
      </div>
      {msg && <p className={`mt-2 text-xs ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</p>}
    </form>
  );
}

function LegalSection() {
  const [legal, setLegal] = useState<OfficeLegal>(EMPTY_LEGAL);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    try {
      const raw = localStorage.getItem("narchi:impressum");
      if (raw) setLegal(parseOfficeLegal(JSON.parse(raw) as Record<string, unknown>));
    } catch { /* */ }
    void pullOfficeBlob("impressum").then((r) => {
      if (!live || !r || r.empty) return;
      const parsed = parseOfficeLegal(r.payload);
      setLegal(parsed);
      try { localStorage.setItem("narchi:impressum", JSON.stringify(parsed)); } catch { /* */ }
    });
    return () => { live = false; };
  }, []);

  const set = (k: keyof OfficeLegal, v: string) => setLegal((c) => ({ ...c, [k]: v }));

  const speichern = async () => {
    setBusy(true);
    try {
      localStorage.setItem("narchi:impressum", JSON.stringify(legal));
      await pushOfficeBlob("impressum", { ...legal });
      setNote(legalIsFilled(legal) ? "Impressum gespeichert." : "Gespeichert — Name, Straße, PLZ/Ort, E-Mail fehlen noch.");
    } catch {
      setNote("Lokal gespeichert — Server nicht erreichbar.");
    } finally {
      setBusy(false);
    }
  };

  const feld = (id: keyof OfficeLegal, label: string) => (
    <label className="block text-xs">
      <span className="mb-1 block font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <input
        value={legal[id]}
        onChange={(e) => set(id, e.target.value)}
        className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-brand-400 focus:outline-none"
      />
    </label>
  );

  return (
    <Card>
      <CardHeader
        title="Impressum (§ 5 DDG)"
        subtitle="Pflichtangaben für die öffentliche Seite. Narchi füllt nichts aus. Keine Rechtsberatung."
        action={<Badge tone={legalIsFilled(legal) ? "emerald" : "amber"}>{legalIsFilled(legal) ? "vollständig" : "unvollständig"}</Badge>}
      />
      <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
        {feld("firma", "Firma / Name *")}
        {feld("vertreten", "Vertreten durch")}
        {feld("strasse", "Straße *")}
        {feld("plzOrt", "PLZ Ort *")}
        {feld("email", "E-Mail *")}
        {feld("telefon", "Telefon")}
        {feld("ustId", "USt-IdNr")}
        {feld("hrb", "HRB")}
        {feld("gericht", "Registergericht")}
        {feld("register", "Register")}
      </div>
      <div className="flex items-center gap-3 px-5 pb-5">
        <Button size="sm" disabled={busy} onClick={() => void speichern()}>{busy ? "…" : "Impressum speichern"}</Button>
        {note && <p className="text-xs text-slate-600">{note}</p>}
      </div>
    </Card>
  );
}

