import type { Message } from "@chat/shared";
import { formatDayLabel } from "@/lib/format";
import type { PendingMessage } from "@/stores/outbox";

export type Row =
  | { kind: "day"; key: string; label: string }
  | { kind: "unread"; key: string; count: number }
  | { kind: "system"; key: string; message: Message }
  | { kind: "message"; key: string; message: Message; pending?: PendingMessage; mine: boolean; first: boolean; last: boolean };

const GROUP_WINDOW_MS = 5 * 60_000;

export function pendingToMessage(p: PendingMessage, meId: string): Message {
  return {
    id: `pending:${p.clientId}`,
    chatId: p.chatId,
    senderId: meId,
    clientId: p.clientId,
    type: "text",
    body: p.body,
    replyTo: p.replyTo,
    reactions: [],
    mentions: [],
    forwarded: false,
    system: null,
    attachments: p.attachments.map((a) => ({
      id: a.localId,
      kind: a.kind,
      mime: a.mime,
      size: a.size,
      name: a.name,
      url: a.previewUrl ?? "",
      width: a.width,
      height: a.height,
      durationMs: a.durationMs,
      waveform: a.waveform,
      placeholder: a.placeholder,
      thumbUrl: null,
    })),
    createdAt: p.createdAt,
    editedAt: null,
    deletedAt: null,
  };
}

const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();

/** Consecutive messages from one sender, same day, within 5 minutes, render as one visual group. */
const groupable = (a: Message | undefined, b: Message | undefined) =>
  Boolean(
    a &&
      b &&
      a.type !== "system" &&
      b.type !== "system" &&
      a.senderId === b.senderId &&
      sameDay(a.createdAt, b.createdAt) &&
      Math.abs(Date.parse(b.createdAt) - Date.parse(a.createdAt)) < GROUP_WINDOW_MS,
  );

/** Flattens messages (+ optimistic ones) into rows with day separators, group events and the unread divider. */
export function buildRows(messages: Message[], pending: PendingMessage[], meId: string, firstUnread: { id: string; count: number } | null): Row[] {
  const confirmed = new Set(messages.map((m) => m.clientId));
  const all = [
    ...messages.map((message) => ({ message, pending: undefined as PendingMessage | undefined })),
    ...pending.filter((p) => !confirmed.has(p.clientId)).map((p) => ({ message: pendingToMessage(p, meId), pending: p })),
  ];

  const rows: Row[] = [];
  all.forEach(({ message, pending: p }, i) => {
    const prev = all[i - 1]?.message;
    const next = all[i + 1]?.message;
    if (!prev || !sameDay(prev.createdAt, message.createdAt)) {
      rows.push({ kind: "day", key: `day-${new Date(message.createdAt).toDateString()}`, label: formatDayLabel(message.createdAt) });
    }
    if (firstUnread && message.id === firstUnread.id) rows.push({ kind: "unread", key: "unread", count: firstUnread.count });

    // Keyed by sender+clientId so the optimistic bubble and the confirmed one are the same element.
    const key = `${message.senderId}:${message.clientId}`;
    if (message.type === "system") {
      rows.push({ kind: "system", key, message });
      return;
    }
    const breaksBefore = rows.at(-1)?.kind !== "message";
    rows.push({
      kind: "message",
      key,
      message,
      pending: p,
      mine: message.senderId === meId,
      first: breaksBefore || !groupable(prev, message),
      last: !groupable(message, next) || firstUnread?.id === next?.id || (next ? !sameDay(message.createdAt, next.createdAt) : true),
    });
  });
  return rows;
}
