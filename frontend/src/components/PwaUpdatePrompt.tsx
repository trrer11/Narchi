// §101 — Pastille « nouvelle version disponible » (PWA #10).
//
// Règle §101 : la pastille NE SE FERME PAS. Deux choix réels : recharger
// maintenant, ou continuer cette session avec l'ancienne version (elle
// revient à chaque démarrage tant que le rechargement n'a pas eu lieu).
// Jamais de rechargement automatique sous les pieds de l'utilisateur.

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui";
import {
  registerPwaServiceWorker,
  resolutionForRegistration,
  type PwaBadge,
} from "@/lib/pwa";

export default function PwaUpdatePrompt() {
  const [badge, setBadge] = useState<PwaBadge>("none");
  const [busy, setBusy] = useState(false);
  const applyRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return registerPwaServiceWorker({
      onOutcome: (outcome, apply) => {
        setBadge(resolutionForRegistration(outcome));
        applyRef.current = apply;
      },
    });
  }, []);

  if (badge !== "pending_user") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-3 rounded-xl border border-white/10 bg-ink-950 px-4 py-2.5 text-sm text-white shadow-xl"
    >
      <Icon name="refresh" size={16} className="text-amber-400" />
      <span>Neue NARCHI-Version bereit.</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          applyRef.current?.();
        }}
        className="rounded-lg bg-amber-500 px-3 py-1 text-xs font-semibold text-ink-950 transition hover:bg-amber-400 disabled:opacity-60"
      >
        {busy ? "Wird neu geladen…" : "Jetzt neu laden"}
      </button>
    </div>
  );
}
