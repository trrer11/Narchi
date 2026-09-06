import { useEffect } from "react";
import { useApp } from "@/store/AppStore";

/**
 * §42 — FUSION NARCHI IQ + COPILOT ✔ : un SEUL chat, la page « NARCHI IQ ».
 * §60 — la pilule flottante a été SUPPRIMÉE sur demande utilisateur : un
 * seul bouton flottant reste à l'écran (la messagerie, en bas à droite).
 * Ce composant est désormais HEADLESS : il ne rend rien mais conserve le
 * raccourci clavier ⌘J vers /app/iq, actif partout.
 */
export function Copilot() {
  const { navigate } = useApp();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        navigate("/app/iq");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  // §60 — pilule flottante SUPPRIMÉE sur demande utilisateur (« vaut mieux
  // supprimer l'icône NARCHI IQ et laisser juste celle de messagerie ») :
  // un seul bouton flottant, le sien. NARCHI IQ reste joignable via le menu
  // latéral « NARCHI IQ » et le raccourci ⌘J ci-dessus (toujours actif).
  return null;
}
