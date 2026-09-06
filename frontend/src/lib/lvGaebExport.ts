/**
 * §90 — Téléchargement GAEB X31 du LV co-édité : décisions PURES testées
 * (URL, nom de fichier, message d'erreur allemand honnête). Le bout
 * réseau reste dans le composant (téléchargement blob, erreurs visibles).
 */

/// Chemin d'export (même origine, cookie de session seul).
export function lvGaebDownloadPath(room: string, mitPreise: boolean, projekt: string): string {
  const params = new URLSearchParams();
  if (mitPreise) params.set("preise", "1");
  const trimmed = projekt.trim();
  if (trimmed) params.set("projekt", trimmed.slice(0, 256));
  const query = params.toString();
  return `/api/v5/collab/${encodeURIComponent(room)}/lv/gaeb.x31${query ? `?${query}` : ""}`;
}

/// Nom de fichier de repli si l'en-tête Content-Disposition est absente
/// (le serveur en pose un — c'est juste la ceinture, jamais un décor).
export function lvGaebFallbackFilename(room: string): string {
  const slug =
    room
      .replace(/[^A-Za-z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "")   // « /// » → « - » ≠ slug acceptable
      .slice(0, 40) || "buero";
  return `lv-${slug}.x31`;
}

/// Extrait le filename d'un Content-Disposition « attachment; filename="…" ».
export function filenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const match = /filename="([^"]+)"/.exec(disposition);
  return match ? match[1] : null;
}

/// Message d'erreur ALLEMAND affiché tel quel — jamais de texte inventé
/// sur une erreur : le detail serveur (liste des OZ « ohne EP ») prime.
export function gaebErrorMessage(status: number, detail: string | null): string {
  if (detail) return detail;
  if (status === 422) return "GAEB-Export abgelehnt — bitte Positionen prüfen.";
  return `GAEB-Export fehlgeschlagen (HTTP ${status}).`;
}
