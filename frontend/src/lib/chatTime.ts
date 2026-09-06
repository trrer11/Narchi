// NARCHI — Horodatage des messages de chat (traçabilité).
// Règle d'affichage : aujourd'hui → « 14:35 » ; autre jour de l'année →
// « 03.08. 14:35 » ; autre année → « 03.08.2025 14:35 ».

const pad = (value: number) => String(value).padStart(2, "0");

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatChatTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const hhmm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDay(date, now)) return hhmm;
  const ddmm = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.`;
  if (date.getFullYear() === now.getFullYear()) return `${ddmm} ${hhmm}`;
  return `${ddmm}${date.getFullYear()} ${hhmm}`;
}
