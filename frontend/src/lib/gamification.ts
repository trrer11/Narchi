// Narchi — Gamification engine (achievements, streaks, XP, levels).
// Behavioral psychology: rewards consistent tool usage, quality checks,
// collaboration — making excellence a game the team wants to win.

export interface Achievement {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  xp: number;
  unlocked: boolean;
  unlockedAt?: string;
}

export interface GameState {
  xp: number;
  level: number;
  achievements: Achievement[];
  streak: number;
}

const KEY = "narchi:game";
const LEVELS = [
  { level: 1, name: "Azubi", minXp: 0, emoji: "🌱" },
  { level: 2, name: "Junior Architekt", minXp: 100, emoji: "📐" },
  { level: 3, name: "Architekt", minXp: 300, emoji: "🏛️" },
  { level: 4, name: "Senior Architekt", minXp: 700, emoji: "⭐" },
  { level: 5, name: "Partner", minXp: 1500, emoji: "🏆" },
  { level: 6, name: "Bürolegende", minXp: 3000, emoji: "👑" },
  { level: 7, name: "Narchi Meister", minXp: 6000, emoji: "🧠" },
];

export const ACHIEVEMENT_DEFS: Omit<Achievement, "unlocked" | "unlockedAt">[] = [
  { id: "first_cost", name: "Erste Kostenschätzung", emoji: "💰", desc: "DIN 276-Berechnung durchgeführt", xp: 50 },
  { id: "first_energy", name: "Energie-Pionier", emoji: "⚡", desc: "GEG-Energiebilanz erstellt", xp: 50 },
  { id: "first_hoai", name: "Honorar-Experte", emoji: "📐", desc: "HOAI-Honorar berechnet", xp: 50 },
  { id: "first_import", name: "Modell-Importeur", emoji: "📥", desc: "BIM/CAD-Modell importiert", xp: 75 },
  { id: "first_clash", name: "Konfliktlöser", emoji: "🎯", desc: "Clash-Radar ausgeführt", xp: 75 },
  { id: "first_crew", name: "Agenten-Orchester", emoji: "🤖", desc: "Crew-Analyse gestartet", xp: 100 },
  { id: "first_montecarlo", name: "Risiko-Analyst", emoji: "🎲", desc: "Monte-Carlo-Simulation ausgeführt", xp: 100 },
  { id: "ve_saved", name: "Klima-Pionier", emoji: "🌱", desc: "Erste VE-Substitution im Klima-Erfolg festgehalten", xp: 100 },
  { id: "ve_champion", name: "Klima-Champion", emoji: "🌳", desc: "10 Tonnen CO₂e im Klima-Erfolg gespart", xp: 300 },
  { id: "first_feedback", name: "Feedback-Geber", emoji: "💬", desc: "Feedback hinterlassen", xp: 30 },
  { id: "streak_3", name: "3-Tage-Streak", emoji: "🔥", desc: "3 Tage in Folge aktiv", xp: 100 },
  { id: "streak_7", name: "Woche voller Power", emoji: "⚡", desc: "7 Tage in Folge aktiv", xp: 250 },
  { id: "crew_5x", name: "Analyse-Profi", emoji: "📊", desc: "5 Crew-Analysen durchgeführt", xp: 200 },
  { id: "collaborator", name: "Team-Spieler", emoji: "🤝", desc: "Erste Chat-Nachricht gesendet", xp: 50 },
];

function load(): GameState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const state = JSON.parse(raw) as GameState;
      // merge any new achievement defs
      const existingIds = new Set(state.achievements.map((a) => a.id));
      for (const def of ACHIEVEMENT_DEFS) {
        if (!existingIds.has(def.id)) {
          state.achievements.push({ ...def, unlocked: false });
        }
      }
      return state;
    }
  } catch { /* */ }
  return { xp: 0, level: 1, achievements: ACHIEVEMENT_DEFS.map((d) => ({ ...d, unlocked: false })), streak: 0 };
}

function save(state: GameState) {
  localStorage.setItem(KEY, JSON.stringify(state));
  window.dispatchEvent(new Event("narchi-game-updated"));
}

export function getLevel(xp: number): { level: number; name: string; emoji: string; nextXp: number | null; progress: number } {
  let current = LEVELS[0];
  let next: typeof LEVELS[number] | null = null;
  for (let i = 0; i < LEVELS.length; i++) {
    if (xp >= LEVELS[i].minXp) {
      current = LEVELS[i];
      next = LEVELS[i + 1] ?? null;
    }
  }
  const nextXp = next ? next.minXp : null;
  const progress = next ? (xp - current.minXp) / (next.minXp - current.minXp) : 1;
  return { level: current.level, name: current.name, emoji: current.emoji, nextXp, progress };
}

export function unlock(achievementId: string): { newlyUnlocked: Achievement | null; leveledUp: boolean } {
  const state = load();
  const ach = state.achievements.find((a) => a.id === achievementId);
  if (!ach || ach.unlocked) return { newlyUnlocked: null, leveledUp: false };

  ach.unlocked = true;
  ach.unlockedAt = new Date().toISOString();
  const oldLevel = getLevel(state.xp).level;
  state.xp += ach.xp;
  const newLevel = getLevel(state.xp).level;
  state.level = newLevel;
  save(state);
  return { newlyUnlocked: ach, leveledUp: newLevel > oldLevel };
}

export function getState(): GameState {
  return load();
}

export function tickStreak() {
  const state = load();
  const today = new Date().toISOString().slice(0, 10);
  const lastActivity = (state as any).lastActivityDate;
  if (lastActivity === today) return; // already counted today
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (lastActivity === yesterday) state.streak += 1;
  else state.streak = 1;
  (state as any).lastActivityDate = today;
  if (state.streak >= 3) unlock("streak_3");
  if (state.streak >= 7) unlock("streak_7");
  save(state);
}
