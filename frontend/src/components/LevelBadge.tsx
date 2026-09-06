// §175 — LevelBadge : le niveau et les succès (gamification) deviennent VISIBLES.
//
// Le moteur de gamification (gamification.ts) débloquait des succès et
// accumulait de l'XP, mais AUCUN endroit ne les affichait — une récompense
// invisible n'existe pas. Ce badge, posé dans l'en-tête du shell, rend le
// progrès visible en permanence : emoji de niveau, XP, jauge vers le niveau
// suivant, et la liste des succès (débloqués ou non) dans un popover.
//
// HONNÊTETÉ : c'est de la dopamine honnête — les succès correspondent à des
// actions réelles du moteur (estimation, VE, import…), jamais à du remplissage.

import { useEffect, useState } from "react";
import { getLevel, getState, type GameState } from "@/lib/gamification";
import { Icon } from "@/components/ui";
import { cn } from "@/utils/cn";

export function LevelBadge() {
  const [game, setGame] = useState<GameState>(() => getState());
  const [open, setOpen] = useState(false);

  // Le moteur émet « narchi-game-updated » à chaque unlock : on se re-synchronise.
  useEffect(() => {
    const onUpdate = () => setGame(getState());
    window.addEventListener("narchi-game-updated", onUpdate);
    return () => window.removeEventListener("narchi-game-updated", onUpdate);
  }, []);

  const lvl = getLevel(game.xp);
  const unlocked = game.achievements.filter((a) => a.unlocked).length;
  const total = game.achievements.length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Level und Erfolge"
        className="flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-600 transition-all hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
      >
        <span className="text-sm leading-none">{lvl.emoji}</span>
        <span className="hidden font-semibold sm:inline">{lvl.name}</span>
        <span className="hidden text-[10px] text-zinc-400 md:inline">{game.xp} XP</span>
        <Icon name="chevronDown" size={12} className={cn("transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-10 z-40 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-100 p-3 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <span className="text-xl">{lvl.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-sm font-bold text-zinc-900 dark:text-zinc-100">{lvl.name}</p>
                  <p className="text-[11px] text-zinc-500">{game.xp} XP · {unlocked}/{total} Erfolge</p>
                </div>
              </div>
              {lvl.nextXp != null && (
                <div className="mt-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.round(lvl.progress * 100)}%` }} />
                  </div>
                  <p className="mt-1 text-[10px] text-zinc-400">
                    Noch {lvl.nextXp - game.xp} XP bis Level {lvl.level + 1}
                  </p>
                </div>
              )}
            </div>
            <ul className="max-h-72 overflow-y-auto p-2">
              {game.achievements.map((a) => (
                <li
                  key={a.id}
                  className={cn(
                    "flex items-start gap-2 rounded-lg px-2 py-1.5",
                    a.unlocked ? "bg-emerald-50/60 dark:bg-emerald-950/30" : "opacity-50",
                  )}
                >
                  <span className="text-base leading-none">{a.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{a.name}</p>
                    <p className="text-[11px] text-zinc-500">{a.desc}</p>
                  </div>
                  <span className="mt-0.5 shrink-0 text-[11px] font-bold text-emerald-600">
                    {a.unlocked ? `+${a.xp}` : `${a.xp}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
