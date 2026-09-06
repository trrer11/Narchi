/**
 * §93 — Émission formelle GAEB X83 d'une offre stockée : décisions
 * PURES testées (chemin, paramètres, nom de fichier de repli). Le bout
 * réseau (blob) reste dans le composant — règle §90/§91.
 */

/// Chemin de l'export X83 (même origine, cookie de session seul).
/// `projekt` vide est OMIS (le serveur retombe sur « Angebot — Firma »).
export function offerX83Path(room: string, offerId: string, projekt = ""): string {
  const params = new URLSearchParams();
  const trimmed = projekt.trim().slice(0, 256); // borne serveur, jamais dépassée
  if (trimmed) params.set("projekt", trimmed);
  const query = params.toString();
  return (
    `/api/v5/collab/${encodeURIComponent(room)}/offers/` +
    `${encodeURIComponent(offerId)}/gaeb.x83${query ? `?${query}` : ""}`
  );
}

/// Nom de repli si Content-Disposition est absent — même règle de slug
/// que le serveur ([^A-Za-z0-9_.-] → « - »), jamais un nom hostile.
export function offerX83FallbackFilename(companyName: string): string {
  const slug =
    companyName
      .replace(/[^A-Za-z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "unternehmen";
  return `angebot-${slug}.x83`;
}
