import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { useApp, useAppStore } from "@/store/AppStore";
import { useAuth } from "@/store/AuthStore";
import { subscribeChat, unreadCount as chatUnread, getChannels } from "@/lib/chatService";
// §117 — moteur de synchro Mängel (étape 2) : démarré UNE fois par shell.
import { startIssueSync } from "@/lib/issueSync";
// §118 — miroir Projets + versement des médias (étape 3).
import { attachProjectSync, syncProjectsOnce } from "@/lib/projectSync";
import { attachMediaSync, uploadPendingMedia } from "@/lib/mediaSync";
import { loadMangelPhotoLocalOnly, saveMangelPhotoSilent } from "@/lib/mangelPhotos";
import { CollabBar } from "@/components/CollabBar";
import { LevelBadge } from "@/components/LevelBadge";
import { LogoMark } from "@/components/Logo";
import { Icon, IconButton } from "@/components/ui";
import UserAvatar from "@/components/UserAvatar";
import { avatarKeyOf, hydrateAvatarsFromServer } from "@/lib/avatars";
import { roleLabel as roleLabelOf } from "@/lib/members";
import { CommandPalette } from "@/components/CommandPalette";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { readAnsicht, type AnsichtLevel } from "@/lib/ansicht";
import { cn } from "@/utils/cn";
import type { IconName } from "@/components/icons";
import Overview from "./Overview";
import ModelImport from "./ModelImport";
import Projects from "./Projects";
import DigitalTwin from "./DigitalTwin";
import Elements from "./Elements";
import Quantities from "./Quantities";
import Schedule from "./Schedule";
import Materials from "./Materials";
import CostEstimation from "./CostEstimation";
import GegEnergie from "./GegEnergie";
import HoaiHonorar from "./HoaiHonorar";
import Classification from "./Classification";
import Synchronization from "./Synchronization";
import Compliance from "./Compliance";
import Issues from "./Issues";
import Settings from "./Settings";
import Team from "./Team";
import Feedback from "./Feedback";
import Messages from "./Messages";
import Kalender from "./Kalender";
import MeinKalender from "./MeinKalender";
import BueroKlima from "./BueroKlima";
import Planpruefung from "./Planpruefung";
import Qualitaet from "./Qualitaet";
import DataVault from "./DataVault";
import Backend from "./Backend";
import CrewAgents from "./CrewAgents";
import { Copilot } from "@/components/Copilot";
import { UserMenu } from "@/components/UserMenu";
import Roadmap from "./Roadmap";
import BuildingPhysics from "./BuildingPhysics";
import PracticeMgmt from "./PracticeMgmt";
import LCA from "./LCA";
import NarchiIq from "./NarchiIq";
import PlotAnalysis from "./PlotAnalysis";
import Preisbibliothek from "./Preisbibliothek";
import Baustelle from "./Baustelle";
import Rechnungen from "./Rechnungen";
import Leistungsgrenzen from "./Leistungsgrenzen";

interface NavItem { id: string; label: string; icon: IconName; badge?: keyof ReturnType<typeof useApp>["kpis"] }
interface NavGroup { title: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Büro",
    items: [
      { id: "overview", label: "Übersicht", icon: "grid" },
      { id: "projects", label: "Projekte", icon: "building" },
      { id: "import", label: "Modell-Import", icon: "cube" },
      { id: "cost", label: "DIN 276 Kosten", icon: "gauge" },
      { id: "prices", label: "Preisbibliothek", icon: "database" },
      { id: "planpruefung", label: "Planprüfung", icon: "shield" },
    ],
  },
  {
    title: "Fachmodule",
    items: [
      { id: "qs", label: "Qualität", icon: "shield" },
      { id: "hoai", label: "HOAI-Honorar", icon: "scale" },
      { id: "energy", label: "GEG & LCA", icon: "leaf" },
      { id: "crew", label: "Prüf-Crew", icon: "spark" },
      { id: "iq", label: "NARCHI IQ", icon: "pulse" },
    ],
  },
  {
    title: "TEAM & KOMMUNIKATION",
    items: [
      { id: "kalender", label: "Mein Kalender", icon: "calendar" },
      { id: "teamplan", label: "Team-Planung", icon: "users" },
      { id: "messages", label: "Nachrichten", icon: "pulse" },
      // §82 — label allemand (cohérent avec le titre de page ; avant :
      // « Collaborateurs » français, introuvable pour l'utilisateur).
      { id: "team", label: "Team", icon: "users" },
      // §104 — #10, idée client : import photos AU BUREAU, tri par vraies
      // dates EXIF, Mängel depuis les groupes (remplace la page terrain §102).
      { id: "baustelle", label: "Baustelle", icon: "camera" },
    ],
  },
  {
    title: "Büro-Betrieb",
    items: [
      { id: "rechnungen", label: "Rechnungen", icon: "scale" },
      { id: "practice", label: "Büro-Stunden", icon: "clock" },
      { id: "settings", label: "Einstellungen", icon: "cog" },
      { id: "grenzen", label: "Grenzen & Recht", icon: "shield" },
    ],
  },
];

import type { ComponentType } from "react";

/// Pages hors nav principal : joignables (palette / URL), jamais comme Büro-Produkt verkauft.
const LABOR_VIEWS: Record<string, string> = {
  plot: "Grundstücksanalyse — Labor, kein B-Plan-Bescheid",
  twin: "Digitaler Zwilling — keine Live-Sensoren",
  physics: "Bauphysik — Kennwerte, keine TEASER/EnergyPlus-Simulation",
  vault: "DataVault — lokale Sicherung, kein Cloud-Tresor",
  backend: "Backend-Assistent — Supabase-Wizard eingeklappt, Self-Host gilt",
  roadmap: "Interne Roadmap — 2027-Theater nicht als Lieferstand",
  compliance: "Konformität — Score 0 wenn keine Regel messbar",
};

const VIEW_MAP: Record<string, ComponentType> = {
  overview: Overview,
  import: ModelImport,
  "model-import": ModelImport,
  plot: PlotAnalysis,
  projects: Projects,
  twin: DigitalTwin,
  elements: Elements,
  quantities: Quantities,
  cost: CostEstimation,
  crew: CrewAgents,
  iq: NarchiIq,
  lca: LCA,
  energy: GegEnergie,
  physics: BuildingPhysics,
  hoai: HoaiHonorar,
  schedule: Schedule,
  kalender: MeinKalender,
  teamplan: Kalender,
  materials: Materials,
  classification: Classification,
  sync: Synchronization,
  compliance: Compliance,
  planpruefung: Planpruefung,
  qs: Qualitaet,
  issues: Issues,
  practice: PracticeMgmt,
  feedback: Feedback,
  messages: Messages,
  klima: BueroKlima,
  settings: Settings,
  vault: DataVault,
  backend: Backend,
  roadmap: Roadmap,
  team: Team,
  prices: Preisbibliothek,
  baustelle: Baustelle,
  rechnungen: Rechnungen,
  grenzen: Leistungsgrenzen,
};

export default function DashboardShell() {
  useLang();
  const { route, navigate, runSync, sync, activeProject, projects, setActiveProjectId, kpis, setCommandOpen, unreadCount } = useApp();
  const { user, isOwner, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [projOpen, setProjOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  // §109 — densité de TOUTE l'interface (le client : « je parlais du zoom
  // de l'interface » — le widget page-seule §107 était mon erreur, retiré).
  // §111 — « enlève le contrôle de zoom en haut à droite, je n'ai rien à
  // faire avec et il n'est pas joli » : le BOUTON disparaît, mais la
  // densité demandée et choisie (défaut 70 % = « −30 % » du §109) reste
  // appliquée — retirer le réglage lui-même rendrait l'écran trop grand.
  const [ansicht] = useState<AnsichtLevel>(() => readAnsicht(localStorage));
  // Appliquée sur <html> : couvre sidebar + pages + dock de chat (monté
  // hors du shell dans App.tsx). Le cockpit seul est concerné — la page
  // d'accueil marketing garderait son échelle ; au démontage on restaure.
  useEffect(() => {
    const root = document.documentElement;
    root.style.zoom = String(ansicht);
    return () => { root.style.zoom = ""; };
  }, [ansicht]);

  // §117 — étape 2 de la synchro inter-appareils : pousse les Mängel
  // écrits ICI, tire ceux des autres appareils (cycle initial + polling
  // sobre + réveil au retour réseau). Photos/vidéos = étape 3 (blobs) ;
  // usage téléphone : HTTPS local, étape 4 (dit dans docs/SYNCHRO_MANGELS).
  useEffect(() => {
    const stop = startIssueSync({
      loadIssues: () => useAppStore.getState().issues,
      loadProjects: () => useAppStore.getState().projects,
      upsertLocal: (l) => useAppStore.getState().upsertIssues(l),
      removeLocal: (ids) => useAppStore.getState().removeIssues(ids),
    });
    return stop;
  }, []);

  // §118 — miroir PROJETS (plainte client : projet invisible sur l'autre
  // compte) + versement des MÉDIAS (étape 3 ; pull-through à l'affichage).
  // Mêmes réflexes que §117 : cycle initial, polling sobre, réveil réseau.
  useEffect(() => {
    attachProjectSync({
      loadProjects: () => useAppStore.getState().projects,
      upsertProjects: (l) => useAppStore.getState().upsertProjects(l),
      removeProjects: (ids) => useAppStore.getState().removeProjectsSilent(ids),
    });
    void syncProjectsOnce();
    const id = setInterval(() => { void syncProjectsOnce(); }, 45_000);
    const online = () => { void syncProjectsOnce(); };
    window.addEventListener("online", online);
    return () => { clearInterval(id); window.removeEventListener("online", online); };
  }, []);

  useEffect(() => {
    attachMediaSync({
      getBlob: loadMangelPhotoLocalOnly,
      putBlob: async (id, blob) => { await saveMangelPhotoSilent(id, blob); },
    });
    void uploadPendingMedia();
    const online = () => { void uploadPendingMedia(); };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);

  const userName = user?.name || "Architekt";
  // §82 — vrai rôle du compte (§80) au lieu du binaire owner/« Architekt »
  // qui affublait Geschäftsführung, Mitglied et Gast d'un mauvais badge.
  const roleLabel = roleLabelOf(user?.role ?? "architect").label;
  const userAvatarKey = avatarKeyOf({ email: user?.email, name: userName, id: user?.id });
  const sidebarProps = { userName, userAvatarKey, roleLabel, isOwner, onLogout: logout };

  // §82 — hydratation de SON avatar depuis le serveur au chargement du shell
  // (visibilité sur un nouvel appareil sans re-saisie ; serveur = source).
  useEffect(() => {
    if (user?.avatar_key && user?.avatar_json) {
      hydrateAvatarsFromServer([{ avatar_key: user.avatar_key, avatar_json: user.avatar_json }]);
    }
  }, [user?.avatar_key, user?.avatar_json]);

  const seg = route.path.split("/").filter(Boolean);
  const view = seg[1] ?? "overview";
  const allNavItems = NAV_GROUPS.flatMap((g) => g.items);
  const current = allNavItems.find((n) => n.id === view)
    ?? (LABOR_VIEWS[view] ? { id: view, label: LABOR_VIEWS[view].split(" — ")[0], icon: "layers" as const } : allNavItems[0]);
  const View = VIEW_MAP[view] ?? Overview;
  const laborNote = LABOR_VIEWS[view];

  const go = (id: string) => {
    navigate(`/app/${id}`);
    setMobileOpen(false);
  };

  const handleSync = () => {
    void runSync();
    navigate("/app/sync");
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 selection:bg-brand-500/20 transition-colors duration-300">
      {/* ===== Sidebar (Enterprise Minimalist) ===== */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-zinc-200 bg-zinc-50/50 backdrop-blur-md lg:flex dark:border-zinc-800 dark:bg-zinc-950/50">
        <SidebarContent
          view={view}
          go={go}
          navigate={navigate}
          activeProject={activeProject}
          projects={projects}
          setActiveProjectId={setActiveProjectId}
          projOpen={projOpen}
          setProjOpen={setProjOpen}
          syncRunning={sync.running}
          openConflicts={kpis.openConflicts}
          {...sidebarProps}
        />
      </aside>

      {/* ===== Sidebar (mobile) ===== */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-zinc-50 dark:bg-zinc-950">
            <SidebarContent
              view={view}
              go={go}
              navigate={navigate}
              activeProject={activeProject}
              projects={projects}
              setActiveProjectId={setActiveProjectId}
              projOpen={projOpen}
              setProjOpen={setProjOpen}
              syncRunning={sync.running}
              openConflicts={kpis.openConflicts}
              {...sidebarProps}
            />
          </aside>
        </div>
      )}

      {/* ===== Main Workspace ===== */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/80 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80">
          <div className="flex h-14 items-center gap-3 px-6">
            <button className="rounded-lg p-2 text-zinc-500 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Menu">
              <Icon name="menu" size={20} />
            </button>
            <div className="flex items-center gap-2 text-[11px] font-medium tracking-wide uppercase opacity-60">
              <span>System</span>
              <Icon name="chevronRight" size={12} />
              <span className="text-brand-600 dark:text-brand-400 font-bold">{current.label}</span>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <button
                onClick={() => setCommandOpen(true)}
                className="hidden h-8 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-xs text-zinc-500 transition-all hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 md:flex"
              >
                <Icon name="search" size={14} />
                <span>Suche</span>
                <kbd className="ml-2 rounded border border-zinc-200 bg-zinc-50 px-1 py-0.5 text-[9px] font-bold text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800">Strg+K</kbd>
              </button>
              <button
                onClick={handleSync}
                disabled={sync.running}
                className="inline-flex h-8 items-center gap-2 rounded-md bg-zinc-900 px-3 text-xs font-semibold text-white transition-all hover:bg-zinc-800 active:scale-95 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                <Icon name="refresh" size={14} className={sync.running ? "animate-spin" : ""} />
                <span className="hidden sm:inline">{sync.running ? "Abgleich…" : "Abgleich"}</span>
              </button>
              <div className="relative">
                <button onClick={() => setNotifOpen((o) => !o)} className="relative rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Notifications">
                  <Icon name="bell" size={18} />
                  {unreadCount > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-white dark:ring-zinc-950">{unreadCount}</span>}
                </button>
                <div className="absolute right-0 top-11">
                  <NotificationsPanel open={notifOpen} onClose={() => setNotifOpen(false)} />
                </div>
              </div>
              {/* §111 — le bouton « 70 % » (AnsichtMenu §109) est RETIRÉ
                  sur demande du client ; la densité choisie reste appliquée
                  globalement via la lib ansicht, sans aucun contrôle visible. */}
              {/* §48 — l'avatar est CLIQUABLE (menu profil) : « Hell » et le
                  sélecteur de langue cassé ont été retirés sur demande. */}
              <LevelBadge />
              <CollabBar />
              <UserMenu />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] p-6">
          {laborNote && (
            <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100">
              <strong className="font-semibold">Nicht Produktkern. </strong>
              {laborNote}. Beta-Büro nutzt die linke Navigation (IFC, DIN 276, Planprüfung AABB, HOAI, Rechnungen, Baustelle).
            </div>
          )}
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
            <View />
          </div>
        </main>
      </div>

      <CommandPalette />
      <Copilot />
    </div>
  );
}

function SidebarContent({
  view,
  go,
  navigate,
  activeProject,
  projects,
  setActiveProjectId,
  projOpen,
  setProjOpen,
  syncRunning,
  openConflicts,
  userName,
  userAvatarKey,
  roleLabel,
  isOwner,
  onLogout,
}: {
  view: string;
  go: (id: string) => void;
  navigate: (to: string) => void;
  activeProject: ReturnType<typeof useApp>["activeProject"];
  projects: ReturnType<typeof useApp>["projects"];
  setActiveProjectId: (id: string) => void;
  projOpen: boolean;
  setProjOpen: (v: boolean) => void;
  syncRunning: boolean;
  openConflicts: number;
  userName: string;
  userAvatarKey: string;
  roleLabel: string;
  isOwner: boolean;
  onLogout: () => void;
}) {
  // §82 — Team n'est PLUS réservé à l'owner : la page gère elle-même les
  // rôles (gestion owner/admin §80, Notiz live pour tout le bureau §81).
  // Cacher l'entrée privait membres et invités de la co-édition (bug réel).
  const visibleGroups = NAV_GROUPS.filter((g) => g.items.length > 0);
  const unreadMsgs = useUnreadMessages();
  return (
    <>
      {/* §48 — bouton « 💾 Save » retiré (doublon avec DataVault, demande
          utilisateur : à côté du logo ça ne faisait pas chic). Le backup
          automatique reste actif — voir page DataVault. */}
      <div className="flex items-center justify-between px-6 py-6">
        <button onClick={() => navigate("/")} className="flex items-center gap-3 transition-opacity hover:opacity-80">
          <LogoMark size={28} />
          <span className="font-display text-lg font-bold tracking-tight text-zinc-900 dark:text-white">Narchi</span>
        </button>
      </div>

      <div className="relative px-4 mb-6">
        <button
          onClick={() => setProjOpen(!projOpen)}
          className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white p-2.5 text-left transition-all hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 group"
        >
          {/* §48 — VIGNETTE du projet (le chip « code » tronqué faisait bug) :
              mini-bâtiment dérivé des VRAIES données (étages + accent). */}
          <ProjectThumb project={activeProject} size="lg" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{activeProject.name}</span>
            <span className="block text-[11px] text-zinc-500">{activeProject.location}</span>
          </span>
          <Icon name="chevronDown" size={14} className={cn("text-zinc-400 transition-transform duration-300", projOpen && "rotate-180")} />
        </button>
        {projOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setProjOpen(false)} />
            <div className="absolute left-4 right-4 z-20 mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setActiveProjectId(p.id); setProjOpen(false); }}
                  className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900", p.id === activeProject.id && "bg-zinc-100 dark:bg-zinc-900 border-l-2 border-brand-500")}
                >
                  <ProjectThumb project={p} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{p.name}</span>
                    <span className="block text-[11px] text-zinc-500">{p.code}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <nav className="scroll-thin flex-1 space-y-6 overflow-y-auto px-4 pb-6">
        {visibleGroups.map((group) => (
          <div key={group.title}>
            <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">{group.title}</p>
            <div className="space-y-0.5">
              {group.items.map((n) => {
                const active = view === n.id;
                return (
                  <button
                    key={n.id}
                    onClick={() => go(n.id)}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
                      active ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-white" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                    )}
                  >
                    <Icon name={n.icon} size={17} className={cn("transition-colors", active ? "text-brand-500" : "text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300")} />
                    <span className="flex-1 truncate">{n.label}</span>
                    {n.id === "sync" && syncRunning && <span className="h-1.5 w-1.5 animate-ping rounded-full bg-brand-400" />}
                    {n.badge && openConflicts > 0 && (
                      <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold", active ? "bg-zinc-200 text-zinc-900" : "bg-rose-500/10 text-rose-500")}>{openConflicts}</span>
                    )}
                    {n.id === "team" && unreadMsgs > 0 && (
                      <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold", active ? "bg-zinc-200 text-zinc-900" : "bg-cyan-500/10 text-cyan-500")}>{unreadMsgs}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-4 pb-4">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 transition-all hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/50">
          <div className="flex items-center gap-2 text-xs">
            <span className={cn("h-2 w-2 rounded-full", syncRunning ? "animate-pulse bg-brand-400" : "bg-emerald-400")} />
            <span className="font-medium text-zinc-500 dark:text-zinc-400">{syncRunning ? "Abgleich…" : "System bereit"}</span>
          </div>
          <button onClick={() => go("sync")} className="mt-2 text-[11px] font-semibold text-brand-600 hover:text-brand-500 dark:text-brand-400 transition-colors">
            Protokoll →
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-zinc-200 px-6 py-6 dark:border-zinc-800">
        {/* §57 — avatar courant en pastille noire/or (signature NARCHI). */}
        <UserAvatar name={userName} ownerKey={userAvatarKey} size={36} variant="brand" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">{userName}</p>
          <p className="truncate text-[10px] font-medium text-zinc-500 uppercase tracking-wide">{roleLabel}</p>
        </div>
        {isOwner && <IconButton icon="cog" className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => go("settings")} label="Einstellungen" />}
        <IconButton icon="lock" className="text-zinc-400 hover:text-rose-500" onClick={onLogout} label="Abmelden" />
      </div>
    </>
  );
}

function useUnreadMessages(): number {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!user) { setCount(0); return; }
    const update = async () => {
      try {
        const channels = await getChannels(user.id);
        let total = 0;
        for (const c of channels) total += await chatUnread(user.id, c.id);
        setCount(total);
      } catch {
        setCount(0);
      }
    };
    void update();
    const unsub = subscribeChat(() => void update());
    return unsub;
  }, [user]);
  return count;
}

/// §48 — Vignette du projet : mini-bâtiment isométrique DÉRIVÉ DES VRAIES
/// DONNÉES (nombre d'étages → nombre de dalles), stable et déterministe —
/// remplace le chip « code » tronqué qui faisait visuellement « bug ».
/// Aucune image fictive : pure géométrie SVG.
/// §57 — rendu EN NOIR (zinc-900, fondu vertical) sur demande utilisateur :
/// plus chic ; la teinte d'accent n'est plus utilisée ici.
function ProjectThumb({
  project,
  size = "md",
}: {
  project: { name: string; accent: string; floors?: number };
  size?: "md" | "lg";
}) {
  const floors = Math.max(1, Math.min(9, Math.round(project.floors || 3)));
  // §57 — vignette EN NOIR (demande utilisateur : plus chic). La géométrie
  // reste dérivée des VRAIES données (nombre d'étages → hauteur des dalles) ;
  // seule la teinte d'accent est abandonnée au profit d'une encre zinc-900
  // à fondu vertical, fenêtres claires conservées.
  const ink = "#18181b"; // zinc-900
  const slabH = 18 / floors;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-300 bg-zinc-100 transition-transform group-hover:scale-105 dark:border-zinc-700 dark:bg-zinc-800",
        size === "lg" ? "h-10 w-10" : "h-8 w-8",
      )}
      title={`${project.name} · ${floors} ${floors === 1 ? "Etage" : "Etagen"}`}
    >
      <svg viewBox="0 0 24 24" className={size === "lg" ? "h-8 w-8" : "h-6 w-6"} aria-hidden="true">
        {Array.from({ length: floors }, (_, i) => {
          const y = 21 - i * slabH;
          return (
            <g key={i}>
              <rect x="5" y={y - slabH + 0.6} width="14" height={Math.max(1.4, slabH - 0.6)} rx="0.8" fill={ink} opacity={0.38 + (0.58 * i) / Math.max(1, floors - 1)} />
              {/* fenêtres : fente claire au centre de chaque dalle */}
              <rect x="8" y={y - slabH / 2 - 0.5} width="8" height="1" rx="0.5" fill="#ffffff" opacity="0.85" />
            </g>
          );
        })}
        {/* couronnement */}
        <rect x="10" y="1.5" width="4" height="3" rx="0.7" fill={ink} />
      </svg>
    </span>
  );
}
