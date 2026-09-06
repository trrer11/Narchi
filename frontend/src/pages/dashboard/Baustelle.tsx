// §104/§105/§106 — « Baustelle » (IDÉE CLIENT, voie bureau).
//
// Le flux réel : l'architecte photographie avec son téléphone, puis AU
// BUREAU il importe les images ici. Narchi regroupe par VRAIE date de
// prise de vue (EXIF JPEG/PNG/WebP, nom de fichier, date de fichier en
// dernier — la source est toujours affichée), découpe les séances
// (> 10 min sans photo) et transforme une sélection cochée en vrai
// Mangel. Jamais d'analyse de contenu, jamais de synchro promise.
//
// §106 (retours client + relecture de SA capture) :
//  - CORRECTIF RÉEL : le balayage des photos orphelines s'exécutait avant
//    la fin de réhydratation du store (IndexedDB asynchrone) → les photos
//    des Mängel existants étaient vues comme « orphelines » et POUVAIENT
//    ÊTRE EFFACÉES au rechargement. Désormais : balayage UNIQUEMENT après
//    hydratation terminée (persist.hasHydrated / onFinishHydration).
//  - GARDE « Kein Projekt » : sans projet réel choisi, un Mangel se
//    rattachait au projet fantôme (id « », « Tag 0 » fallacieux).
//    Désormais : import et création bloqués avec explication.
//  - INFOS : clic sur une photo de Mangel → visionneuse plein écran ;
//    photo disparue = tuile HONNÊTE « nicht gefunden » (jamais un trou
//    silencieux) ; chaque Mangel affiche gravité + nombre de photos.

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Badge, Button, Card, Icon } from "@/components/ui";
import { cn } from "@/utils/cn";
import { NMC_GROUPS } from "@/data/classification";
import type { Issue, IssueSeverity, Project } from "@/data/types";
import { useApp, useAppStore } from "@/store/AppStore";
import { secureFetch } from "@/auth/SecuritySanitizer";
import { classifyImportFile, IMPORT_ACCEPT, photoTakenAt } from "@/lib/exif";
import { videoTakenAt } from "@/lib/mp4date";
import { IssueSyncBadge } from "@/components/IssueSyncBadge";
import {
  buildPhotoMangel,
  countPhotoSources,
  formatDayLabel,
  formatPhotoCount,
  formatTimeOf,
  formatTimeRange,
  formatVideoCount,
  groupVisits,
  type ChanPhoto,
} from "@/lib/chantier";
import {
  deleteMangelPhoto,
  loadMangelPhoto,
  saveMangelPhoto,
  supportsIdb,
  sweepOrphanPhotos,
} from "@/lib/mangelPhotos";

const SEVERITIES: Array<{
  value: IssueSeverity;
  label: string;
  active: string;
  dot: string;
}> = [
  { value: "minor", label: "Gering", active: "bg-zinc-900 text-white ring-zinc-900", dot: "bg-zinc-400" },
  { value: "major", label: "Erheblich", active: "bg-brand-600 text-white ring-brand-600", dot: "bg-brand-500" },
  { value: "critical", label: "Kritisch", active: "bg-rose-600 text-white ring-rose-600", dot: "bg-rose-500" },
];

const SEVERITY_BADGE: Record<IssueSeverity, { label: string; tone: "slate" | "amber" | "rose" }> = {
  minor: { label: "Gering", tone: "slate" },
  major: { label: "Erheblich", tone: "amber" },
  critical: { label: "Kritisch", tone: "rose" },
};

/** §109 — Le réglage de densité n'est PLUS ici : le client parlait du
 *  zoom de l'INTERFACE entière (widget page-seule §107 = erreur
 *  d'interprétation, retirée). Voir la barre du haut (« Ansicht ») et
 *  src/lib/ansicht.ts. */

type PendingPhoto = ChanPhoto & { url: string | null };

/** ObjectURL si le navigateur l'offre (jsdom non — tuile neutre honnête,
 *  jamais de plantage) ; la révocation suit la vie du composant. */
function makePreviewUrl(blob: Blob): string | null {
  return typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
    ? URL.createObjectURL(blob)
    : null;
}

/** Pastille icône en tête de carte — la signature visuelle de la page. */
function Chip({ icon, tone = "brand" }: { icon: "camera" | "calendar" | "flag" | "upload"; tone?: "brand" | "zinc" }) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-xl",
        tone === "brand" ? "bg-brand-500/10 text-brand-600" : "bg-zinc-100 text-zinc-500",
      )}
    >
      <Icon name={icon} size={16} />
    </span>
  );
}

type ThumbState = "loading" | "ok" | "nomissing-url" | "missing";

/** Visionneuse plein écran : les photos d'un Mangel, en grand (§106 —
 *  « ça ne donnait aucune information »). Esc ou clic = fermer. */
function PhotoLightbox({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  const [urls, setUrls] = useState<Array<{ id: string; url: string | null; video: boolean }> | null>(null);
  useEffect(() => {
    let alive = true;
    const created: string[] = [];
    void Promise.all(
      (issue.photoIds ?? []).map(async (id) => {
        const blob = await loadMangelPhoto(id);
        const url = blob ? makePreviewUrl(blob) : null;
        if (url) created.push(url);
        // §110 — le type du BLOB (persisté avec lui) décide du lecteur :
        // <video controls> pour les vidéos, <img> pour les photos.
        return { id, url, video: !!blob && blob.type.startsWith("video/") };
      }),
    ).then((list) => {
      if (alive) setUrls(list);
      else created.forEach((u) => URL.revokeObjectURL(u));
    });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [issue, onClose]);

  const count = issue.photoIds?.length ?? 0;
  return (
    <div
      role="dialog"
      aria-label={`Fotos: ${issue.title}`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950/85 p-6 backdrop-blur-sm"
    >
      <div
        className="w-full max-w-4xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 text-white">
          <div className="min-w-0">
            <div className="truncate font-display text-lg font-semibold">{issue.title}</div>
            <div className="text-xs text-zinc-400">
              {formatPhotoCount(count)} · Tag {issue.raisedDay} · {issue.assignee} — Dateien auf diesem Gerät, Text synchronisiert
            </div>
          </div>
          <button
            type="button"
            aria-label="Visionneuse schließen"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-xl text-white transition-colors hover:bg-white/20"
          >
            ×
          </button>
        </div>
        <div
          className={cn(
            "mt-4 grid gap-3",
            count <= 1 ? "grid-cols-1" : count === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3",
          )}
        >
          {(urls ?? []).map(({ id, url, video }) =>
            url ? (
              video ? (
                <video
                  key={id}
                  src={url}
                  controls
                  playsInline
                  className="max-h-[60vh] w-full rounded-2xl border border-white/10 bg-zinc-950"
                />
              ) : (
                <img
                  key={id}
                  src={url}
                  alt="Mangel-Foto"
                  className="max-h-[60vh] w-full rounded-2xl border border-white/10 object-contain bg-zinc-900"
                />
              )
            ) : (
              <div
                key={id}
                className="flex h-40 items-center justify-center rounded-2xl border border-white/10 bg-zinc-900 text-xs text-zinc-500"
              >
                Datei nicht (mehr) auf diesem Gerät
              </div>
            ),
          )}
          {urls === null && (
            <div className="flex h-40 items-center justify-center rounded-2xl border border-white/10 bg-zinc-900 text-xs text-zinc-500">
              Fotos werden geladen…
            </div>
          )}
          {urls !== null && count === 0 && (
            <div className="flex h-40 items-center justify-center rounded-2xl border border-white/10 bg-zinc-900 text-xs text-zinc-500">
              Kein Foto angehängt
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Vignette d'une photo d'Issue : blob IDB → objectURL, tuile honnête si
 *  la photo n'existe plus ; clic → visionneuse (§106). */
function IssuePhotoThumb({ photoId, onOpen }: { photoId: string; onOpen: () => void }) {
  const [state, setState] = useState<ThumbState>("loading");
  const [url, setUrl] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadMangelPhoto(photoId).then((blob) => {
      if (!alive) return;
      if (!blob) { setState("missing"); return; }
      setIsVideo(blob.type.startsWith("video/"));
      const objectUrl = makePreviewUrl(blob);
      if (objectUrl) { setUrl(objectUrl); setState("ok"); }
      else setState("nomissing-url"); // blob vivant, rendu impossible ici (jsdom)
    });
    return () => { alive = false; };
  }, [photoId]);

  const base = "h-14 w-14 shrink-0 overflow-hidden rounded-lg border transition-transform hover:scale-105";
  if (state === "ok" && url) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={isVideo ? "Video vergrößern" : "Foto vergrößern"}
        className={cn(base, "border-zinc-200")}
      >
        {isVideo ? (
          <span className="relative block h-full w-full bg-zinc-950">
            <video src={url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
            <span className="absolute inset-0 flex items-center justify-center text-white">
              <Icon name="film" size={18} />
            </span>
          </span>
        ) : (
          <img src={url} alt="Mangel-Foto" className="h-full w-full object-cover" />
        )}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={
        state === "missing"
          ? "Datei nicht mehr vorhanden"
          : isVideo
            ? "Video vergrößern"
            : "Foto vergrößern"
      }
      title={state === "missing" ? "Datei nicht (mehr) auf diesem Gerät" : undefined}
      className={cn(
        base,
        state === "missing"
          ? "border-rose-200 bg-rose-50 text-rose-400"
          : "border-zinc-200 bg-zinc-100 text-zinc-400",
        "flex items-center justify-center",
      )}
    >
      <Icon name={state === "missing" ? "alert" : isVideo ? "film" : "camera"} size={18} />
    </button>
  );
}

export default function Baustelle() {
  const { activeProject, activeProjectId, projects, issues, addIssue, setIssueStatus, setActiveProjectId, addProject } = useApp();
  const hasProject = activeProject.id !== "";

  // §111 — « je ne peux TOUJOURS pas importer » : la VRAIE cause chez le
  // client était que sa liste de projets est VIDE. Il n'y a ni seed ni
  // synchro serveur : un projet ne naît que s'il est créé à la main (page
  // Projekte) — donc ma consigne §110 « Wähle oben links ein Projekt »
  // pointait vers un sélecteur SANS RIEN à choisir = cul-de-sac honteux.
  // Correctif double : (a) si des projets existent sans choix en mémoire,
  // on fixe le choix TOUT SEUL (le repli d'affichage de useApp masquait ce
  // vide : la page montrait un projet que le sélecteur affichait comme
  // non choisi — incohérence réparée à la racine) ; (b) sinon la carte
  // ambrée CRÉE le premier projet ici même, un nom suffit, et l'import se
  // débloque aussitôt.
  useEffect(() => {
    if (!activeProjectId && projects.length > 0) setActiveProjectId(projects[0].id);
  }, [activeProjectId, projects, setActiveProjectId]);

  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [importNote, setImportNote] = useState<string | null>(null);
  const [importHadProblems, setImportHadProblems] = useState(false);
  const [firstProjectName, setFirstProjectName] = useState("");

  /** §111 — création du TOUT PREMIER projet sans quitter la page :
   *  un nom suffit, addProject le choisit aussitôt (projectSlice) →
   *  l'import se débloque dans la foulée. Même politique que la page
   *  Projekte : tentative côté serveur, conservation locale sinon. */
  const createFirstProject = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = firstProjectName.trim();
    if (!name) return;
    const today = new Date().toISOString().slice(0, 10);
    const newP: Project = {
      id: "prj-" + Math.random().toString(36).slice(2, 8),
      code: "PRJ-" + Date.now().toString(36).toUpperCase(),
      name,
      type: "Residential",
      location: "",
      client: "",
      status: "planning",
      progress: 0,
      budget: 0,
      spent: 0,
      grossFloorArea: 0,
      floors: 1,
      startDate: today,
      endDate: "",
      team: [],
      classificationCode: "DIN-276",
      carbonBudgetKg: 0,
      health: 100,
      riskScore: 0,
      accent: "#3b82f6",
    };
    void secureFetch("/api/v5/ifc/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newP),
    }).catch(() => undefined);
    addProject(newP);
    setFirstProjectName("");
    setImportHadProblems(false);
    setImportNote(
      `Projekt „${name}“ angelegt und automatisch gewählt — der Import ist jetzt freigegeben.`,
    );
  };
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [lightboxIssue, setLightboxIssue] = useState<Issue | null>(null);

  const [title, setTitle] = useState("");
  const [gewerk, setGewerk] = useState(NMC_GROUPS[0]?.code ?? "");
  const [zone, setZone] = useState("");
  const [severity, setSeverity] = useState<IssueSeverity>("major");
  const [description, setDescription] = useState("");

  // §106 — Balayage des orphelines MAIS JAMAIS avant la fin de la
  // réhydratation du store (IndexedDB asynchrone) : sinon les photos des
  // Mängel existants passent pour « orphelines » et pourraient être
  // effacées au rechargement. Correctif lu dans la capture du client.
  useEffect(() => {
    let alive = true;
    let done = false;
    const run = () => {
      if (done || !alive) return;
      done = true;
      const referenced = new Set(
        useAppStore.getState().issues.flatMap((issue) => issue.photoIds ?? []),
      );
      void sweepOrphanPhotos(referenced, "foto-");
    };
    if (useAppStore.persist.hasHydrated()) {
      run();
      return () => { alive = false; };
    }
    const unsubscribe = useAppStore.persist.onFinishHydration(() => run());
    return () => { alive = false; unsubscribe(); };
  }, []);

  // ObjectURLs des photos en attente : révoquées au démontage.
  const pendingRef = useRef<PendingPhoto[]>([]);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  useEffect(() => {
    return () => {
      for (const photo of pendingRef.current) {
        if (photo.url) URL.revokeObjectURL(photo.url);
      }
    };
  }, []);

  const visits = useMemo(() => groupVisits(pending), [pending]);
  const pendingById = useMemo(
    () => new Map(pending.map((photo) => [photo.id, photo])),
    [pending],
  );
  const selectedPhotos = useMemo(
    () => pending.filter((photo) => selected.has(photo.id)),
    [pending, selected],
  );

  const projectIssues = useMemo(
    () => issues.filter((issue) => issue.projectId === activeProject.id),
    [issues, activeProject.id],
  );
  const openIssues = useMemo(
    () => projectIssues.filter((issue) => issue.status !== "resolved"),
    [projectIssues],
  );

  const ingest = async (files: File[]) => {
    if (!hasProject) return;
    setFeedback(null);
    let importedPhotos = 0;
    let importedVideos = 0;
    let failed = 0;
    let heic = 0;
    let badVideo = 0;
    let other = 0;
    const added: PendingPhoto[] = [];
    for (const [index, file] of files.entries()) {
      const kind = classifyImportFile(file);
      if (kind === "heic") { heic += 1; continue; }
      if (kind === "video-incompatible") { badVideo += 1; continue; }
      if (kind === "other") { other += 1; continue; }
      // §110 — vidéo : date de tournage lue dans la boîte mvhd (MP4/MOV) ;
      // photo : EXIF. Dans les deux cas la SOURCE est affichée, jamais
      // une date « sûre » qui viendrait du dernier recours.
      const dating = kind === "video" ? await videoTakenAt(file) : await photoTakenAt(file);
      const id = `foto-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`;
      if (!(await saveMangelPhoto(id, file))) {
        failed += 1;
        continue;
      }
      if (kind === "video") importedVideos += 1; else importedPhotos += 1;
      added.push({
        id,
        name: file.name,
        takenAt: dating.takenAt.getTime(),
        source: dating.source,
        kind: kind === "video" ? "video" : "photo",
        url: makePreviewUrl(file),
      });
    }
    setPending((prev) => [...prev, ...added]);

    const parts: string[] = [];
    if (added.length > 0) {
      const counts = countPhotoSources(added);
      const sourceParts: string[] = [];
      if (counts.exif > 0) sourceParts.push(`${counts.exif} × Aufnahmedatum (EXIF)`);
      if (counts.meta > 0) sourceParts.push(`${counts.meta} × Aufnahmedatum (Video-Metadaten)`);
      if (counts.nom > 0) sourceParts.push(`${counts.nom} × Dateiname`);
      if (counts.date > 0) sourceParts.push(`${counts.date} × Dateidatum — Aufnahmedatum fehlt!`);
      const totals: string[] = [];
      if (importedPhotos > 0) totals.push(formatPhotoCount(importedPhotos));
      if (importedVideos > 0) totals.push(formatVideoCount(importedVideos));
      parts.push(`${totals.join(" + ")} importiert — ${sourceParts.join(" · ")}.`);
    }
    if (other > 0) parts.push(`${other} übersprungen (kein unterstütztes Bild/Video).`);
    if (badVideo > 0) {
      parts.push(
        `${badVideo} × Video nicht abspielbar im Browser (AVI/MKV/WMV…) — ` +
          "nie importieren und kaputt anzeigen: bitte MP4/WebM/MOV vom Handy.",
      );
    }
    if (heic > 0) {
      parts.push(
        `${heic} × HEIC (iPhone): Browser kann es nicht anzeigen — ` +
          "iPhone: Einstellungen → Kamera → Formate → „Maximale Kompatibilität“ " +
          "(oder USB-Transfer „Automatisch“ liefert JPEG).",
      );
    }
    if (failed > 0) parts.push(`${failed} konnten nicht gespeichert werden.`);
    setImportHadProblems(other > 0 || heic > 0 || badVideo > 0 || failed > 0);
    setImportNote(parts.length > 0 ? parts.join(" ") : null);
  };

  const togglePhoto = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleDay = (photoIds: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = photoIds.every((id) => next.has(id));
      for (const id of photoIds) {
        if (allIn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const discard = (photo: PendingPhoto) => {
    void deleteMangelPhoto(photo.id);
    if (photo.url) URL.revokeObjectURL(photo.url);
    setPending((prev) => prev.filter((p) => p.id !== photo.id));
    setSelected((prev) => {
      if (!prev.has(photo.id)) return prev;
      const next = new Set(prev);
      next.delete(photo.id);
      return next;
    });
  };

  /** §110 — comptage honnête photo/vidéo (jamais « 2 Fotos » si l'une est
   *  une vidéo) ; §104 : comptage photo pur inchangé (« 2 Fotos »). */
  const mediaLabelFor = (ids: string[]): string => {
    let videos = 0;
    for (const id of ids) if (pendingById.get(id)?.kind === "video") videos += 1;
    const photos = ids.length - videos;
    const parts: string[] = [];
    if (photos > 0) parts.push(formatPhotoCount(photos));
    if (videos > 0) parts.push(formatVideoCount(videos));
    return parts.join(" + ") || "0 Fotos"; // vide = même rendu qu'avant §110
  };

  const discardSelection = () => {
    for (const photo of selectedPhotos) discard(photo);
    setFeedback("Auswahl verworfen — Fotos gelöscht, kein Mangel angelegt.");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!hasProject || selectedPhotos.length === 0) return;
    const now = new Date();
    const id = `mgl-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const photoIds = selectedPhotos.map((photo) => photo.id);
    // §110 — les vidéos de la sélection restent traçables sur le Mangel
    // (compteurs « 1 Foto + 1 Video » honnêtes, sans recharger les blobs).
    const videoIds = selectedPhotos.filter((photo) => photo.kind === "video").map((photo) => photo.id);
    const earliestTakenAt = Math.min(...selectedPhotos.map((photo) => photo.takenAt));

    addIssue(
      buildPhotoMangel(
        {
          title,
          description,
          severity,
          classificationCode: gewerk,
          level: zone,
          photoIds,
          videoIds,
          earliestTakenAt,
        },
        activeProject,
        now,
        id,
      ),
    );

    // Les photos rattachées ne sont plus « en attente » : l'Issue les
    // possède (les blobs restent en IDB sous leurs clés).
    const consumed = new Set(photoIds);
    setPending((prev) => prev.filter((photo) => !consumed.has(photo.id)));
    setSelected(new Set());
    setTitle("");
    setZone("");
    setDescription("");
    setSeverity("major");
    setGewerk(NMC_GROUPS[0]?.code ?? "");
    const photosOnly = photoIds.length - videoIds.length;
    const attachedParts: string[] = [];
    if (photosOnly > 0) attachedParts.push(formatPhotoCount(photosOnly));
    if (videoIds.length > 0) attachedParts.push(formatVideoCount(videoIds.length));
    setFeedback(
      `Mangel gespeichert — ${attachedParts.join(" + ") || "0 Fotos"} angehängt. ` +
        "Text wird mit dem Server synchronisiert (Fotos/Videos bleiben auf diesem Gerät); sichtbar im Cockpit unter „Issues“." +
        (supportsIdb() ? "" : " (kein IndexedDB — nur diese Sitzung!)"),
    );
  };

  /** §110 — « je ne peux plus rien importer » : sans projet, l'import est
   *  volontairement bloqué (garde §106)… mais le blocage était SILENCIEUX
   *  (input disabled = clic mort → sensation de panne). Désormais la zone
   *  le DIT en permanence, et un clic/dépose explique la marche à suivre.
   *  §111 — le message distingue le vrai cas du client : ZÉRO projet dans
   *  la liste (sélecteur vide) — le remède est alors la CRÉATION, pas le
   *  choix ; pointer vers « oben links » serait un faux remède. */
  const explainProjectMissing = () => {
    setImportHadProblems(true);
    setImportNote(
      projects.length === 0
        ? "Es gibt noch gar kein Projekt — darum ist der Import gesperrt. " +
            "Lege oben im gelben Kasten dein erstes Projekt an (ein Name genügt), " +
            "danach funktioniert der Import sofort."
        : "Kein Projekt gewählt — darum ist der Import gesperrt. " +
            "Wähle oben links ein Projekt, danach funktioniert der Import sofort.",
    );
  };

  const fieldClass =
    "mt-1.5 h-12 w-full rounded-xl border border-zinc-200 bg-white px-3.5 text-sm text-zinc-800 shadow-sm transition-shadow placeholder:text-zinc-300 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-400/15";
  const labelClass = "text-xs font-semibold uppercase tracking-wide text-zinc-400";

  // §109 — pleine largeur (les « côtés vides » de la capture client
  // venaient du « mx-auto max-w-3xl » : colonne de 768 px perdue au milieu
  // d'un écran large) ; plus AUCUN widget de zoom ici : la densité est un
  // réglage d'interface (barre du haut).
  return (
    <div id="bm-page" className="space-y-6">
      {/* ── En-tête « dossier de chantier » ─────────────────────────── */}
      <header className="relative overflow-hidden rounded-2xl bg-zinc-950 text-white shadow-xl shadow-zinc-900/10">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-brand-500/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-28 left-1/3 h-56 w-56 rounded-full bg-brand-400/10 blur-3xl" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
            backgroundSize: "36px 36px",
          }}
        />
        <div className="relative px-6 pb-5 pt-6">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-300">
                <Icon name="camera" size={14} /> Baustellendoku
              </div>
              <h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight">Baustelle</h1>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                {hasProject ? `${activeProject.name} · ` : ""}
                Empfohlener Weg: Fotos per WhatsApp/Telegram ins Büro schicken, hier ablegen —
                gruppiert nach Aufnahmedatum. Kein HTTPS-Telefon nötig.
              </p>
              {/* §117 — état RÉEL de la synchro, jamais décoratif */}
              <div className="mt-2"><IssueSyncBadge /></div>
            </div>
            <div className="hidden h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-brand-500 text-zinc-950 shadow-lg shadow-brand-500/40 sm:flex">
              <Icon name="camera" size={30} />
            </div>
          </div>
          {/* Statistiques réelles — jamais décoratives */}
          <div className="mt-5 grid grid-cols-3 gap-3">
            {[
              { label: "Offene Mängel", value: openIssues.length },
              { label: "Besuchstage", value: visits.length },
              { label: "Fotos bereit", value: pending.length },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 backdrop-blur-sm"
              >
                <div className="font-display text-xl font-bold tabular-nums">{stat.value}</div>
                <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* ── Garde « Kein Projekt » (§106) enrichie §111 : zéro projet
          dans la liste = la VRAIE panne du client — la carte CRÉE le
          premier projet ici même au lieu de pointer un sélecteur vide. */}
      {!hasProject && (
        <Card className="border-amber-200 bg-amber-50 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700">
              <Icon name="alert" size={18} />
            </span>
            {projects.length === 0 ? (
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-base font-semibold text-amber-900">Noch gar kein Projekt angelegt</h2>
                <p className="mt-1 text-sm leading-relaxed text-amber-800">
                  Darum war der Import für dich <strong>komplett</strong> gesperrt:
                  oben links gab es schlicht <strong>nichts zum Wählen</strong>.
                  Lege hier dein erstes Projekt an — ein Name genügt, 10 Sekunden —
                  danach funktioniert der Foto- und Video-Import sofort.
                </p>
                <form onSubmit={createFirstProject} className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    id="bm-first-project"
                    value={firstProjectName}
                    onChange={(e) => setFirstProjectName(e.target.value)}
                    placeholder="z. B. Anbau Familie Meyer, Hannover"
                    aria-label="Name des ersten Projekts"
                    className="h-11 flex-1 rounded-xl border border-amber-300 bg-white px-3.5 text-sm text-zinc-800 shadow-sm placeholder:text-zinc-400 focus:border-amber-500 focus:outline-none focus:ring-4 focus:ring-amber-400/20"
                  />
                  <Button type="submit" variant="primary" icon="check" disabled={firstProjectName.trim() === ""}>
                    Projekt anlegen &amp; Import freigeben
                  </Button>
                </form>
              </div>
            ) : (
              <div>
                <h2 className="font-display text-base font-semibold text-amber-900">Kein Projekt gewählt</h2>
                <p className="mt-1 text-sm leading-relaxed text-amber-800">
                  Wähle oben links ein Projekt aus — sonst hängen Mängel am Nichts:
                  kein echter „Tag N“, keine Zuordnung, keine Fotos im Cockpit.
                </p>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* §109 — deux colonnes sur grand écran (la largeur est enfin
          utilisée) : gauche = le FLUX (importer → visites), droite = le
          RÉSULTAT (créer le Mangel → Mängel ouverts). Empilé sur petit
          écran, dans le même ordre logique. */}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0 space-y-6">
      {/* ── Import : glisser-déposer ou clic ────────────────────────── */}
      <Card className="p-5 sm:p-6">
        <div className="flex items-center gap-2.5">
          <Chip icon="upload" />
          <h2 className="font-display text-base font-semibold text-zinc-900">Fotos importieren</h2>
        </div>
        <label
          htmlFor="bm-import"
          aria-disabled={!hasProject}
          onClick={(e) => {
            // §110 — sans projet : clic pas MORT, il EXPLIQUE (l'input
            // reste disabled — jamais d'import fantôme silencieux).
            if (!hasProject) {
              e.preventDefault();
              explainProjectMissing();
            }
          }}
          onDragEnter={(e) => { e.preventDefault(); if (hasProject) setDragActive(true); }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            if (!hasProject) {
              explainProjectMissing();
              return;
            }
            void ingest(Array.from(e.dataTransfer.files));
          }}
          className={cn(
            "group mt-4 flex cursor-pointer flex-col items-center gap-2.5 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all duration-200",
            !hasProject && "border-amber-300 bg-amber-50/60 hover:bg-amber-50",
            hasProject && (dragActive
              ? "scale-[1.01] border-brand-400 bg-brand-50 ring-4 ring-brand-400/20"
              : "border-zinc-200 bg-gradient-to-b from-zinc-50 to-white hover:border-brand-300 hover:bg-brand-50/40"),
          )}
        >
          <span className={cn(
            "flex h-14 w-14 items-center justify-center rounded-2xl transition-transform duration-200 group-hover:scale-110",
            hasProject ? "bg-brand-500/10 text-brand-600" : "bg-amber-500/15 text-amber-600",
          )}>
            <Icon name={hasProject ? "camera" : "alert"} size={26} />
          </span>
          <span className={cn("font-display text-sm font-semibold", hasProject ? "text-zinc-800" : "text-amber-900")}>
            {hasProject
              ? "Fotos & Videos hierher ziehen oder klicken"
              : projects.length === 0
                ? "Zuerst dein erstes Projekt anlegen (oben im gelben Kasten)"
                : "Zuerst ein Projekt wählen (oben links)"}
          </span>
          <span className="text-xs text-zinc-400">
            JPEG · PNG · WebP · GIF · MP4 · WebM · MOV — auch aus WhatsApp/Telegram heruntergeladen · Mehrfachauswahl
          </span>
          {!hasProject && (
            <span className="flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-700">
              <Icon name="alert" size={12} /> Import gesperrt — kein Projekt
            </span>
          )}
          <input
            id="bm-import"
            type="file"
            accept={IMPORT_ACCEPT}
            multiple
            disabled={!hasProject}
            className="sr-only"
            onChange={(e) => {
              void ingest(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </label>
        {importNote && (
          <p
            className={cn(
              "mt-3 flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs leading-relaxed",
              importHadProblems
                ? "bg-amber-50 text-amber-800 ring-1 ring-amber-600/15"
                : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/15",
            )}
          >
            <Icon name={importHadProblems ? "alert" : "check"} size={14} className="mt-0.5 shrink-0" />
            <span>{importNote}</span>
          </p>
        )}
        <p className="mt-3 text-xs leading-relaxed text-zinc-400">
          Ehrlich gesagt: Narchi gruppiert nach Aufnahmedatum (EXIF der Fotos,
          Video-Metadaten der MP4/MOV), Dateiname oder Dateidatum —{" "}
          <strong className="font-medium text-zinc-500">keine</strong> Bilderkennung.
          Nichts wird hochgeladen, alles bleibt in diesem Browser. Videos:
          MP4/WebM/MOV, die dein Browser abspielen kann (iPhone-HEVC kann je
          nach Browser dunkel bleiben — dann Kamera-Format „Maximale Kompatibilität“).
        </p>
      </Card>

      {/* ── Besuche : l'agenda photo ────────────────────────────────── */}
      <Card className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Chip icon="calendar" />
            <h2 className="font-display text-base font-semibold text-zinc-900">Besuche</h2>
          </div>
          <Badge tone={pending.length > 0 ? "amber" : "slate"}>
            {mediaLabelFor(pending.map((photo) => photo.id))}
          </Badge>
        </div>
        {visits.length === 0 ? (
          <div className="mt-4 flex items-center gap-3.5 rounded-2xl border border-dashed border-zinc-200 bg-gradient-to-b from-zinc-50/80 to-white px-5 py-6">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400">
              <Icon name="calendar" size={20} />
            </span>
            <p className="text-sm leading-relaxed text-zinc-400">
              Noch keine Fotos importiert — sie erscheinen hier gruppiert nach Besuchstag.
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-6">
            {visits.map((day) => {
              const dayIds = day.sessions.flatMap((session) => session.photoIds);
              const allIn = dayIds.every((id) => selected.has(id));
              return (
                <section key={day.dayKey} className="flex gap-4">
                  {/* Rail date */}
                  <div className="flex w-12 shrink-0 flex-col items-center">
                    <div className="w-full rounded-xl bg-zinc-950 py-1.5 text-center text-white shadow-md">
                      <div className="font-display text-lg font-bold leading-none">
                        {day.label.slice(0, 2)}
                      </div>
                      <div className="mt-0.5 text-[9px] font-medium uppercase tracking-wider text-zinc-400">
                        {day.label.slice(3)}
                      </div>
                    </div>
                    <div className="mt-2 w-px flex-1 bg-gradient-to-b from-zinc-200 to-transparent" />
                  </div>
                  {/* Contenu du jour */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="truncate text-sm font-semibold text-zinc-800">
                        Besuch vom {day.label}{" "}
                        <span className="font-normal text-zinc-400">
                          · {mediaLabelFor(dayIds)}
                        </span>
                      </h3>
                      <Button size="sm" variant="secondary" onClick={() => toggleDay(dayIds)}>
                        {allIn ? "Tag abwählen" : "Tag auswählen"}
                      </Button>
                    </div>
                    {day.sessions.map((session) => (
                      <div key={session.key} className="mt-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600">
                            <Icon name="clock" size={12} />
                            {formatTimeRange(session.from, session.to)}
                          </span>
                          <span className="text-[11px] text-zinc-400">
                            {mediaLabelFor(session.photoIds)}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2.5">
                          {session.photoIds.map((photoId) => {
                            const photo = pendingById.get(photoId);
                            if (!photo) return null;
                            const isChecked = selected.has(photo.id);
                            return (
                              <div
                                key={photo.id}
                                onClick={() => togglePhoto(photo.id)}
                                className="group relative w-24 cursor-pointer select-none"
                              >
                                <div
                                  className={cn(
                                    "relative h-24 w-24 overflow-hidden rounded-xl border transition-all duration-150",
                                    isChecked
                                      ? "border-brand-500 shadow-md shadow-brand-500/25 ring-2 ring-brand-500"
                                      : "border-zinc-200 group-hover:border-brand-300 group-hover:shadow-md",
                                  )}
                                >
                                  {photo.url ? (
                                    photo.kind === "video" ? (
                                      <span className="relative block h-full w-full bg-zinc-950">
                                        {/* §110 — vraie vidéo (1re image), jamais de cadre cassé */}
                                        <video
                                          src={photo.url}
                                          muted
                                          playsInline
                                          preload="metadata"
                                          className="h-full w-full object-cover"
                                        />
                                        <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded-md bg-zinc-950/80 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                                          <Icon name="film" size={10} /> Video
                                        </span>
                                      </span>
                                    ) : (
                                      <img
                                        src={photo.url}
                                        alt={photo.name}
                                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                                      />
                                    )
                                  ) : (
                                    <div
                                      className="flex h-full w-full items-center justify-center bg-zinc-100 text-zinc-400"
                                      title={photo.name}
                                    >
                                      <Icon name={photo.kind === "video" ? "film" : "camera"} size={22} />
                                    </div>
                                  )}
                                  {/* Indicateur de sélection */}
                                  {isChecked && (
                                    <span className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-white shadow">
                                      <Icon name="check" size={12} />
                                    </span>
                                  )}
                                </div>
                                <input
                                  type="checkbox"
                                  aria-label={photo.name}
                                  checked={isChecked}
                                  onChange={() => togglePhoto(photo.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="sr-only"
                                />
                                <button
                                  type="button"
                                  aria-label={`${photo.name} verwerfen`}
                                  title="Foto verwerfen (wird gelöscht)"
                                  onClick={(e) => { e.stopPropagation(); discard(photo); }}
                                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-bold text-white opacity-0 shadow transition-opacity hover:bg-rose-600 focus:opacity-100 group-hover:opacity-100"
                                >
                                  ×
                                </button>
                                <div className="mt-1 text-center text-[10px] tabular-nums text-zinc-400">
                                  {formatTimeOf(photo.takenAt)}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </Card>

      </div>
      <div className="min-w-0 space-y-6">
      {/* ── Mangel aus Auswahl ──────────────────────────────────────── */}
      <Card className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Chip icon="flag" />
            <h2 className="font-display text-base font-semibold text-zinc-900">Mangel aus Auswahl</h2>
          </div>
          <Badge tone={selectedPhotos.length > 0 ? "amber" : "slate"}>
            {selectedPhotos.length} ausgewählt
          </Badge>
        </div>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="bm-title" className={labelClass}>Titel</label>
            <input
              id="bm-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="z. B. Riss in Treppenlauf OG 2"
              className={fieldClass}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="bm-gewerk" className={labelClass}>Gewerk (NMC)</label>
              <select
                id="bm-gewerk"
                value={gewerk}
                onChange={(e) => setGewerk(e.target.value)}
                className={fieldClass}
              >
                {NMC_GROUPS.map((group) => (
                  <option key={group.code} value={group.code}>{group.code} — {group.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="bm-zone" className={labelClass}>
                Ebene / Zone <span className="font-normal normal-case text-zinc-300">(optional)</span>
              </label>
              <input
                id="bm-zone"
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                placeholder="z. B. OG 2"
                className={fieldClass}
              />
            </div>
          </div>
          <div>
            <span className={labelClass}>Schweregrad</span>
            <div className="mt-1.5 flex gap-2">
              {SEVERITIES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  aria-pressed={severity === s.value}
                  onClick={() => setSeverity(s.value)}
                  className={cn(
                    "flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-medium ring-1 transition-all duration-150",
                    severity === s.value
                      ? s.active
                      : "bg-white text-zinc-500 ring-zinc-200 hover:bg-zinc-50 hover:text-zinc-700",
                  )}
                >
                  <span className={cn("h-2 w-2 rounded-full", s.dot, severity === s.value && "bg-white/90")} />
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="bm-desc" className={labelClass}>
              Beschreibung <span className="font-normal normal-case text-zinc-300">(optional)</span>
            </label>
            <textarea
              id="bm-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-800 shadow-sm transition-shadow placeholder:text-zinc-300 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-400/15"
            />
          </div>
          {feedback && (
            <p className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-xs leading-relaxed text-emerald-800 ring-1 ring-emerald-600/15">
              <Icon name="check" size={14} className="mt-0.5 shrink-0" />
              <span>{feedback}</span>
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <Button
              type="submit"
              size="lg"
              className={cn(
                "flex-1",
                selectedPhotos.length > 0 && "shadow-lg shadow-brand-600/25",
              )}
              disabled={!hasProject || selectedPhotos.length === 0}
            >
              <Icon name="flag" size={18} />{" "}
              {selectedPhotos.length > 0
                ? `Mangel mit ${mediaLabelFor(selectedPhotos.map((photo) => photo.id))} speichern`
                : "Erst Fotos auswählen"}
            </Button>
            {selectedPhotos.length > 0 && (
              <Button type="button" size="lg" variant="secondary" onClick={discardSelection}>
                Verwerfen
              </Button>
            )}
          </div>
          <p className="text-xs leading-relaxed text-zinc-400">
            „Tag N“ des Mangels = Aufnahmetag des ältesten ausgewählten Fotos
            (Beweisdatum), nicht der heutige Eingabetag.
          </p>
        </form>
      </Card>

      {/* ── Offene Mängel (partagé avec le cockpit) ─────────────────── */}
      <Card className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Chip icon="flag" tone="zinc" />
            <h2 className="font-display text-base font-semibold text-zinc-900">
              Offene Mängel ({openIssues.length})
            </h2>
          </div>
        </div>
        {openIssues.length === 0 ? (
          <div className="mt-4 flex items-center gap-3.5 rounded-2xl border border-dashed border-emerald-200 bg-gradient-to-b from-emerald-50/70 to-white px-5 py-6">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
              <Icon name="check" size={20} />
            </span>
            <div>
              <p className="text-sm font-medium text-emerald-800">Alles erledigt.</p>
              <p className="mt-0.5 text-sm leading-relaxed text-zinc-400">Keine offenen Mängel im aktiven Projekt.</p>
            </div>
          </div>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {openIssues.map((issue) => (
              <li
                key={issue.id}
                className="flex items-start justify-between gap-3 rounded-2xl border border-zinc-100 bg-gradient-to-b from-white to-zinc-50/50 px-4 py-3 transition-shadow hover:shadow-md"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        issue.severity === "critical"
                          ? "bg-rose-500"
                          : issue.severity === "major"
                            ? "bg-brand-500"
                            : "bg-zinc-400",
                      )}
                    />
                    <span className="truncate text-sm font-medium text-zinc-800">{issue.title}</span>
                    <Badge tone={SEVERITY_BADGE[issue.severity]?.tone ?? "slate"}>
                      {SEVERITY_BADGE[issue.severity]?.label ?? issue.severity}
                    </Badge>
                    {issue.photoIds && issue.photoIds.length > 0 && (
                      <Badge tone="slate">
                        {(issue.videoIds?.length ?? 0) > 0
                          ? `${formatPhotoCount(issue.photoIds.length - (issue.videoIds?.length ?? 0))} + ${formatVideoCount(issue.videoIds?.length ?? 0)}`
                          : formatPhotoCount(issue.photoIds.length)}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-zinc-400">
                    {issue.classificationCode} · {issue.level}
                    {issue.visitDate ? ` · Besuch: ${formatDayLabel(issue.visitDate)}` : ""}
                    {` · Tag ${issue.raisedDay} · ${issue.assignee}`}
                  </div>
                  {/* §107 — le commentaire saisi s'affiche enfin (il existait
                      mais restait invisible = info perdue pour l'œil). */}
                  {issue.description && (
                    <p className="mt-1 text-xs leading-relaxed text-zinc-500 line-clamp-2">
                      {issue.description}
                    </p>
                  )}
                </div>
                {issue.photoIds?.map((pid) => (
                  <IssuePhotoThumb key={pid} photoId={pid} onOpen={() => setLightboxIssue(issue)} />
                ))}
                <Button
                  size="sm"
                  variant="secondary"
                  icon="check"
                  onClick={() => setIssueStatus(issue.id, "resolved")}
                >
                  Erledigt
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-zinc-400">
          Sichtbar auch im Cockpit unter „Issues“ — dieselbe Liste, dasselbe Gerät.
        </p>
      </Card>

      </div>
      </div>

      {/* Visionneuse plein écran (§106) */}
      {lightboxIssue && (
        <PhotoLightbox issue={lightboxIssue} onClose={() => setLightboxIssue(null)} />
      )}
    </div>
  );
}
