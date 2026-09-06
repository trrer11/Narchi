// NARCHI — Avatars d'équipe (photo personnelle ou emoji, persistance locale).
//
// Chaque membre peut personnaliser son image : photo (re-cadrée en carré
// 128 px côté navigateur) OU emoji choisi dans une palette « chantier ».
// Résolution en cascade : photo → emoji → initiales sur teinte stable
// (jamais de rendu « ennuyeux » : chaque identité a sa couleur déterministe).

export interface AvatarSpec {
  kind: "photo" | "emoji";
  photo?: string; // dataURL (≈128 px, JPEG)
  emoji?: string;
}

export const AVATARS_STORAGE_KEY = "narchi:avatars";

/// Palette fun « chantier & bureau » — proposée dans le sélecteur.
export const AVATAR_EMOJIS: string[] = [
  "🏗️", "👷", "🦺", "📐", "🧱", "📏", "🏢", "🌉",
  "🔧", "🧮", "📊", "🏠", "⛏️", "🪜", "🧰", "🪵",
  "😎", "🚀", "🎯", "🦁", "🐼", "🦉", "🍀", "⚡",
];

export const AVATAR_SIZE_PX = 128;

/* --------------------------------- clés ---------------------------------- */

/// Clé de stockage stable : e-mail en priorité (survit au changement d'id
/// local/backend), repli « n:nom », puis « id:… ».
export function avatarKeyOf(user: { email?: string | null; name?: string | null; id?: string }): string {
  const email = (user.email ?? "").trim().toLowerCase();
  if (email) return email;
  const name = (user.name ?? "").trim().toLowerCase();
  if (name) return `n:${name}`;
  return `id:${String(user.id ?? "inconnu")}`;
}

/// Résout la clé d'un auteur de message (nom affiché) vers un compte connu
/// (local ou backend) — sinon clé nominative stable.
export function ownerKeyForName(
  users: { id?: string; name?: string | null; email?: string | null }[],
  name: string,
): string {
  const needle = name.trim().toLowerCase();
  const found = users.find((u) => (u.name ?? "").trim().toLowerCase() === needle);
  if (found) return avatarKeyOf(found);
  return avatarKeyOf({ name });
}

/* ------------------- annuaire de résolution par nom (§83) ------------------- */
// §83 — CAUSE EXACTE des icônes invisibles dans les fenêtres de discussion :
// ownerKeyForName ne recevait QUE l'annuaire LOCAL du navigateur (lib/auth,
// sans les collègues) → repli « n:nom », alors que le registre hydraté par
// le serveur est indexé par E-MAIL (avatar_key §82, = avatarKeyOf du compte).
// « n:anna berger » ≠ « anna@buero.de » → jamais de correspondance, donc
// jamais d'icône. Cet annuaire met le distant (comptes réels + e-mail)
// D'ABORD, le local ensuite, dédoublonné par e-mail puis par nom : le
// premier match par nom gagne — c'est le distant, et sa clé est l'e-mail.
export interface KeyDirectoryUser {
  id?: string;
  name?: string | null;
  email?: string | null;
}

export function avatarKeyDirectory(
  ...lists: (KeyDirectoryUser[] | null | undefined)[]
): KeyDirectoryUser[] {
  const seenEmail = new Set<string>();
  const seenName = new Set<string>();
  const out: KeyDirectoryUser[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const mail = (entry.email ?? "").trim().toLowerCase();
      const nam = (entry.name ?? "").trim().toLowerCase();
      if (mail && seenEmail.has(mail)) continue;
      if (!mail && nam && seenName.has(nam)) continue;
      if (mail) seenEmail.add(mail);
      if (nam) seenName.add(nam);
      out.push(entry);
    }
  }
  return out;
}

/* ------------------------------ teinte stable ----------------------------- */

/// Teinte HSL 0–359 déterministe par identité (FNV-1a simplifié).
export function hueFor(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 360;
}

/* ------------------------------ persistance ------------------------------- */

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/* ------------------------- registre réactif (§83) -------------------------- */
// §83 — AVANT : UserAvatar gelait sa résolution au montage (useMemo[clé]) ;
// une hydratation serveur postérieure ne rerendait RIEN — l'icône propagée
// restait invisible jusqu'à la prochaine navigation. Le registre expose
// désormais un compteur de version + abonnement (useSyncExternalStore) :
// TOUT UserAvatar monté se recalcule à chaque écriture/hydratation.
let registryVersion = 0;
const registryListeners = new Set<() => void>();

export function avatarRegistryVersion(): number {
  return registryVersion;
}

export function onAvatarRegistryChange(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

function bumpRegistry(): void {
  registryVersion += 1;
  registryListeners.forEach((listener) => listener());
}

// Mémoïsation de la map parsée, indexée sur le CONTENU BRUT : un rerendu
// global après bump ne re-parse pas le JSON (jusqu'à ~100 ko par photo) N
// fois par ligne de message. Comparaison de chaîne = invalidation exacte,
// y compris pour une écriture/suppression EXTERNE (autre onglet, test qui
// vide localStorage) — aucune donnée périmée ne peut être servie.
let readCache: { storage: Storage; raw: string | null; map: Record<string, AvatarSpec> } | null = null;

function readAll(storage: Storage | null): Record<string, AvatarSpec> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(AVATARS_STORAGE_KEY);
    if (readCache && readCache.storage === storage && readCache.raw === raw) {
      return readCache.map;
    }
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    const map =
      typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
        ? {}
        : (parsed as Record<string, AvatarSpec>);
    readCache = { storage, raw, map };
    return map;
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, AvatarSpec>, storage: Storage | null): boolean {
  if (!storage) return false;
  try {
    storage.setItem(AVATARS_STORAGE_KEY, JSON.stringify(map));
    bumpRegistry(); // §83 — seulement après succès : les abonnés reliront.
    return true;
  } catch {
    return false; // quota (photo trop lourde) — l'UI signale l'échec
  }
}

export function getAvatar(ownerKey: string, storage: Storage | null = defaultStorage()): AvatarSpec | null {
  const spec = readAll(storage)[ownerKey];
  if (!spec || (spec.kind !== "photo" && spec.kind !== "emoji")) return null;
  return spec;
}

export function setAvatar(ownerKey: string, spec: AvatarSpec, storage: Storage | null = defaultStorage()): boolean {
  const map = readAll(storage);
  map[ownerKey] = spec;
  return writeAll(map, storage);
}

export function removeAvatar(ownerKey: string, storage: Storage | null = defaultStorage()): boolean {
  const map = readAll(storage);
  delete map[ownerKey];
  return writeAll(map, storage);
}

/* ------------------------------ résolution -------------------------------- */

export type AvatarResolution =
  | { kind: "photo"; photo: string }
  | { kind: "emoji"; emoji: string; hue: number }
  | { kind: "initials"; hue: number };

export function resolveAvatar(ownerKey: string, storage: Storage | null = defaultStorage()): AvatarResolution {
  const hue = hueFor(ownerKey);
  const spec = getAvatar(ownerKey, storage);
  if (spec?.kind === "photo" && spec.photo) return { kind: "photo", photo: spec.photo };
  if (spec?.kind === "emoji" && spec.emoji) return { kind: "emoji", emoji: spec.emoji, hue };
  return { kind: "initials", hue };
}

/* -------------------- hydratation depuis le serveur (§82) ------------------ */
//
// Avant §82, SEULE la clé remontait au serveur — la photo restait prisonnière
// du navigateur d'origine (plainte réelle : « l'autre compte ne voit pas mon
// icône »). Le serveur expose désormais le CONTENU (photo ≤ 64 ko / emoji)
// via /members et /chat/users ; ici on le verse dans le registre local.

export interface ServerAvatarUser {
  avatar_key?: string | null;
  avatar_json?: string | null;
}

/// Valide strictement une spec serveur — jamais de blob aveugle affiché.
export function parseAvatarJson(raw: string | null | undefined): AvatarSpec | null {
  if (!raw) return null;
  try {
    const spec = JSON.parse(raw) as AvatarSpec;
    if (
      spec?.kind === "photo" &&
      typeof spec.photo === "string" &&
      spec.photo.startsWith("data:image/") &&
      spec.photo.length <= 68_000
    ) {
      return { kind: "photo", photo: spec.photo };
    }
    if (
      spec?.kind === "emoji" &&
      typeof spec.emoji === "string" &&
      spec.emoji.trim() &&
      spec.emoji.length <= 14
    ) {
      return { kind: "emoji", emoji: spec.emoji };
    }
    return null;
  } catch {
    return null;
  }
}

/// Verse les contenus serveur dans le registre local. Le serveur fait foi ;
/// une entrée locale IDENTIQUE n'est pas réécrite (évite les I/O inutiles).
/// Retourne le nombre d'avatars réellement hydratés (tests + télémétrie).
export function hydrateAvatarsFromServer(
  users: ServerAvatarUser[],
  storage: Storage | null = defaultStorage(),
): number {
  if (!storage) return 0;
  const map = readAll(storage);
  let changed = 0;
  for (const u of users) {
    const key = (u.avatar_key ?? "").trim();
    if (!key) continue;
    const spec = parseAvatarJson(u.avatar_json);
    if (!spec) continue;
    const cur = map[key];
    const differs =
      !cur ||
      cur.kind !== spec.kind ||
      (spec.kind === "photo" && cur.photo !== spec.photo) ||
      (spec.kind === "emoji" && cur.emoji !== spec.emoji);
    if (differs) {
      map[key] = spec;
      changed += 1;
    }
  }
  if (changed) writeAll(map, storage);
  return changed;
}

/* --------------------------- préparation fichier -------------------------- */

/// Fichier image → dataURL carrée (128 px, JPEG). Recadrage par canvas ;
/// repli FileReader brut si le canvas 2D est indisponible (mode hors-ligne).
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  try {
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("image illisible"));
        img.src = objectUrl;
      });
      const side = Math.min(image.naturalWidth || 1, image.naturalHeight || 1);
      const canvas = document.createElement("canvas");
      canvas.width = AVATAR_SIZE_PX;
      canvas.height = AVATAR_SIZE_PX;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas 2d indisponible");
      ctx.drawImage(
        image,
        (image.naturalWidth - side) / 2,
        (image.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        AVATAR_SIZE_PX,
        AVATAR_SIZE_PX,
      );
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      if (!dataUrl.startsWith("data:image/")) throw new Error("toDataURL vide");
      return dataUrl;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("lecture impossible"));
      reader.readAsDataURL(file);
    });
  }
}
