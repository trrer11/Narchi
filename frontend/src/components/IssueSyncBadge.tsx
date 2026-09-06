/**
 * §117/§118 — Badge d'état de la synchro : SINCÈRE ou rien.
 *
 * Affiche EXACTEMENT l'état des trois flux (Mängel §117, Projets §118,
 * Médias §118), jamais un « Synchronisiert » décoratif :
 *  - jamais lancé / aucun serveur joint → « Noch nie synchronisiert » ;
 *  - hors-ligne avec écritures en attente → compteurs nus ;
 *  - Mängel garés / projets en attente / médias en attente ou refusés →
 *    compteurs nus aussi (« Medien: 2 warten », « Medien: 1 nicht
 *    hochladbar » — le refus est gardé dans le statut, pas avalé) ;
 *  - erreur serveur → message nu ;
 *  - sync OK → heure SERVEUR du dernier delta (pas l'horloge locale).
 */
import { useEffect, useState } from "react";

import {
  getIssueSyncStatus,
  subscribeIssueSync,
  type IssueSyncStatus,
} from "@/lib/issueSync";
import {
  getProjectSyncStatus,
  subscribeProjectSync,
  type ProjectSyncStatus,
} from "@/lib/projectSync";
import {
  getMediaSyncStatus,
  subscribeMediaSync,
  type MediaSyncStatus,
} from "@/lib/mediaSync";

function heureDe(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function IssueSyncBadge() {
  const [issues, setIssues] = useState<IssueSyncStatus>(() => getIssueSyncStatus());
  const [projets, setProjets] = useState<ProjectSyncStatus>(() => getProjectSyncStatus());
  const [medias, setMedias] = useState<MediaSyncStatus>(() => getMediaSyncStatus());
  useEffect(() => subscribeIssueSync(setIssues), []);
  useEffect(() => subscribeProjectSync(setProjets), []);
  useEffect(() => subscribeMediaSync(setMedias), []);

  let classe = "border-slate-300 bg-slate-50 text-slate-600";
  let texte = "Noch nie synchronisiert";
  if (issues.phase === "sync") {
    classe = "border-emerald-300 bg-emerald-50 text-emerald-800";
    texte = issues.lastSyncAt
      ? `Synchronisiert · ${heureDe(issues.lastSyncAt)}`
      : "Synchronisiert";
  } else if (issues.phase === "offline") {
    classe = "border-amber-300 bg-amber-50 text-amber-800";
    texte = issues.pending > 0
      ? `Offline — ${issues.pending} Änderung(en) warten`
      : "Offline — Sync später";
  } else if (issues.phase === "erreur") {
    classe = "border-red-300 bg-red-50 text-red-800";
    texte = `Sync-Fehler: ${issues.lastError ?? "unbekannt"}`;
  }

  const retards: string[] = [];
  if (issues.phase === "sync" && issues.pending > 0) retards.push(`${issues.pending} warten`);
  if (issues.parked > 0) retards.push(`${issues.parked} geparkt (Projekt fehlt hier)`);
  if (projets.pending > 0 || projets.pendingDeletes > 0) {
    retards.push(`Projekte: ${projets.pending + projets.pendingDeletes} warten`);
  }
  if (medias.pendingUploads > 0) retards.push(`Medien: ${medias.pendingUploads} warten`);
  if (medias.failedUploads > 0) retards.push(`Medien: ${medias.failedUploads} nicht hochladbar`);
  if (projets.phase === "erreur") retards.push(`Projekte: ${projets.lastError ?? "Fehler"}`);
  if (medias.lastError && medias.pendingUploads > 0) retards.push(`Medien: ${medias.lastError}`);

  if (retards.length > 0) {
    texte += ` · ${retards.join(" · ")}`;
    if (medias.failedUploads > 0 || projets.phase === "erreur") {
      classe = "border-red-300 bg-red-50 text-red-800";
    } else if (classe.includes("emerald") || classe.includes("slate")) {
      classe = "border-amber-300 bg-amber-50 text-amber-800";
    }
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${classe}`}
      title="Synchronisation über den Narchi-Server: Mängel-Texte, Projekte und jetzt auch Fotos/Videos (Schritt 3). Telefon-Zugriff erfordert HTTPS (Schritt 4)."
    >
      <span aria-hidden>⇅</span>
      {texte}
    </span>
  );
}

export default IssueSyncBadge;
