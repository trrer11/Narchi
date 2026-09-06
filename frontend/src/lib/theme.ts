// Narchi — Theme engine.
// §48 (retouche utilisateur 2026-08-06) : le mode sombre « n'est pas joli du
// tout » et le bouton « Hell » a été SUPPRIMÉ du header. NARCHI est donc
// volontairement en CLAIR UNIQUEMENT — ce module reste pour garantir que
// d'anciennes préférences (« dark »/« auto » persistées) ne ressortent plus :
// tout est écrasé en clair au démarrage, proprement et définitivement.

const KEY = "narchi:theme";
export type Theme = "light" | "dark" | "auto";

/** §48 — le thème demandé est TOUJOURS clair. */
export function getTheme(): Theme {
  return "light";
}

/** Conservé pour compatibilité : toute écriture force le clair. */
export function setTheme(_theme: Theme) {
  localStorage.setItem(KEY, "light");
  applyTheme("light");
  window.dispatchEvent(new Event("narchi-theme-changed"));
}

export function applyTheme(_theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("dark");
  root.style.colorScheme = "light";
}

export function initTheme() {
  // Nettoie l'ancienne préférence et verrouille le clair.
  localStorage.setItem(KEY, "light");
  applyTheme("light");
}
