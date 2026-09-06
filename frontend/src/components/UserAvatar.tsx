// NARCHI — Avatar d'utilisateur : photo personnelle OU emoji choisi OU
// initiales sur teinte stable (jamais « ennuyeux » — chaque identité a sa
// couleur déterministe). Lecture du registre local lib/avatars.

import { useSyncExternalStore } from "react";
import { initialsOf } from "@/lib/contacts";
import { avatarKeyOf, avatarRegistryVersion, onAvatarRegistryChange, resolveAvatar } from "@/lib/avatars";
import { cn } from "@/utils/cn";

export default function UserAvatar({
  name,
  ownerKey,
  size = 32,
  className,
  variant = "color",
}: {
  /// Nom affiché (sert aux initiales et à la clé de repli).
  name: string;
  /// Clé avatar stable — par défaut dérivée du nom (comptes introuvables).
  ownerKey?: string;
  size?: number;
  className?: string;
  /// §57 — « brand » : pastille NOIRE à initiales or, alignée sur le logo N —
  /// réservée à l'utilisateur courant (demande explicite). Les contacts
  /// gardent leur teinte déterministe par personne (lisibilité des fils).
  variant?: "color" | "brand";
}) {
  const key = ownerKey ?? avatarKeyOf({ name });
  // §83 — abonnement au registre : la résolution se recalcule à CHAQUE
  // écriture/hydratation (fin de l'icône figée après propagation serveur).
  // readAll est mémoïsé par version — rerendu global sans re-parse JSON.
  const version = useSyncExternalStore(onAvatarRegistryChange, avatarRegistryVersion);
  void version;
  const resolved = resolveAvatar(key);
  const style = { width: size, height: size, fontSize: Math.round(size / 2.4) };

  if (resolved.kind === "photo") {
    return (
      <img
        src={resolved.photo}
        alt={name}
        style={style}
        className={cn("shrink-0 rounded-full object-cover ring-1 ring-slate-200", className)}
      />
    );
  }

  if (resolved.kind === "emoji") {
    return (
      <span
        role="img"
        aria-label={name}
        style={{ ...style, background: `hsl(${resolved.hue} 80% 88%)` }}
        className={cn("flex shrink-0 items-center justify-center rounded-full ring-1 ring-black/5", className)}
      >
        <span style={{ fontSize: Math.round(size / 1.9), lineHeight: 1 }}>{resolved.emoji}</span>
      </span>
    );
  }

  if (variant === "brand") {
    // Disque noir, initiales or — la signature NARCHI (logo N) appliquée
    // aux initiales. Une photo/emoji personnels restent prioritaires.
    return (
      <span
        aria-label={name}
        style={style}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-zinc-900 font-bold text-brand-400 ring-1 ring-zinc-700/60",
          className,
        )}
      >
        {initialsOf(name)}
      </span>
    );
  }

  return (
    <span
      aria-label={name}
      style={{ ...style, background: `hsl(${resolved.hue} 55% 42%)` }}
      className={cn("flex shrink-0 items-center justify-center rounded-full font-bold text-white ring-1 ring-black/10", className)}
    >
      {initialsOf(name)}
    </span>
  );
}
