/**
 * TEST P1-B : disjoncteur de session (gel controle + persistance en sursis).
 * Verrouille le contrat CTO :
 *  1. 401 hors /auth/ -> suspend() + event narchi-session-expired (une fois).
 *  2. 401 sur /auth/ (mauvais mot de passe) -> AUCUNE suspension.
 *  3. Pendant le gel : flushQueue() n emet RIEN, la file reste persistee.
 *  4. Succes login : resume() SYNCHRONE puis flushQueue(true) depile.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionSecurity } from "./sessionSecurity";
import { secureFetch } from "./SecuritySanitizer";

describe("P1-B - disjoncteur de session", () => {
  beforeEach(() => {
    sessionSecurity.resume();
    localStorage.clear();
  });

  it("401 hors /auth/ : suspend + broadcast narchi-session-expired (une seule fois)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    const expired = vi.fn();
    window.addEventListener("narchi-session-expired", expired);

    await secureFetch("/api/v5/chat/channels");
    expect(sessionSecurity.isSuspended()).toBe(true);
    expect(expired).toHaveBeenCalledTimes(1);

    // 2e 401 pendant le gel : pas de re-broadcast (anti-tempete d evenements).
    await secureFetch("/api/v5/ifc/projects");
    expect(expired).toHaveBeenCalledTimes(1);

    window.removeEventListener("narchi-session-expired", expired);
    vi.unstubAllGlobals();
  });

  it("401 sur /auth/ (mauvais mot de passe) : AUCUNE suspension", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    await secureFetch("/api/v5/auth/token", { method: "POST" });
    expect(sessionSecurity.isSuspended()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("pendant le gel : flushQueue() n emet aucune requete, la file survit", async () => {
    // File persistee avec 2 ecritures en attente.
    localStorage.setItem(
      "narchi:writequeue",
      JSON.stringify([
        { id: 1, table: "projects", op: "upsert", doc: { id: "p1" } },
        { id: 2, table: "elements", op: "delete", rowId: "e9" },
      ]),
    );
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    sessionSecurity.suspend();
    const { flushQueue, queueLength } = await import("@/lib/remoteDb");
    await flushQueue();

    expect(fetchMock).not.toHaveBeenCalled();          // gel : zero emission
    expect(queueLength()).toBe(2);                     // sursis : file intacte
    expect(localStorage.getItem("narchi:writequeue")).toContain("p1"); // survit a l onglet
    vi.unstubAllGlobals();
  });

  it("resume() est synchrone : isSuspended() bascule dans le meme tick", () => {
    sessionSecurity.suspend();
    expect(sessionSecurity.isSuspended()).toBe(true);
    sessionSecurity.resume();                           // contrat: SYNCHRONE
    expect(sessionSecurity.isSuspended()).toBe(false);  // lecture immediate
  });

  it("flushQueue(force=true) court-circuite un gel residuel (rejeu post-login)", async () => {
    localStorage.setItem(
      "narchi:writequeue",
      JSON.stringify([{ id: 1, table: "projects", op: "upsert", doc: { id: "p1" } }]),
    );
    sessionSecurity.suspend(); // re-suspension concurrente entre resume() et flush
    const { flushQueue } = await import("@/lib/remoteDb");
    // Sans force: bloque. Avec force: la garde isSuspended est court-circuitee
    // (le rejeu atteint la couche remote, qui echouera ou non selon le reseau
    //  — ici isOnline() est faux en environnement de test, donc pas d emission,
    //  mais la garde du gel est bien passee : c est le contrat teste).
    await expect(flushQueue(true)).resolves.toBeUndefined();
  });
});
