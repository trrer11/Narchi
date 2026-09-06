import { lazy, Suspense, useEffect, useState } from "react";
import { useAppStore, RouteSynchronizer } from "@/store/AppStore";
import { AuthProvider, useAuth } from "@/store/AuthStore";
import { ToastProvider } from "@/components/Toaster";
import { initRemoteDb } from "@/lib/remoteDb";
import { useLang } from "@/lib/i18n";
import { importWithChunkRecovery } from "@/lib/chunkRecovery";
import PwaUpdatePrompt from "@/components/PwaUpdatePrompt";

const Landing = lazy(() =>
  importWithChunkRecovery(() => import("@/pages/Landing"), "Landing"),
);
const Legal = lazy(() =>
  importWithChunkRecovery(() => import("@/pages/Legal"), "Legal"),
);
const Login = lazy(() =>
  importWithChunkRecovery(() => import("@/pages/Login"), "Login"),
);
const FloatingChatManager = lazy(() =>
  importWithChunkRecovery(
    () => import("@/components/FloatingChat").then((module) => ({
      default: module.FloatingChatManager,
    })),
    "FloatingChat",
  ),
);
// Le cockpit complet sort du bundle initial et bénéficie d'une récupération
// automatique si un ancien index.html référence un chunk supprimé.
const DashboardShell = lazy(() =>
  importWithChunkRecovery(
    () => import("@/pages/dashboard/DashboardShell"),
    "DashboardShell",
  ),
);

function BootLoader({ label = "Narchi wird geladen…" }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950">
      <div className="flex flex-col items-center gap-3 text-slate-400">
        <svg className="h-8 w-8 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" className="opacity-25" />
          <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}

function Router() {
  useLang();
  const route = useAppStore((s) => s.route);
  const { user, ready } = useAuth();
  const [showLogin, setShowLogin] = useState(false);

  const isApp = route.path.startsWith("/app");

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route]);

  if (!ready) return <BootLoader />;

  const needsLogin = isApp && !user;
  if (needsLogin || showLogin) {
    return (
      <Suspense fallback={<BootLoader label="Anmeldung wird geladen…" />}>
        <Login onDone={() => setShowLogin(false)} />
      </Suspense>
    );
  }

  const isLegal =
    route.path === "/impressum" ||
    route.path === "/datenschutz" ||
    route.path === "/agb";
  if (isLegal) {
    return (
      <Suspense fallback={<BootLoader label="Rechtstexte werden geladen…" />}>
        <Legal />
      </Suspense>
    );
  }

  if (!isApp) {
    return (
      <Suspense fallback={<BootLoader label="Startseite wird geladen…" />}>
        <Landing />
      </Suspense>
    );
  }

  // §83 — la branche « ownerOnly » qui rendait le cockpit SANS le dock de
  // chat pour les non-owners sur /app/team et /app/settings est SUPPRIMÉE :
  // c'était un reste d'avant §82 (la page Team est maintenant ouverte à
  // tous les membres du bureau, avec gardes internes par rôle). Elle
  // produisait le symptôme réel remonté par le client : la bulle
  // messagerie disparaissait sur la page Team puis revenait ailleurs.
  return (
    <>
      <Suspense fallback={<BootLoader label="Cockpit wird geladen…" />}>
        <DashboardShell />
      </Suspense>
      <Suspense fallback={null}>
        <FloatingChatManager />
      </Suspense>
    </>
  );
}

export default function App() {
  useEffect(() => {
    const disposeRemoteDb = initRemoteDb();
    const disposeRouter = RouteSynchronizer.init();
    return () => {
      disposeRemoteDb();
      disposeRouter();
    };
  }, []);
  return (
    <ToastProvider>
      <AuthProvider>
        <Router />
        {/* §101 — pastille « nouvelle version » (PWA) : s'auto-enregistre
            en production ; en développement, no-op (jamais de cache fantôme). */}
        <PwaUpdatePrompt />
      </AuthProvider>
    </ToastProvider>
  );
}
