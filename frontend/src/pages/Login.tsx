import { useState } from "react";
import { useAuth } from "@/store/AuthStore";
import { LogoMark } from "@/components/Logo";
import { Button, Icon } from "@/components/ui";
import { secureFetch } from "@/auth/SecuritySanitizer";

// §68 — la page gère TROIS mondes (le backend les servait déjà, l'UI pas) :
// connexion, création de compte (registrieren → propre espace d'essai) et
// ACCEPTATION D'INVITATION (lien signé ?invite=… → le compte rejoint
// l'Arbeitsraum de l'émetteur).
//
// §100 — pass visuel + VÉRITÉ (régression signalée « avant plus simple et
// joli ») :
// 1. épure : scanline, pastille « Gebäude-Cockpit · Production V5 » (V5 —
//    marqueur daté, nous sommes V6) et un des deux halos SUPPRIMÉS, grille
//    animée → statique ;
// 2. vérité §36 : les affirmations non prouvables disparaissent
//    (« authentification certifiée DIN 276 » — une norme de classification
//    des coûts ne certifie pas un portail ; « protocole Zero-Leak » — nom
//    inventé, affiché DEUX fois) → remplacées par des faits vérifiables
//    dans le code : Argon2id (core/security/passwords.py), auto-hébergement
//    Docker, multi-comptes + invitations 72 h (§80/§68), DIN 276 / GAEB
//    X31/X83 / Destatis 61261 (produit, testé) ;
// 3. une seule langue : l'écran était français (« Connexion »…) alors que
//    le mode registrieren ET tout le produit sont en allemand → tout en
//    allemand ;
// 4. le bouton œil du mot de passe utilisait l'icône loupe « search »
//    (renommée) → vraies icônes eye/eyeOff avec aria-label.
// Aucune logique modifiée : ids, noms, autocomplete, flux §68 intacts.
type Mode = "login" | "register";

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

export default function Login({ onDone }: { onDone: () => void }) {
  const { login, loginWithPasskey } = useAuth();
  // Lien d'invitation lu UNE fois à l'arrivée (?invite=<jeton signé>).
  const [inviteToken] = useState<string | null>(() => {
    try {
      return new URLSearchParams(window.location.search).get("invite");
    } catch {
      return null;
    }
  });
  const [mode, setMode] = useState<Mode>(() => (inviteToken ? "register" : "login"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") {
        const companyValue = company.trim() || undefined;
        if (inviteToken) {
          // Invitation signée → compte DANS le tenant de l'émetteur.
          const res = await secureFetch("/api/v5/invites/accept", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: inviteToken, name: name.trim(), email: email.trim(), password, company: companyValue }),
          });
          if (!res.ok) throw new Error(await readApiError(res, "Einladung konnte nicht angenommen werden."));
        } else {
          // Création libre → nouvel espace d'essai (tenant Trial, §60).
          const res = await secureFetch("/api/v5/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email.trim(), password, name: name.trim(), company: companyValue }),
          });
          if (!res.ok) throw new Error(await readApiError(res, "E-Mail bereits vergeben oder ungültig."));
        }
      }
      await login(email.trim(), password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen — E-Mail oder Passwort falsch.");
    } finally {
      setBusy(false);
    }
  };

  const isRegister = mode === "register";

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink-950 p-4">
      <div className="absolute inset-0 bp-grid radial-fade opacity-40" />
      <div className="pointer-events-none absolute -right-32 -top-24 h-96 w-96 rounded-full bg-brand-500/15 blur-[140px]" />

      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-white shadow-2xl lg:grid-cols-2">
        {/* Brand side — uniquement des faits vérifiables (§100) */}
        <div className="relative hidden flex-col justify-between bg-ink-950 p-10 lg:flex">
          <div className="absolute inset-0 bp-grid radial-fade opacity-40" />
          <div className="relative">
            <div className="flex items-center gap-2.5">
              <LogoMark size={36} />
              <span className="font-display text-2xl font-bold text-white">Narchi</span>
            </div>
            <div className="mt-12">
              <h1 className="font-display text-3xl font-bold leading-tight text-white">
                Ihre Preise. Ihre Projekte.<br /><span className="text-gradient">Ihr Server.</span>
              </h1>
              <p className="mt-4 text-sm leading-relaxed text-slate-300">
                Kostenschätzung nach DIN 276 · GAEB X31/X83 · amtlicher Baupreisindex (Destatis 61261) — alles auf Ihrem eigenen Server.
              </p>
            </div>
          </div>
          <div className="relative space-y-3">
            {[
              { icon: "shield" as const, t: "Passwörter nie im Klartext gespeichert (Argon2id)" },
              { icon: "building" as const, t: "Selbst gehostet — Daten bleiben in Ihrem Büro" },
              { icon: "users" as const, t: "Mehrere Konten je Büro · Einladung per Link (72 h)" },
            ].map((f) => (
              <div key={f.t} className="flex items-center gap-3 text-sm text-slate-300">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-brand-300"><Icon name={f.icon} size={16} /></span>
                {f.t}
              </div>
            ))}
          </div>
        </div>

        {/* Form side */}
        <div className="p-8 sm:p-10 flex flex-col justify-center">
          <div className="flex items-center justify-between lg:hidden">
            <div className="flex items-center gap-2"><LogoMark size={28} /><span className="font-display text-lg font-bold text-slate-900">Narchi</span></div>
          </div>

          <div className="mt-2 lg:mt-0">
            <h2 className="font-display text-2xl font-bold text-slate-900">
              {isRegister ? "Konto erstellen" : "Anmelden"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {isRegister
                ? (inviteToken ? "Ihr Konto wird dem Arbeitsraum des Einladenden hinzugefügt." : "Eigenen Testbereich anlegen — kostenlos, ohne Karte.")
                : "Mit Ihrem Büro-Konto anmelden."}
            </p>
          </div>

          {/* §68 — bandeau invitation (jeton signé détecté dans l'URL) */}
          {inviteToken && isRegister && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              <Icon name="check" size={14} />
              Einladung erkannt — sie ist 72 h gültig und einmalig verwendbar.
            </div>
          )}

          <form onSubmit={submit} className="mt-8 space-y-4">
            {isRegister && (
              <div>
                <label htmlFor="register-name" className="text-xs font-semibold text-slate-500">Name</label>
                <input
                  id="register-name"
                  name="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                  className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
                />
              </div>
            )}
            <div>
              <label htmlFor="login-username" className="text-xs font-semibold text-slate-500">E-Mail</label>
              <input
                id="login-username"
                name="username"
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
              />
            </div>
            {isRegister && (
              <div>
                <label htmlFor="register-company" className="text-xs font-semibold text-slate-500">Büro / Firma <span className="font-normal text-slate-400">(optional)</span></label>
                <input
                  id="register-company"
                  name="organization"
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  autoComplete="organization"
                  className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
                />
              </div>
            )}
            <div>
              <label htmlFor="login-password" className="text-xs font-semibold text-slate-500">
                {isRegister ? "Passwort (min. 8 Zeichen)" : "Passwort"}
              </label>
              <div className="relative mt-1">
                <input
                  id="login-password"
                  name="password"
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={isRegister ? 8 : undefined}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 pr-10 text-sm text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Passwort verbergen" : "Passwort anzeigen"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <Icon name={show ? "eyeOff" : "eye"} size={16} />
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                <Icon name="alert" size={14} /> {error}
              </div>
            )}

            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {busy ? <Icon name="refresh" size={18} className="animate-spin" /> : <Icon name="lock" size={18} />}
              {busy
                ? (isRegister ? "Konto wird erstellt…" : "Anmeldung läuft…")
                : (isRegister ? (inviteToken ? "Einladung annehmen" : "Konto erstellen") : "Anmelden")}
            </Button>
          </form>

          {/* §68 — bascule login ⇄ register (toujours visible ; l'invité
              peut aussi se connecter s'il a déjà un compte). */}
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => { setMode(isRegister ? "login" : "register"); setError(null); }}
              className="text-xs font-semibold text-brand-600 underline-offset-2 hover:underline"
            >
              {isRegister ? "Schon registriert? Anmelden" : "Noch kein Konto? Registrieren"}
            </button>
          </div>

          <div className="mt-8 flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            NARCHI — Software für Architekturbüros
            <span className="h-px flex-1 bg-slate-200" />
          </div>
        </div>
      </div>
    </div>
  );
}
