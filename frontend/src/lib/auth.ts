// Narchi — secure client-side authentication core.
// Passwords are hashed with PBKDF2 (150k iterations, SHA-256) + per-user salt
// via the Web Crypto API. Nothing plaintext is ever stored. Sessions use a
// signed token in sessionStorage. Data persists in localStorage (the app ships
// as a single file with no backend, so this is the secure storage layer).
//
// Roles:
//   owner     — proprietor: full app + team management + feedback inbox
//   architect — beta tester: app tools + feedback submission

export type Role = "owner" | "architect" | "guest" | string;
export type UserStatus = "active" | "disabled";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  company?: string;
  status: UserStatus;
  salt: string; // hex
  hash: string; // hex (PBKDF2)
  createdAt: string;
  lastLogin: string | null;
  note?: string;
}

export interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: "guest" | "architect" | "owner" | string;
  company?: string;
  status: UserStatus;
  createdAt: string;
  lastLogin: string | null;
  note?: string;
  tenantId?: string;
  // §82 — avatar serveur (propagation entre navigateurs/appareils)
  avatar_key?: string | null;
  avatar_json?: string | null;
}

export interface Feedback {
  id: string;
  userId: string;
  userName: string;
  rating: number; // 1..5
  category: string;
  page: string;
  message: string;
  createdAt: string;
  status: "new" | "read" | "acknowledged";
}

const USERS_KEY = "narchi:users";
const SESSION_KEY = "narchi:session";
const FEEDBACK_KEY = "narchi:feedback";
const PBKDF2_ITER = 150_000;

/* ----------------------------- crypto helpers ----------------------------- */
const enc = new TextEncoder();

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBuf(hex: string): ArrayBuffer {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return arr.buffer;
}
function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return bufToHex(a.buffer);
}

export async function hashPassword(password: string, saltHex: string): Promise<string> {
  const salt = hexToBuf(saltHex);
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" }, keyMaterial, 256);
  return bufToHex(bits);
}

/** Session token = userId.hmacSignature (signature via a server-style hash of id+secret). */
async function sessionToken(userId: string): Promise<string> {
  const pepper = "narchi-session-v1";
  const data = enc.encode(userId + ":" + pepper);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return `${userId}.${bufToHex(digest)}`;
}

/* ----------------------------- storage ----------------------------- */
import { storage } from "@/utils/localStore";
function loadUsers(): User[] {
  return storage.get<User[]>(USERS_KEY, []);
}
function saveUsers(users: User[]) {
  storage.set(USERS_KEY, users);
}
export function toSafe(u: User): SafeUser {
  const { salt: _salt, hash: _hash, ...safe } = u;
  void _salt; void _hash;
  return safe;
}

/* ----------------------------- seeding ----------------------------- */
export async function ensureSeedOwner(): Promise<void> {
  const users = loadUsers();
  if (!users.some((u) => u.email.toLowerCase() === "owner@narchi.io")) {
    const salt = randomHex(16);
    const hash = await hashPassword("Narchi2026!", salt);
    users.push({
      id: "usr-owner",
      email: "owner@narchi.io",
      name: "Propriétaire Narchi",
      role: "owner",
      company: "Narchi Architekten",
      status: "active",
      salt,
      hash,
      createdAt: new Date().toISOString(),
      lastLogin: null,
      note: "Compte propriétaire par défaut.",
    });
  }
  if (!users.some((u) => u.email.toLowerCase() === "admin@narchi.de")) {
    const salt = randomHex(16);
    const hash = await hashPassword("AdminBerlin2026!", salt);
    users.push({
      id: "usr-admin-de",
      email: "admin@narchi.de",
      name: "Architecte Principal (Directeur)",
      role: "owner",
      company: "NARCHI Principal Office Berlin",
      status: "active",
      salt,
      hash,
      createdAt: new Date().toISOString(),
      lastLogin: null,
      note: "Compte administrateur certifié Kammer Berlin.",
    });
  }
  saveUsers(users);
}

/* ----------------------------- user CRUD ----------------------------- */
export interface CreateUserInput {
  email: string;
  name: string;
  role: Role;
  company?: string;
  password: string;
  note?: string;
}

export async function createUser(input: CreateUserInput): Promise<SafeUser> {
  const users = loadUsers();
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password || !input.name) throw new Error("Tous les champs sont obligatoires.");
  if (input.password.length < 6) throw new Error("Le mot de passe doit contenir au moins 6 caractères.");
  if (users.some((u) => u.email.toLowerCase() === email)) throw new Error("Un compte existe déjà avec cet email.");
  const salt = randomHex(16);
  const hash = await hashPassword(input.password, salt);
  const user: User = {
    id: "usr-" + randomHex(8),
    email,
    name: input.name.trim(),
    role: input.role,
    company: input.company?.trim() || undefined,
    status: "active",
    salt,
    hash,
    createdAt: new Date().toISOString(),
    lastLogin: null,
    note: input.note?.trim() || undefined,
  };
  users.push(user);
  saveUsers(users);
  return toSafe(user);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const users = loadUsers();
  const u = users.find((x) => x.id === userId);
  if (!u) throw new Error("Utilisateur introuvable.");
  if (newPassword.length < 6) throw new Error("Le nouveau mot de passe doit contenir au moins 6 caractères.");
  const verify = await hashPassword(currentPassword, u.salt);
  if (verify !== u.hash) throw new Error("Le mot de passe actuel est incorrect.");
  const salt = randomHex(16);
  u.salt = salt;
  u.hash = await hashPassword(newPassword, salt);
  saveUsers(users);
}

export function listUsers(): SafeUser[] {
  return loadUsers().map(toSafe).sort((a, b) => (a.role === "owner" ? -1 : 1) - (b.role === "owner" ? -1 : 1) || a.name.localeCompare(b.name));
}

export function setUserStatus(userId: string, status: UserStatus) {
  const users = loadUsers();
  const u = users.find((x) => x.id === userId);
  if (u && u.role !== "owner") { u.status = status; saveUsers(users); }
}

export function deleteUser(userId: string) {
  const users = loadUsers();
  const u = users.find((x) => x.id === userId);
  if (u && u.role !== "owner") saveUsers(users.filter((x) => x.id !== userId));
}

export async function resetUserPassword(userId: string, newPassword: string): Promise<string> {
  if (newPassword.length < 6) throw new Error("Le mot de passe doit contenir au moins 6 caractères.");
  const users = loadUsers();
  const u = users.find((x) => x.id === userId);
  if (!u || u.role === "owner") throw new Error("Réinitialisation impossible.");
  const salt = randomHex(16);
  u.salt = salt;
  u.hash = await hashPassword(newPassword, salt);
  saveUsers(users);
  return newPassword;
}

/* ----------------------------- auth ----------------------------- */
export async function authenticate(email: string, password: string): Promise<SafeUser> {
  const cleanEmail = email.trim().toLowerCase();
  let users = loadUsers();

  // CORRECTIF "Aucun compte trouvé" : le seeding des comptes locaux avait
  // été retiré du boot (gel PBKDF2 documenté) mais JAMAIS rebranché —
  // narchi:users restait vide à vie et l'authentification locale ne
  // pouvait réussir pour personne. Seeding paresseux : uniquement ICI,
  // au moment d'un login local sur base vide (coût PBKDF2 payé pendant
  // que l'utilisateur attend légitimement une vérification de mot de
  // passe, jamais au boot).
  if (users.length === 0) {
    await ensureSeedOwner();
    users = loadUsers();
  }

  const u = users.find((x) => x.email.toLowerCase() === cleanEmail);
  if (!u) throw new Error("Aucun compte trouvé avec cet email.");
  if (u.status === "disabled") throw new Error("Ce compte est désactivé. Contactez le propriétaire.");
  const verify = await hashPassword(password, u.salt);
  if (verify !== u.hash) throw new Error("Mot de passe incorrect.");
  u.lastLogin = new Date().toISOString();
  saveUsers(users);
  const token = await sessionToken(u.id);
  try {
    sessionStorage.setItem(SESSION_KEY, token);
  } catch {
    /* ignore */
  }
  return toSafe(u);
}

export async function restoreSession(): Promise<SafeUser | null> {
  let token: string | null = null;
  try {
    token = sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
  if (!token) return null;
  const [id, sig] = token.split(".");
  if (!id || !sig) return null;
  const expected = await sessionToken(id);
  if (token !== `${id}.${sig}` || expected !== token) return null;
  const users = loadUsers();
  const u = users.find((x) => x.id === id && x.status === "active");
  return u ? toSafe(u) : null;
}

export function logout() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/* ----------------------------- REMOTE auth (Supabase) ----------------------------- */
// When a backend is configured, login/signup goes through Supabase Auth and
// the user profile is mirrored in the remote `users` table — real cross-device.
import { isConfigured } from "@/lib/remoteConfig";
import { clearRemoteSession, hasRemoteSession, remoteLogin, remoteSignup, remoteSelect, remoteUpsert } from "@/lib/supabase";

export interface RemoteUser {
  id: string;
  auth_id?: string;
  email: string;
  name: string;
  role: Role;
  company?: string;
  status: UserStatus;
  note?: string;
  createdAt: string;
  lastLogin: string | null;
  created_at?: string;
}

export async function authenticateRemote(email: string, password: string): Promise<SafeUser> {
  const session = await remoteLogin(email, password);
  const profiles = await remoteSelect<RemoteUser>("users");
  let u = profiles.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
  if (!u) {
    const first = profiles.length === 0;
    u = {
      id: "usr-" + Math.random().toString(36).slice(2, 10),
      auth_id: session.user.id,
      email: session.user.email,
      name: email.split("@")[0],
      role: first ? "owner" : "architect",
      status: "active",
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
    };
    await remoteUpsert("users", u);
  } else {
    u.lastLogin = new Date().toISOString();
    await remoteUpsert("users", u);
  }
  const { id, name, role, email: e, company, status, createdAt, lastLogin, note } = u;
  return { id, email: e, name, role, company, status, createdAt, lastLogin, note };
}

export async function signupRemote(input: { email: string; password: string; name: string; role: Role; company?: string }): Promise<SafeUser> {
  await remoteSignup(input.email, input.password);
  const session = await remoteLogin(input.email, input.password);
  const u: RemoteUser = {
    id: "usr-" + Math.random().toString(36).slice(2, 10),
    auth_id: session.user.id,
    email: input.email,
    name: input.name,
    role: input.role,
    company: input.company,
    status: "active",
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
  };
  await remoteUpsert("users", u);
  const { id, name, role, email, company, status, createdAt, lastLogin } = u;
  return { id, email, name, role, company, status, createdAt, lastLogin };
}

export function remoteMode(): boolean {
  return isConfigured();
}

export async function hasRemoteToken(): Promise<boolean> {
  return hasRemoteSession();
}

export async function listUsersRemote(): Promise<SafeUser[]> {
  const all = await remoteSelect<RemoteUser>("users");
  return all
    .map((u) => {
      const { id, name, role, email, company, status, createdAt, lastLogin, note } = u;
      return { id, name, role, email, company, status, createdAt, lastLogin, note } as SafeUser;
    })
    .sort((a, b) => (a.role === "owner" ? -1 : 1) - (b.role === "owner" ? -1 : 1) || a.name.localeCompare(b.name));
}

export function clearRemoteAuth(): void {
  void clearRemoteSession();
}

/* ----------------------------- feedback ----------------------------- */
function loadFeedback(): Feedback[] {
  return storage.get<Feedback[]>(FEEDBACK_KEY, []);
}
function saveFeedback(list: Feedback[]) {
  storage.set(FEEDBACK_KEY, list);
}

export function addFeedback(input: { userId: string; userName: string; rating: number; category: string; page: string; message: string }): Feedback {
  const list = loadFeedback();
  const fb: Feedback = {
    id: "fb-" + randomHex(6),
    userId: input.userId,
    userName: input.userName,
    rating: Math.max(1, Math.min(5, input.rating)),
    category: input.category,
    page: input.page,
    message: input.message.trim(),
    createdAt: new Date().toISOString(),
    status: "new",
  };
  list.unshift(fb);
  saveFeedback(list);
  return fb;
}

export function listFeedback(): Feedback[] {
  return loadFeedback();
}

export function setFeedbackStatus(id: string, status: Feedback["status"]) {
  const list = loadFeedback();
  const f = list.find((x) => x.id === id);
  if (f) { f.status = status; saveFeedback(list); }
}

export function deleteFeedback(id: string) {
  saveFeedback(loadFeedback().filter((x) => x.id !== id));
}

export const FEEDBACK_CATEGORIES = [
  "UI / UX",
  "GEG-Energiebilanz",
  "DIN 276-Kosten",
  "HOAI-Honorar",
  "Modell-Import",
  "Performance",
  "Bug",
  "Feature-Wunsch",
  "Sonstiges",
];
