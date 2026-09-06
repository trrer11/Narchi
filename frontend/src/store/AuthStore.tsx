import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  addFeedback,
  authenticate,
  changePassword as changePasswordFn,
  createUser,
  deleteFeedback as deleteFeedbackFn,
  deleteUser as deleteUserFn,
  listFeedback,
  listUsers,
  logout as logoutFn,
  resetUserPassword,
  restoreSession,
  setFeedbackStatus,
  setUserStatus,
  authenticateRemote,
  listUsersRemote,
  remoteMode,
  type CreateUserInput,
  type Feedback,
  type SafeUser,
} from "@/lib/auth";
import { purgeLegacyTokenStorage, secureLogout, secureFetch, setActiveTenantId } from "@/auth/SecuritySanitizer";
import { sessionSecurity } from "@/auth/sessionSecurity";
import {
  BOOT_ASSUMED_TTL_S,
  nextExpiry,
  REFRESH_MARGIN_MS,
  REFRESH_POLL_MS,
  shouldRefreshNow,
  WAKE_MARGIN_MS,
} from "@/lib/sessionRefresh";
import { flushQueue } from "@/lib/remoteDb";
import { captureOperationalError, recordDiagnosticEvent } from "@/core/telemetry";
import { useAppStore } from "@/store/AppStore";

interface AuthValue {
  user: SafeUser | null;
  ready: boolean;
  isOwner: boolean;
  loginError: string | null;

  login: (email: string, password: string) => Promise<SafeUser>;
  loginWithPasskey: (email: string) => Promise<SafeUser>;
  logout: () => void;
  changePassword: (current: string, next: string) => Promise<void>;

  users: SafeUser[];
  refreshUsers: () => void;
  createSubAccount: (input: CreateUserInput) => Promise<SafeUser>;
  toggleUserStatus: (id: string) => void;
  removeUser: (id: string) => void;
  resetPassword: (id: string, pw: string) => Promise<string>;

  feedback: Feedback[];
  refreshFeedback: () => void;
  submitFeedback: (input: { rating: number; category: string; page: string; message: string }) => void;
  setFbStatus: (id: string, status: Feedback["status"]) => void;
  removeFeedback: (id: string) => void;
}

const Ctx = createContext<AuthValue | null>(null);
const OFFLINE_AUTH_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_OFFLINE_AUTH === "true";

/**
 * P1-B — HANDLER DE SUCCES D'AUTHENTIFICATION (contrat CTO).
 * Ordre STRICT et non negociable :
 *  1. sessionSecurity.resume()  — SYNCHRONE. Le disjoncteur de trafic doit
 *     etre ferme AVANT tout envoi : si flushQueue partait d'abord, il se
 *     verrait refuser l'emission par isSuspended() et repartirait pour un
 *     cycle de 15 s (fenetre de perte en cas de fermeture d'onglet).
 *  2. flushQueue(true) — ASYNCHRONE, force. Depile immediatement les
 *     ecritures locales persistees (narchi:writequeue) sans attendre le
 *     timer. `force` court-circuite la garde isSuspended() pour couvrir
 *     le cas d'une re-suspension concurrente entre 1 et 2 (un 401 residuel
 *     d'une requete partie avant le login ne doit pas bloquer le rejeu).
 *  Erreurs avalees : un echec de rejeu N'EST PAS un echec de login — la
 *  file reste persistee et le cycle de 15 s reprendra le relais.
 */
function onAuthenticationSuccess(): void {
  sessionSecurity.resume();                      // 1. reactivation SYNCHRONE du trafic
  void flushQueue(true).catch((err) => {         // 2. rejeu immediat, non bloquant
    console.warn("[AuthStore] Rejeu post-login differe (cycle 15 s prendra le relais):", err);
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Le Context reste une façade de compatibilité; la source de vérité est Zustand.
  const user = useAppStore((state) => state.user);
  const setUser = useAppStore((state) => state.setUser);
  const [ready, setReady] = useState(false);
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loginError, setLoginError] = useState<string | null>(null);
  // §87 — échéance de la session courante (cookie HttpOnly illisible →
  // tenue par le code : login la connaît, boot l'estime prudemment).
  const sessionExpiryRef = useRef<number | null>(null);

  const refreshUsers = useCallback(() => setUsers(listUsers()), []);
  const refreshFeedback = useCallback(() => setFeedback(listFeedback()), []);

  // §87 — Renouvellement SILENCIEUX : consomme le cookie refresh 7 jours
  // (endpoint §87) AVANT la mort des 15 min. En cas de succès après une
  // suspension (retour de veille), le disjoncteur est rouvert — la file
  // d'écritures en sursis repart, personne ne voit le login.
  const refreshSession = useCallback(async (): Promise<boolean> => {
    try {
      const res = await secureFetch("/api/v5/auth/refresh", { method: "POST" });
      if (!res.ok) return false;
      let expiresIn: number | undefined;
      try {
        const body = await res.json();
        if (typeof body?.expires_in === "number") expiresIn = body.expires_in;
      } catch { /* corps sans expires_in : repli sur le TTL affiché */ }
      sessionExpiryRef.current = nextExpiry(Date.now(), expiresIn);
      if (sessionSecurity.isSuspended()) sessionSecurity.resume();
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const scheduleSharedStoreInit = () => {
      // Do not initialise the IndexedDB/BroadcastChannel shared store on boot.
      // Old browser profiles can contain a very large narchi-shared-db payload;
      // JSON.parse during init freezes the UI after the dashboard appears.
      // Collaboration modules initialise storage on demand instead of blocking
      // the main cockpit.
    };

    (async () => {
      // Keep boot synchronous work minimal. listUsers/listFeedback are cheap reads;
      // expensive PBKDF2 account seeding was removed from startup because it can
      // freeze Chrome right after the dashboard renders.
      refreshUsers();
      refreshFeedback();
      const restored = await restoreSession();

      try {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 1200);
        // AXE 2 : /auth/me via secureFetch. L'exclusion AUTH_ENDPOINT_RE de
        // l'intercepteur protege du faux positif (401 ici = pas de session,
        // etat normal au boot — pas une expiration en cours de travail).
        const res = await secureFetch("/api/v5/auth/me", {
          signal: controller.signal,
        });
        window.clearTimeout(timeout);
        if (!cancelled && res.ok) {
          const data = await res.json();
          
          // Récupérer le tenant_id de la charge utile de l'utilisateur
          const loadedUser: SafeUser = {
            id: data.id,
            email: data.email,
            name: data.name,
            role: data.role as "guest" | "architect" | "owner" | string,
            company: data.company || "NARCHI Office",
            status: data.is_active ? "active" : "disabled",
            createdAt: data.created_at,
            lastLogin: null,
            tenantId: data.tenant_id || "tenant-default",
            // §82 — contenu avatar serveur (propagation nouvel appareil)
            avatar_key: data.avatar_key ?? null,
            avatar_json: data.avatar_json ?? null,
          };
          
          setUser(loadedUser);
          setActiveTenantId(loadedUser.tenantId || null); // Synchronisation du contexte multi-tenant de sécurité
          setReady(true);
          scheduleSharedStoreInit();
          return;
        }
      } catch {
        // Backend unreachable/slow: keep the local-first app responsive.
      }

      if (!cancelled) {
        // SÉCURITÉ (bug "login sauté") : plus AUCUNE auto-connexion d'un
        // propriétaire démo. Sans cookie narchi_session valide côté backend
        // ET sans session locale restaurée, user reste null → le Router
        // affiche obligatoirement la page d'identification.
        if (restored) {
          setUser(restored);
          setActiveTenantId(restored.tenantId || "tenant-default");
          // §87 — boot : le TTL restant du cookie HttpOnly est ILLISIBLE.
          // Hypothèse prudente de mi-vie → la boucle amorce rapidement un
          // renouvellement qui recalera l'échéance exacte (expires_in).
          sessionExpiryRef.current ??= nextExpiry(Date.now(), BOOT_ASSUMED_TTL_S);
        } else {
          setUser(null);
          setActiveTenantId(null);
        }
        setReady(true);
        scheduleSharedStoreInit();
      }
    })();

    return () => { cancelled = true; };
  }, [refreshUsers, refreshFeedback]);

  const login = useCallback(async (email: string, password: string) => {
    setLoginError(null);
    const frontendAttemptId = recordDiagnosticEvent(
      "FRONTEND_AUTH_LOGIN_STARTED",
      "info",
      "Tentative de connexion démarrée",
      { online: navigator.onLine },
    );
    try {
      const base = "";
      const form = new URLSearchParams();
      form.append("username", email.trim());
      form.append("password", password);
      
      const res = await secureFetch(`${base}/api/v5/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      });

      if (!res.ok) {
        const rawError = await res.text();
        const backendDiagnosticId = res.headers.get("X-Narchi-Request-ID") || "";
        let errMsg = `Erreur de connexion (${res.status})`;
        try {
          const parsed = JSON.parse(rawError);
          if (parsed && typeof parsed === "object") {
            errMsg = parsed.detail || parsed.message || errMsg;
          }
        } catch {
          if (rawError && rawError.length < 200) {
            errMsg = rawError;
          }
        }
        recordDiagnosticEvent(
          "FRONTEND_AUTH_TOKEN_REJECTED",
          "warning",
          "Le backend a refusé la connexion",
          { status: res.status, backendDiagnosticId, frontendAttemptId },
        );
        if (backendDiagnosticId) {
          errMsg += ` (code diagnostic : ${backendDiagnosticId})`;
        }

        const err = new Error(errMsg);
        (err as any).status = res.status;
        (err as any).diagnosticId = backendDiagnosticId || frontendAttemptId;
        throw err;
      }

      const tokenDiagnosticId = res.headers.get("X-Narchi-Request-ID") || "";
      const data = await res.json();
      // §87 — le serveur renvoie expires_in (900 s) : l'échéance exacte de
      // la session est connue dès le login, la boucle silencieuse la suit.
      if (typeof data?.expires_in === "number") {
        sessionExpiryRef.current = nextExpiry(Date.now(), data.expires_in);
      }

      // Vérifie immédiatement que le cookie HttpOnly a réellement été accepté.
      // Sans ce contrôle, certains navigateurs passent brièvement au dashboard,
      // puis /auth/me renvoie 401 et l'utilisateur revient au login sans message.
      const sessionProbe = await secureFetch("/api/v5/auth/me", {
        method: "GET",
        cache: "no-store",
      });
      if (!sessionProbe.ok) {
        const probeDiagnosticId = sessionProbe.headers.get("X-Narchi-Request-ID") || "";
        recordDiagnosticEvent(
          "FRONTEND_AUTH_COOKIE_PROBE_FAILED",
          "error",
          "Le cookie de session n'a pas été accepté ou validé",
          {
            status: sessionProbe.status,
            loginRequestId: tokenDiagnosticId,
            probeRequestId: probeDiagnosticId,
            frontendAttemptId,
          },
        );
        const diagnosticSuffix = probeDiagnosticId
          ? ` Code diagnostic : ${probeDiagnosticId}.`
          : ` Code diagnostic local : ${frontendAttemptId}.`;
        const cookieError = new Error(
          "La session n'a pas pu être conservée par le navigateur. " +
          "Utilisez http://localhost:8080 et autorisez les cookies pour localhost." +
          diagnosticSuffix,
        );
        (cookieError as Error & { status?: number; diagnosticId?: string }).status = sessionProbe.status;
        (cookieError as Error & { diagnosticId?: string }).diagnosticId = probeDiagnosticId || frontendAttemptId;
        throw cookieError;
      }
      
      // Extraction et mapping du tenant_id renvoyé par le token backend
      const u: SafeUser = {
        id: data.user_info.id,
        email: data.user_info.email,
        name: data.user_info.name,
        role: data.user_info.role as "guest" | "architect" | "owner" | string,
        company: "NARCHI Principal Office",
        status: "active",
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        tenantId: data.user_info.tenant_id || "tenant-default"
      };
      
      purgeLegacyTokenStorage();
      setUser(u);
      setActiveTenantId(u.tenantId || null); // Verrou d'étanchéité multi-tenant
      onAuthenticationSuccess();
      recordDiagnosticEvent(
        "FRONTEND_AUTH_LOGIN_SUCCEEDED",
        "info",
        "Connexion et cookie de session validés",
        { loginRequestId: tokenDiagnosticId, frontendAttemptId },
      );
      return u;
    } catch (err: any) {
      const failureDiagnosticId = recordDiagnosticEvent(
        "FRONTEND_AUTH_LOGIN_FAILED",
        err?.status ? "warning" : "error",
        "La séquence de connexion a échoué",
        {
          status: err?.status || 0,
          existingDiagnosticId: err?.diagnosticId || "",
          frontendAttemptId,
          online: navigator.onLine,
        },
      );
      // S'il s'agit d'une erreur de réseau pure (serveur injoignable / offline),
      // nous pouvons basculer de manière résiliente sur l'authentification locale.
      const isNetworkError = !err.status && (
        err.message === "Failed to fetch" ||
        err.message === "offline" ||
        err.message?.includes("NetworkError") ||
        err.message?.includes("network")
      );

      if (isNetworkError && OFFLINE_AUTH_ENABLED) {
        try {
          const u = remoteMode()
            ? await authenticateRemote(email, password)
            : await authenticate(email, password);
          
          setUser(u);
          setActiveTenantId(u.tenantId || "tenant-default");
          if (remoteMode()) {
            setUsers(await listUsersRemote());
          } else {
            refreshUsers();
          }
          onAuthenticationSuccess();
          return u;
        } catch (localErr: any) {
          const errMsg = localErr instanceof Error ? localErr.message : "Identifiants locaux invalides ou serveur hors-ligne.";
          setLoginError(errMsg);
          throw new Error(errMsg);
        }
      } else {
        const errMsg = isNetworkError
          ? "Le backend NARCHI est indisponible. Vérifiez que le déploiement Docker est terminé et sain. " +
            `Code diagnostic local : ${failureDiagnosticId}.`
          : err instanceof Error
            ? err.message
            : "Identifiants invalides ou connexion refusée.";
        setLoginError(errMsg);
        throw new Error(errMsg);
      }
    }
  }, [refreshUsers]);

  const loginWithPasskey = useCallback(async (email: string) => {
    const { passkeysSupported, credentialToJson, b64urlToBuf } = await import("@/lib/passkeys");
    if (!passkeysSupported()) {
      throw new Error("Dieser Browser unterstützt keine Passkeys.");
    }
    const optRes = await secureFetch("/api/v5/auth/passkeys/login/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    if (!optRes.ok) throw new Error("Passkey-Optionen nicht verfügbar.");
    const opts = await optRes.json();
    const allow = Array.isArray(opts.allowCredentials)
      ? opts.allowCredentials.map((c: { id: string; type: string }) => ({
          id: b64urlToBuf(c.id),
          type: "public-key" as const,
        }))
      : [];
    const cred = (await navigator.credentials.get({
      publicKey: {
        challenge: b64urlToBuf(String(opts.challenge)),
        rpId: opts.rpId,
        timeout: opts.timeout,
        userVerification: "preferred",
        allowCredentials: allow,
      },
    })) as PublicKeyCredential | null;
    if (!cred) throw new Error("Passkey abgebrochen.");
    const ver = await secureFetch("/api/v5/auth/passkeys/login/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), credential: credentialToJson(cred) }),
    });
    if (!ver.ok) {
      const payload = await ver.json().catch(() => null) as { detail?: string } | null;
      throw new Error(payload?.detail || `Passkey abgelehnt (${ver.status}).`);
    }
    const data = await ver.json();
    if (typeof data?.expires_in === "number") {
      sessionExpiryRef.current = nextExpiry(Date.now(), data.expires_in);
    }
    const sessionProbe = await secureFetch("/api/v5/auth/me", { method: "GET", cache: "no-store" });
    if (!sessionProbe.ok) throw new Error("Cookie nach Passkey nicht gesetzt.");
    const u: SafeUser = {
      id: data.user_info.id,
      email: data.user_info.email,
      name: data.user_info.name,
      role: data.user_info.role,
      company: "NARCHI Principal Office",
      status: "active",
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
      tenantId: data.user_info.tenant_id || "tenant-default",
    };
    purgeLegacyTokenStorage();
    setUser(u);
    setActiveTenantId(u.tenantId || null);
    onAuthenticationSuccess();
    return u;
  }, []);

  // ------------------------------------------------------------------
  // P1-B + §87 : expiration détectée par secureFetch → on tente D'ABORD
  // un renouvellement silencieux via le cookie refresh 7 jours (cause
  // racine de la plainte : ce cookie n'était jamais consommé). Seul un
  // échec réel (refresh expiré > 7 j, mot de passe changé, compte
  // désactivé) purge la mémoire → le Router affiche alors Login.
  // La file d'écritures reste en sursis (gel contrôlé) pendant l'essai.
  // ------------------------------------------------------------------
  useEffect(() => {
    const onExpired = () => {
      void refreshSession().then((ok) => {
        if (ok) return;
        purgeLegacyTokenStorage();
        sessionExpiryRef.current = null;
        setUser(null);
        setActiveTenantId(null);
      });
    };
    window.addEventListener("narchi-session-expired", onExpired);
    return () => window.removeEventListener("narchi-session-expired", onExpired);
  }, [refreshSession]);

  // ------------------------------------------------------------------
  // §87 — boucle de renouvellement SILENCIEUX : tant que l'utilisateur
  // est connecté, toutes les 30 s (onglet visible uniquement — un onglet
  // caché ne poll pas) on teste l'entrée dans la marge des 2 min avant
  // échéance ; au réveil de l'onglet (mise en veille du portable), marge
  // élargie à 10 min. Le jeton 15 min est donc remplacé AVANT sa mort :
  // l'architecte ne retombe plus sur le login en pleine journée.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!user) {
      sessionExpiryRef.current = null;
      return;
    }
    const tick = (marginMs: number) => {
      if (document.visibilityState !== "visible") return;
      if (!shouldRefreshNow(Date.now(), sessionExpiryRef.current, marginMs)) return;
      void refreshSession();
    };
    const intervalId = window.setInterval(() => tick(REFRESH_MARGIN_MS), REFRESH_POLL_MS);
    const onWake = () => tick(WAKE_MARGIN_MS);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [user, refreshSession]);

  const logout = useCallback(() => {
    logoutFn();
    // Invalidation serveur du cookie HttpOnly + purge des résidus locaux.
    void secureLogout();
    sessionExpiryRef.current = null;
    setUser(null);
    setActiveTenantId(null);
  }, []);

  const changePassword = useCallback(async (current: string, next: string) => {
    if (!user) throw new Error("Nicht eingeloggt.");
    try {
      const res = await secureFetch("/api/v5/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ old_password: current, new_password: next }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null) as { detail?: string } | null;
        throw new Error(payload?.detail || `Passwortänderung abgelehnt (${res.status}).`);
      }
      // Le nouveau token est posé exclusivement par cookie HttpOnly.
      await res.json();
      purgeLegacyTokenStorage();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const networkFailure = /failed to fetch|network|offline|abort/i.test(message);
      if (!networkFailure) throw error;
      captureOperationalError(error, { context: "AuthStore.changePassword.remoteFallback" });
    }

    // Repli local uniquement lorsque le serveur est réellement indisponible.
    await changePasswordFn(user.id, current, next);
  }, [user]);

  const createSubAccount = useCallback(async (input: CreateUserInput) => {
    const u = await createUser(input);
    refreshUsers();
    return u;
  }, [refreshUsers]);

  const toggleUserStatus = useCallback((id: string) => {
    const target = users.find((u) => u.id === id);
    if (!target) return;
    setUserStatus(id, target.status === "active" ? "disabled" : "active");
    refreshUsers();
  }, [users, refreshUsers]);

  const removeUser = useCallback((id: string) => {
    deleteUserFn(id);
    refreshUsers();
  }, [refreshUsers]);

  const resetPassword = useCallback(async (id: string, pw: string) => {
    const np = await resetUserPassword(id, pw);
    refreshUsers();
    return np;
  }, [refreshUsers]);

  const submitFeedback = useCallback((input: { rating: number; category: string; page: string; message: string }) => {
    if (!user) return;
    addFeedback({ userId: user.id, userName: user.name, ...input });
    refreshFeedback();
  }, [user, refreshFeedback]);

  const setFbStatus = useCallback((id: string, status: Feedback["status"]) => {
    setFeedbackStatus(id, status);
    refreshFeedback();
  }, [refreshFeedback]);

  const removeFeedback = useCallback((id: string) => {
    deleteFeedbackFn(id);
    refreshFeedback();
  }, [refreshFeedback]);

  const value: AuthValue = useMemo(() => ({
    user,
    ready,
    isOwner: user?.role === "owner",
    loginError,
    login,
    loginWithPasskey,
    logout,
    changePassword,
    users,
    refreshUsers,
    createSubAccount,
    toggleUserStatus,
    removeUser,
    resetPassword,
    feedback,
    refreshFeedback,
    submitFeedback,
    setFbStatus,
    removeFeedback,
  }), [user, ready, loginError, login, loginWithPasskey, logout, changePassword, users, refreshUsers, createSubAccount, toggleUserStatus, removeUser, resetPassword, feedback, refreshFeedback, submitFeedback, setFbStatus, removeFeedback]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
