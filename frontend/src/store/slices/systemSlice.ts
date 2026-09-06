/**
 * SYSTEM SLICE - NARCHI CORE
 * Manages background synchronization, activity logs, and system notifications.
 */
import type { SyncState, ActivityItem, NotificationItem } from "@/data/types";
import type { StateCreator } from "zustand";
import type { State } from "../AppStore";

/// Demande de localisation 3D émise par QC & Conformité (clic sur un clash /
/// une violation) : le viewer de la Maquette 3D centre la caméra sur la zone
/// et y dessine le(s) marqueur(s). Coordonnées dans le repère des MeshBox
/// (IFC, Z-up) — chaque viewer convertit dans son propre repère.
export interface QcFocusElement {
  /** Centre de la bbox de CET élément (repère MeshBox). */
  center: [number, number, number];
  /** Taille de la bbox de cet élément. */
  size: [number, number, number];
  /** Express ID IFC de l'élément — permet de re-teinter SA géométrie réelle
      en PLEINE MATIÈRE (A rouge · B bleu) dans le viewer web-ifc, pas un
      simple « reflet » fantôme. */
  expressId?: number | null;
  /** Rôle dans la paire en collision : A = rouge plein, B = bleu plein
      (violation de règle isolée : toujours rouge). */
  role?: "A" | "B";
}

/// Aperçu AVANT/APRÈS « Correction IA » : l'élément choisi glisse de sa
/// position actuelle (rouge) vers la position corrigée (fantôme vert animé).
export interface QcFocusAfter {
  /** Position actuelle de l'élément à déplacer. */
  from: QcFocusElement;
  /** Position CORRIGÉE proposée (le clash disparaît si appliquée). */
  to: QcFocusElement;
}

export interface QcFocusRequest {
  /** Centre de la bbox d'union des éléments en conflit — cible caméra. */
  center: [number, number, number];
  /** Taille (diamètre) de la bbox d'union — recul caméra. */
  size: [number, number, number];
  /** Bboxes INDIVIDUELLES des fautifs (1 violation ou 2 clash) : encadrées
      d'une FINE cage orange filaire (contexte). Vide = repli cage d'union. */
  elements?: QcFocusElement[];
  /** ZONE EXACTE à corriger (intersection des deux volumes) — c'est ELLE
      que le regard doit trouver immédiatement : cage rouge + remplissage
      pulsant + diamant flashy. Pour une violation de règle : l'élément
      lui-même. Absent = repli sur les cages orange. */
  hotspot?: QcFocusElement | null;
  /** Aperçu « Correction IA » AVANT/APRÈS (fantôme vert animé from→to). */
  after?: QcFocusAfter | null;
  /** Radiographie : true = maquette entière en fantôme translucide ;
      false/absent = MURS SOLIDES (défaut — demandé par l'utilisateur :
      « vaut mieux voir les clashs en mur solide, pas juste des reflets »).
      Dans les deux cas le cube de section découpe le contexte et les deux
      fautifs passent en rouge/bleu pleine matière. */
  xray?: boolean;
  /** Libellé court (ex. « Mur 22 ⇄ Sol 160 mm »). */
  label: string;
  /** Horodatage — deux clics sur le même clash re-déclenchent le focus. */
  at: number;
}

export interface SystemSlice {
  sync: SyncState;
  activity: ActivityItem[];
  notifications: NotificationItem[];
  /** Focus 3D demandé depuis QC & Conformité (transient, non persisté). */
  qcFocus: QcFocusRequest | null;

  // Actions
  setSyncState: (sync: Partial<SyncState>) => void;
  addActivity: (item: ActivityItem) => void;
  addNotification: (notif: NotificationItem) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  setQcFocus: (focus: QcFocusRequest | null) => void;
}

export const createSystemSlice: StateCreator<State, [], [], SystemSlice> = (set) => ({
  sync: {
    running: false,
    progress: 0,
    phase: "Idle",
    log: [],
    records: 0,
    conflicts: 0,
    resolved: 0,
    lastRun: null,
  },
  activity: [],
  notifications: [],
  qcFocus: null,

  setQcFocus: (focus) => set({ qcFocus: focus }),

  setSyncState: (patch: Partial<SyncState>) => 
    set((state) => ({
      sync: { ...state.sync, ...patch }
    })),

  addActivity: (item: ActivityItem) => 
    set((state) => ({
      activity: [item, ...state.activity].slice(0, 100) // Keep last 100
    })),

  addNotification: (notif: NotificationItem) => 
    set((state) => ({
      notifications: [notif, ...state.notifications]
    })),

  markNotificationRead: (id: string) => 
    set((state) => ({
      notifications: state.notifications.map((n: NotificationItem) => 
        n.id === id ? { ...n, read: true } : n
      )
    })),

  markAllNotificationsRead: () => 
    set((state) => ({
      notifications: state.notifications.map((n: NotificationItem) => ({ ...n, read: true }))
    })),
});
