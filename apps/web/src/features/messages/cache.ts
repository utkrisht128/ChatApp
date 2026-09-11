import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { summarizeMessage, type ChatSummary, type Message, type MessagePage, type Receipt } from "@chat/shared";
import { chatKeys, patchChatInCache, type ChatPages } from "@/features/chats/api";
import { useOutbox } from "@/stores/outbox";

export const messageKeys = {
  all: ["messages"] as const,
  list: (chatId: string) => ["messages", chatId] as const,
  receipts: (chatId: string) => ["receipts", chatId] as const,
};

/** pages[0] is the newest page; each page's items are in chronological order. */
export type MessagePages = InfiniteData<MessagePage, string | null>;

const byId = (a: Message, b: Message) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// System messages carry server-rendered text in `body`, so the same preview works for them.
const previewFor = (m: Message) => (m.deletedAt ? "Message deleted" : summarizeMessage(m));

function mapPages(qc: QueryClient, chatId: string, fn: (pages: MessagePage[]) => MessagePage[]) {
  qc.setQueryData<MessagePages>(messageKeys.list(chatId), (data) => (data ? { ...data, pages: fn(data.pages) } : data));
}

/** Inserts or replaces a server-confirmed message and retires its optimistic copy. */
export function upsertMessage(qc: QueryClient, message: Message) {
  useOutbox.getState().remove(message.clientId);
  mapPages(qc, message.chatId, (pages) => {
    if (pages.some((p) => p.items.some((m) => m.id === message.id))) {
      return pages.map((p) => ({ ...p, items: p.items.map((m) => (m.id === message.id ? message : m)) }));
    }
    const [newest, ...older] = pages;
    if (!newest) return pages;
    return [{ ...newest, items: [...newest.items, message].sort(byId) }, ...older];
  });
}

/** Applies an edit/delete/reaction change, including quotes of it and the chat-list preview. */
export function replaceMessage(qc: QueryClient, message: Message) {
  const preview = previewFor(message);
  mapPages(qc, message.chatId, (pages) =>
    pages.map((p) => ({
      ...p,
      items: p.items.map((m) =>
        m.id === message.id ? message : m.replyTo?.id === message.id ? { ...m, replyTo: { ...m.replyTo, preview } } : m,
      ),
    })),
  );
  patchChatInCache(qc, message.chatId, (c) => (c.lastMessage?.id === message.id ? { ...c, lastMessage: { ...c.lastMessage, preview } } : c));
}

export function removeMessage(qc: QueryClient, chatId: string, messageId: string) {
  mapPages(qc, chatId, (pages) => pages.map((p) => ({ ...p, items: p.items.filter((m) => m.id !== messageId) })));
}

export function applyReceipt(qc: QueryClient, chatId: string, receipt: Receipt) {
  qc.setQueryData<Receipt[]>(messageKeys.receipts(chatId), (old = []) => {
    const i = old.findIndex((r) => r.userId === receipt.userId);
    const merged = { ...old[i], ...receipt };
    return i === -1 ? [...old, merged] : old.map((r, j) => (j === i ? merged : r));
  });
}

/** Moves the chat to the top of the list (below pinned chats) with the new preview and unread count. */
export function applyMessageToChatList(qc: QueryClient, message: Message, opts: { meId: string; isActive: boolean }) {
  const mine = message.senderId === opts.meId && message.type !== "system";
  const countsAsUnread = !mine && !opts.isActive && message.type !== "system";
  const update = (c: ChatSummary): ChatSummary => ({
    ...c,
    lastMessage: { id: message.id, senderId: message.senderId, preview: previewFor(message), type: message.type, createdAt: message.createdAt },
    lastMessageAt: message.createdAt,
    // Sending clears your own unread (the server does the same); the open chat is read momentarily.
    unreadCount: mine ? 0 : countsAsUnread ? c.unreadCount + 1 : c.unreadCount,
    mentionCount: mine ? 0 : c.mentionCount,
  });

  let found = false;
  qc.setQueriesData<ChatPages>({ queryKey: chatKeys.lists }, (data) => {
    if (!data) return data;
    const hit: { chat?: ChatSummary } = {};
    const pages = data.pages.map((p) => ({
      ...p,
      items: p.items.filter((c) => {
        if (c.id !== message.chatId) return true;
        hit.chat = c;
        return false;
      }),
    }));
    if (!hit.chat) return data;
    found = true;
    const updated = update(hit.chat);
    // Pinned chats keep their slot; everything else jumps to the top of the unpinned section.
    if (updated.pinned) return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((c) => (c.id === updated.id ? updated : c)) })) };
    const [first, ...rest] = pages;
    if (!first) return data;
    const items = [...first.items];
    items.splice(items.filter((c) => c.pinned).length, 0, updated);
    return { ...data, pages: [{ ...first, items }, ...rest] };
  });
  qc.setQueryData<ChatSummary>(chatKeys.detail(message.chatId), (c) => (c ? update(c) : c));
  // A chat we haven't seen yet (e.g. someone just messaged us for the first time).
  if (!found) void qc.invalidateQueries({ queryKey: chatKeys.lists });
}

export function applyPresence(qc: QueryClient, p: { userId: string; online?: boolean; lastSeenAt?: string | null }) {
  const patch = (c: ChatSummary): ChatSummary =>
    c.peer?.id === p.userId
      ? {
          ...c,
          peer: {
            ...c.peer,
            ...(p.online !== undefined ? { online: p.online } : {}),
            ...(p.lastSeenAt !== undefined ? { lastSeenAt: p.lastSeenAt } : {}),
          },
        }
      : c;
  qc.setQueriesData<ChatPages>({ queryKey: chatKeys.lists }, (data) =>
    data ? { ...data, pages: data.pages.map((pg) => ({ ...pg, items: pg.items.map(patch) })) } : data,
  );
  qc.setQueriesData<ChatSummary>({ queryKey: ["chats", "detail"] }, (c) => (c ? patch(c) : c));
}
