// NARCHI — Sélecteur d'avatar (pop-over) : photo personnelle (car recadrée
// dans le navigateur) OU emoji fun OU retour aux initiales colorées.
// Enregistré localement (lib/avatars) — affiché partout où UserAvatar
// apparaît (rail, chat, Team, barre latérale).

import { useRef, useState } from "react";
import UserAvatar from "@/components/UserAvatar";
import {
  AVATAR_EMOJIS,
  avatarKeyOf,
  fileToAvatarDataUrl,
  getAvatar,
  removeAvatar,
  setAvatar,
} from "@/lib/avatars";
import { Icon } from "@/components/ui";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export default function AvatarPicker({
  user,
  onClose,
  onChange,
}: {
  /// Utilisateur dont on édite l'avatar (e-mail en priorité pour la clé).
  user: { id?: string; name?: string | null; email?: string | null };
  onClose: () => void;
  /// Rappelé après chaque changement (forçage du re-rendu parent).
  onChange?: () => void;
}) {
  const ownerKey = avatarKeyOf(user);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const displayName = user.name || user.email || "Ich";

  // §80 → §82 — persiste la clé ET LE CONTENU côté serveur : l'icône devient
  // visible pour les autres comptes et sur les autres appareils (le §80 ne
  // propageait que la clé, l'image restait coincée dans ce navigateur).
  // §83 — ÉCHEC VISIBLE : avant, le .catch(() => {}) avalait tout refus
  // serveur (validation, réseau) → l'utilisateur croyait l'icône propagée
  // alors que rien n'était stocké. Un refus s'affiche maintenant ici même.
  const persist = async () => {
    try {
      const m = await import("@/lib/members");
      const spec = getAvatar(ownerKey);
      await m.updateMyProfile({
        avatar_key: ownerKey,
        avatar_json: spec ? JSON.stringify(spec) : JSON.stringify({ clear: true }),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(`Avatar nicht auf dem Server gespeichert — ${detail}`);
    }
  };
  const handleFile = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const photo = await fileToAvatarDataUrl(file);
      if (!setAvatar(ownerKey, { kind: "photo", photo })) {
        setError("Speicher voll — bitte ein kleineres Bild wählen.");
      } else {
        void persist(); onChange?.();
      }
    } catch {
      setError("Bild konnte nicht gelesen werden.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-ink-900">
      <div className="flex items-center justify-between bg-ink-900 px-3 py-2.5">
        <p className="text-sm font-bold text-white">Mein Avatar</p>
        <button onClick={onClose} aria-label="Schließen" className="rounded p-0.5 text-white/70 transition hover:text-white">
          <Icon name="x" size={14} />
        </button>
      </div>

      <div className="flex items-center gap-3 p-3">
        <UserAvatar name={displayName} ownerKey={ownerKey} size={56} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-800 dark:text-white">{displayName}</p>
          <p className="truncate text-[11px] text-slate-400">{user.email}</p>
          <button
            onClick={() => { if (removeAvatar(ownerKey)) { void persist(); onChange?.(); } }}
            className="mt-1 text-[11px] font-medium text-slate-400 underline-offset-2 hover:text-rose-500 hover:underline"
          >
            Zurücksetzen (Initialen)
          </button>
        </div>
      </div>

      <div className="border-t border-slate-100 px-3 pb-2 pt-2 dark:border-slate-800">
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-3 py-2 text-xs font-bold text-ink-950 transition hover:brightness-105 disabled:opacity-60"
        >
          <Icon name="download" size={14} /> {busy ? "Wird geladen…" : "Eigenes Foto hochladen"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            event.target.value = "";
          }}
        />
        <p className="mt-1.5 text-center text-[10px] text-slate-400">
          Automatisch quadratisch zugeschnitten (128 px) — wird serverseitig gespeichert und für dein Team sichtbar (§82).
        </p>
      </div>

      <div className="border-t border-slate-100 p-3 dark:border-slate-800">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">ODER WITZIGE AUSWAHL</p>
        <div className="grid grid-cols-8 gap-1.5">
          {AVATAR_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              aria-label={`Avatar ${emoji}`}
              onClick={() => { setError(null); if (setAvatar(ownerKey, { kind: "emoji", emoji })) { void persist(); onChange?.(); } }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition hover:scale-125 hover:bg-brand-50"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="border-t border-rose-100 bg-rose-50 px-3 py-2 text-[11px] text-rose-600 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
