// Tests de la liste de contacts du rail Messenger.

import { describe, expect, it } from "vitest";
import { buildContacts, initialsOf, partitionContacts, roleLabelOf } from "@/lib/contacts";

const USERS = [
  { id: "u-anna", name: "Anna Berger", email: "anna@narchi.de", role: "architect" },
  { id: "u-max", name: "Max Zimmermann", email: "max@narchi.de", role: "owner" },
  { id: "u-ich", name: "Halil Kaya", email: "halil@narchi.de", role: "owner" },
  { id: "u-gast", name: "", email: "gast@extern.de", role: "guest" },
];

describe("initialsOf / roleLabelOf", () => {
  it("initiales sur 2 caractères", () => {
    expect(initialsOf("Anna Berger")).toBe("AB");
    expect(initialsOf("Zimmermann")).toBe("Z");
    expect(initialsOf("")).toBe("??");
  });

  it("libellé de rôle allemand avec repli Team", () => {
    expect(roleLabelOf("owner")).toBe("Büroleitung");
    expect(roleLabelOf("architect")).toBe("Architekt:in");
    expect(roleLabelOf("baufuehrer")).toBe("Team");
    expect(roleLabelOf(null)).toBe("Team");
  });
});

describe("buildContacts", () => {
  it("exclut l'utilisateur courant et trie alphabétiquement", () => {
    const contacts = buildContacts(USERS, "u-ich");
    expect(contacts.map((c) => c.userId)).toEqual(["u-anna", "u-gast", "u-max"]);
    expect(contacts[0]).toMatchObject({ displayName: "Anna Berger", initials: "AB", roleLabel: "Architekt:in" });
  });

  it("nom vide → e-mail comme nom affiché", () => {
    const gast = buildContacts(USERS, "u-ich").find((c) => c.userId === "u-gast");
    expect(gast!.displayName).toBe("gast@extern.de");
    expect(gast!.initials).toBe("G");
  });

  it("filtre par nom ou e-mail, insensible à la casse", () => {
    expect(buildContacts(USERS, "u-ich", "ZIMMER").map((c) => c.userId)).toEqual(["u-max"]);
    expect(buildContacts(USERS, "u-ich", "@extern").map((c) => c.userId)).toEqual(["u-gast"]);
    expect(buildContacts(USERS, "u-ich", "personne")).toEqual([]);
  });

  it("doublons et entrées invalides ignorés", () => {
    const contacts = buildContacts(
      [...USERS, { id: "u-anna", name: "Anna Berger" }, { id: "" }, null as never, { id: 42 as never }],
      "u-ich",
    );
    expect(new Set(contacts.map((c) => c.userId)).size).toBe(contacts.length);
    expect(contacts).toHaveLength(3);
  });
});

describe("partitionContacts", () => {
  const LOCAL = [
    { id: "local-ich", name: "Halil Kaya", email: "halil@narchi.de", role: "owner" },
    { id: "local-anna", name: "Anna Berger", email: "anna@narchi.de", role: "architect" },
    { id: "local-demo", name: "Demo Kollege", email: "demo@narchi.local", role: "architect" },
  ];

  it("comptes réels dans withAccount, démos locales dans withoutAccount", () => {
    const remote = [
      { id: "501", name: "Halil Kaya", email: "halil@narchi.de", role: "owner" },
      { id: "502", name: "Anna Berger", email: "anna@narchi.de", role: "architect" },
    ];
    const part = partitionContacts(remote, LOCAL, "local-ich", "halil@narchi.de");
    // Moi exclu (par e-mail — les ids local/backend diffèrent)
    expect(part.withAccount.map((c) => c.userId)).toEqual(["502"]);
    expect(part.withAccount[0]).toMatchObject({ displayName: "Anna Berger", roleLabel: "Architekt:in" });
    // Anna dédupliquée (son e-mail a un compte réel) ; le démo reste
    expect(part.withoutAccount.map((c) => c.userId)).toEqual(["local-demo"]);
  });

  it("backend injoignable (remote null) → pas de withAccount, tout en local", () => {
    const part = partitionContacts(null, LOCAL, "local-ich", "halil@narchi.de");
    expect(part.withAccount).toEqual([]);
    expect(part.withoutAccount.map((c) => c.userId)).toEqual(["local-anna", "local-demo"]);
  });

  it("le filtre s'applique aux deux listes", () => {
    const remote = [{ id: "502", name: "Anna Berger", email: "anna@narchi.de", role: "architect" }];
    const part = partitionContacts(remote, LOCAL, "local-ich", "halil@narchi.de", "demo");
    expect(part.withAccount).toEqual([]);
    expect(part.withoutAccount.map((c) => c.userId)).toEqual(["local-demo"]);
  });
});
