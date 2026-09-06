/**
 * \u00a71 Session utilisateur — nom de l'utilisateur connect\u00e9.
 * Stock\u00e9 en localStorage, partag\u00e9 entre l'app (header) et l'\u00e9cran de login.
 * D\u00e9faut : "Admin" (aucun nom d\u00e9pos\u00e9 dans le code).
 */

const KEY = "narchi.session.userName";
export const SESSION_EVENT = "narchi-session";

export function getUserName(): string {
  try {
    return (localStorage.getItem(KEY) ?? "").trim();
  } catch {
    return "";
  }
}

export function setUserName(name: string): void {
  try {
    const clean = name.trim().slice(0, 60);
    if (clean) localStorage.setItem(KEY, clean);
    else localStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible */
  }
  // pr\u00e9vient l'app dans le m\u00eame onglet
  window.dispatchEvent(new Event(SESSION_EVENT));
}
