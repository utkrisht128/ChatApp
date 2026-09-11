const DAY = 86_400_000;

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const yesterdayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);

export const formatClock = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Chat list timestamp: time today, "Yesterday", weekday this week, otherwise a short date. */
export function formatChatTime(iso: string, now = new Date()) {
  const d = new Date(iso);
  if (sameDay(d, now)) return formatClock(d);
  if (sameDay(d, yesterdayOf(now))) return "Yesterday";
  if (now.getTime() - d.getTime() < 6 * DAY) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** Date separator in a conversation: "Today", "Yesterday", "Monday", "12 March 2025". */
export function formatDayLabel(iso: string, now = new Date()) {
  const d = new Date(iso);
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, yesterdayOf(now))) return "Yesterday";
  if (now.getTime() - d.getTime() < 6 * DAY) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], {
    day: "numeric",
    month: "long",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function formatLastSeen(iso: string | null | undefined, now = new Date()) {
  if (!iso) return "last seen recently";
  const d = new Date(iso);
  const mins = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (mins < 1) return "last seen just now";
  if (mins < 60) return `last seen ${mins} min ago`;
  if (sameDay(d, now)) return `last seen today at ${formatClock(d)}`;
  if (sameDay(d, yesterdayOf(now))) return `last seen yesterday at ${formatClock(d)}`;
  return `last seen ${d.toLocaleDateString([], { day: "numeric", month: "short" })}`;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]![0], parts.at(-1)![0]] : [...(parts[0] ?? "?")].slice(0, 2);
  return letters.join("").toUpperCase();
}
