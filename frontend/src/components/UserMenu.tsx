// NARCHI — Menu profil du header (§48, retouche utilisateur).
// L'avatar du coin supérieur droit était une image MORTE : il est désormais
// un vrai bouton qui ouvre un menu — paramétrer son profil, changer d'avatar
// (AvatarPicker existant, photo/emoji réels), se déconnecter. Fermeture :
// clic dehors + Échap. Aucune donnée fictive (nom/e-mail/rôle réels du compte).

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/store/AuthStore";
import { useApp } from "@/store/AppStore";
import { Icon } from "@/components/ui";
import UserAvatar from "@/components/UserAvatar";
import AvatarPicker from "@/components/AvatarPicker";
import { avatarKeyOf } from "@/lib/avatars";
import { cn } from "@/utils/cn";

export function UserMenu() {
  const { user, isOwner, logout } = useAuth();
  const { navigate } = useApp();
  const [open, setOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  /// Remonte l'avatar après choix (UserAvatar lit le registre local en mémo).
  const [avatarTick, setAvatarTick] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const name = user?.name?.trim() || "Architekt";
  const email = user?.email?.trim() || "";
  const roleLabel = isOwner ? "Eigentümer" : "Architekt";
  const avatarKey = avatarKeyOf({ email: user?.email, name, id: user?.id });

  useEffect(() => {
    if (!open && !avatarOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setAvatarOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setAvatarOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, avatarOpen]);

  const item =
    "flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50";

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => {
          setAvatarOpen(false);
          setOpen((o) => !o);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Profilmenü öffnen — ${name}`}
        title="Profil & Einstellungen"
        className="rounded-full transition hover:ring-2 hover:ring-brand-300 hover:ring-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <UserAvatar key={avatarTick} name={name} ownerKey={avatarKey} size={32} variant="brand" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-40 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-xl"
        >
          {/* En-tête compte réel */}
          <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3">
            <UserAvatar name={name} ownerKey={avatarKey} size={36} variant="brand" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-zinc-900">{name}</p>
              <p className="truncate text-[11px] text-zinc-500">{email || roleLabel}</p>
            </div>
            <span className="ml-auto shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700">
              {roleLabel}
            </span>
          </div>

          <button
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              navigate("/app/settings");
            }}
          >
            <Icon name="cog" size={16} className="text-zinc-400" />
            Profil & Einstellungen
            <Icon name="arrowRight" size={12} className="ml-auto text-zinc-300" />
          </button>
          <button
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              setAvatarOpen(true);
            }}
          >
            <Icon name="users" size={16} className="text-zinc-400" />
            Avatar ändern
            <Icon name="arrowRight" size={12} className="ml-auto text-zinc-300" />
          </button>

          <div className="my-1 border-t border-zinc-100" />
          <button
            role="menuitem"
            className={cn(item, "text-rose-600 hover:bg-rose-50")}
            onClick={() => {
              setOpen(false);
              logout();
            }}
          >
            <Icon name="arrowRight" size={14} className="rotate-180 text-rose-400" />
            Abmelden
          </button>
        </div>
      )}

      {avatarOpen && user && (
        <div className="absolute right-0 top-12 z-50 w-72" key={`user-menu-picker-${avatarTick}`}>
          <AvatarPicker
            user={{ id: user.id, name: user.name, email: user.email }}
            onClose={() => setAvatarOpen(false)}
            onChange={() => {
              setAvatarTick((n) => n + 1);
              setAvatarOpen(false); // l'avatar frais est visible d'un coup d'œil
            }}
          />
        </div>
      )}
    </div>
  );
}
