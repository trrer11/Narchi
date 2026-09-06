// Tests des avatars : clés stables, teinte déterministe, persistance,
// résolution en cascade photo → emoji → initiales.

import { beforeEach, describe, expect, it } from "vitest";
import {
  AVATARS_STORAGE_KEY,
  avatarKeyDirectory,
  avatarKeyOf,
  avatarRegistryVersion,
  getAvatar,
  hueFor,
  hydrateAvatarsFromServer,
  onAvatarRegistryChange,
  ownerKeyForName,
  parseAvatarJson,
  removeAvatar,
  resolveAvatar,
  setAvatar,
} from "@/lib/avatars";

describe("avatarKeyOf / ownerKeyForName", () => {
  it("e-mail prioritaire, normalisé en minuscules", () => {
    expect(avatarKeyOf({ email: " Halil@Narchi.de ", name: "Halil", id: "u1" })).toBe("halil@narchi.de");
  });
  it("repli clé nominative puis id", () => {
    expect(avatarKeyOf({ name: "Anna Berger" })).toBe("n:anna berger");
    expect(avatarKeyOf({ email: "", name: "", id: "u-77" })).toBe("id:u-77");
  });
  it("ownerKeyForName résout vers le compte quand le nom est connu", () => {
    const users = [{ id: "u1", name: "Anna Berger", email: "anna@narchi.de" }];
    expect(ownerKeyForName(users, "Anna Berger")).toBe("anna@narchi.de");
    expect(ownerKeyForName(users, "Inconnu")).toBe("n:inconnu");
  });
});

describe("hueFor", () => {
  it("stable et dans 0–359", () => {
    const a = hueFor("halil@narchi.de");
    expect(hueFor("halil@narchi.de")).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(360);
  });
  it("des identités différentes n'ont quasiment jamais la même teinte", () => {
    const hues = new Set(["anna@narchi.de", "max@narchi.de", "halil@narchi.de", "demo@x.de"].map(hueFor));
    expect(hues.size).toBeGreaterThanOrEqual(3);
  });
});

describe("persistance + résolution", () => {
  beforeEach(() => localStorage.removeItem(AVATARS_STORAGE_KEY));

  it("aller-retour set → get → remove", () => {
    expect(setAvatar("anna@narchi.de", { kind: "emoji", emoji: "🏗️" })).toBe(true);
    expect(getAvatar("anna@narchi.de")).toEqual({ kind: "emoji", emoji: "🏗️" });
    removeAvatar("anna@narchi.de");
    expect(getAvatar("anna@narchi.de")).toBeNull();
  });

  it("cascade photo → emoji → initiales avec teinte stable", () => {
    expect(resolveAvatar("x@y.de").kind).toBe("initials");
    setAvatar("x@y.de", { kind: "emoji", emoji: "🦺" });
    const emojiRes = resolveAvatar("x@y.de");
    if (emojiRes.kind !== "emoji") throw new Error(`résolution inattendue : ${emojiRes.kind}`);
    expect(emojiRes.hue).toBe(hueFor("x@y.de"));
    setAvatar("x@y.de", { kind: "photo", photo: "data:image/jpeg;base64,AAA" });
    expect(resolveAvatar("x@y.de")).toEqual({ kind: "photo", photo: "data:image/jpeg;base64,AAA" });
  });

  it("JSON corrompu → repli initiales sans exception", () => {
    localStorage.setItem(AVATARS_STORAGE_KEY, "%{");
    expect(getAvatar("x@y.de")).toBeNull();
    expect(resolveAvatar("x@y.de").kind).toBe("initials");
  });
});

describe("§82 — hydratation depuis le serveur (propagation des icônes)", () => {
  beforeEach(() => localStorage.removeItem(AVATARS_STORAGE_KEY));

  const photo = "data:image/jpeg;base64," + "QUJD".repeat(10);
  const userPhoto = { avatar_key: "anna@büro.de", avatar_json: JSON.stringify({ kind: "photo", photo }) };
  const userEmoji = { avatar_key: "ben@büro.de", avatar_json: JSON.stringify({ kind: "emoji", emoji: "🦉" }) };

  it("verse les contenus valides, ignore formes hostiles ou incomplètes", () => {
    const changed = hydrateAvatarsFromServer([
      userPhoto,
      userEmoji,
      { avatar_key: "", avatar_json: JSON.stringify({ kind: "photo", photo }) },   // sans clé
      { avatar_key: "x@y.de", avatar_json: '{"kind":"script","photo":"x"}' },      // kind hostile
      { avatar_key: "y@z.de", avatar_json: "pas du json" },                        // JSON cassé
      { avatar_key: "z@q.de", avatar_json: JSON.stringify({ kind: "photo", photo: "http://evil/x.svg" }) },
      { avatar_key: "w@q.de" },                                                     // avatar_json absent
    ]);
    expect(changed).toBe(2);
    expect(getAvatar("anna@büro.de")).toEqual({ kind: "photo", photo });
    expect(getAvatar("ben@büro.de")).toEqual({ kind: "emoji", emoji: "🦉" });
    expect(getAvatar("x@y.de")).toBeNull();
    expect(getAvatar("y@z.de")).toBeNull();
    expect(getAvatar("z@q.de")).toBeNull();
  });

  it("idempotent : une spec identique n'est pas réécrite (compteur 0)", () => {
    expect(hydrateAvatarsFromServer([userPhoto])).toBe(1);
    expect(hydrateAvatarsFromServer([userPhoto])).toBe(0);
    // … mais une NOUVELLE version serveur remplace l'ancienne (serveur = foi)
    const v2 = { avatar_key: "anna@büro.de", avatar_json: JSON.stringify({ kind: "emoji", emoji: "🧱" }) };
    expect(hydrateAvatarsFromServer([v2])).toBe(1);
    expect(getAvatar("anna@büro.de")).toEqual({ kind: "emoji", emoji: "🧱" });
  });

  it("parseAvatarJson verrouille les préfixes et les tailles", () => {
    expect(parseAvatarJson(null)).toBeNull();
    expect(parseAvatarJson(JSON.stringify({ kind: "emoji", emoji: "🏗️" }))).toEqual({ kind: "emoji", emoji: "🏗️" });
    expect(parseAvatarJson(JSON.stringify({ kind: "photo", photo: "data:image/png;base64,AAA" }))).not.toBeNull();
    expect(parseAvatarJson(JSON.stringify({ kind: "photo", photo: "data:text/html;base64,AAAA" }))).toBeNull();
    expect(parseAvatarJson(JSON.stringify({ kind: "photo", photo: "data:image/jpeg;base64," + "A".repeat(70_000) }))).toBeNull();
  });
});

/* ------------------------------- §83 ---------------------------------- */

describe("§83 — registre réactif (version + abonnés)", () => {
  beforeEach(() => localStorage.removeItem(AVATARS_STORAGE_KEY));

  it("chaque écriture/hydratation incrémente la version et notifie les abonnés", () => {
    const seen: number[] = [];
    const off = onAvatarRegistryChange(() => seen.push(avatarRegistryVersion()));
    const v0 = avatarRegistryVersion();
    setAvatar("a@b.de", { kind: "emoji", emoji: "🧱" });
    hydrateAvatarsFromServer([
      { avatar_key: "c@d.de", avatar_json: JSON.stringify({ kind: "emoji", emoji: "📐" }) },
    ]);
    off();
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeGreaterThan(v0);
    expect(seen[1]).toBeGreaterThan(seen[0]);
  });

  it("hydratation IDENTIQUE = zéro notification (pas de tempête de rerendus)", () => {
    const calls: number[] = [];
    const payload = [{ avatar_key: "e@f.de", avatar_json: JSON.stringify({ kind: "emoji", emoji: "🦉" }) }];
    hydrateAvatarsFromServer(payload); // premier versement (hors comptage)
    const off = onAvatarRegistryChange(() => calls.push(avatarRegistryVersion()));
    expect(hydrateAvatarsFromServer(payload)).toBe(0);
    off();
    expect(calls).toHaveLength(0);
  });
});

describe("§83 — annuaire de résolution (cause exacte des icônes invisibles)", () => {
  beforeEach(() => localStorage.removeItem(AVATARS_STORAGE_KEY));

  it("le distant (e-mail) prime sur le local ; dédoublonné par e-mail puis nom", () => {
    const distant = [
      { id: "1", name: "Anna Berger", email: "anna@buero.de" },
      { id: "2", name: "Max", email: "max@buero.de" },
    ];
    const local = [
      { id: "9", name: "Anna Berger", email: "anna@buero.de" }, // doublon e-mail → écarté
      { id: "8", name: "Halil", email: "" },                    // gardé (nom unique)
      { id: "7", name: "halil", email: "" },                    // doublon nom (casse) → écarté
    ];
    const dir = avatarKeyDirectory(distant, local, null, undefined);
    expect(dir.map((u) => u.id)).toEqual(["1", "2", "8"]);
  });

  it("RÉGRESSION : « nom affiché » → clé e-mail → icône hydratée du serveur", () => {
    // AVANT §83 : ownerKeyForName(annuaireLocalSansCollegues, "Anna Berger")
    // repliquait sur « n:anna berger » ≠ clé serveur « anna@buero.de » →
    // l'icône propagée n'apparaissait JAMAIS dans les fenêtres de discussion.
    hydrateAvatarsFromServer([
      { avatar_key: "anna@buero.de", avatar_json: JSON.stringify({ kind: "emoji", emoji: "🦉" }) },
    ]);
    const distant = [{ id: "u1", name: "Anna Berger", email: "anna@buero.de", role: "owner" }];
    const local = [{ id: "me", name: "Halil", email: "halil@buero.de" }];
    const key = ownerKeyForName(avatarKeyDirectory(distant, local), "Anna Berger");
    expect(key).toBe("anna@buero.de");
    expect(resolveAvatar(key)).toEqual({ kind: "emoji", emoji: "🦉", hue: hueFor("anna@buero.de") });
    // Et un nom inconnu garde son repli nominatif stable (initiales teintées).
    expect(ownerKeyForName(avatarKeyDirectory(distant, local), "Inconnu")).toBe("n:inconnu");
  });
});
