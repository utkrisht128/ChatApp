import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { describeSystemEvent, type ChatSummary, type Message } from "@chat/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { ErrorState } from "@/components/ui/States";
import { cn } from "@/lib/cn";
import { useOutbox, type PendingMessage } from "@/stores/outbox";
import { deliver, discardPending, flattenMessages, markChatRead, useMessages, usePinned, useReact, useReceipts, useSetPinned, useSetStarred, useStarredIds } from "./api";
import { MessageBubble } from "./MessageBubble";
import type { MentionLookup } from "./RichText";
import { buildRows } from "./rows";
import { statusOf } from "./status";

export type Person = { name: string; avatarUrl: string | null };

type Props = {
  chat: ChatSummary;
  meId: string;
  nameOf: (userId: string) => string;
  /** Group chats show each sender's name and avatar. */
  personOf: (userId: string) => Person;
  mentionOf: MentionLookup;
  /** Whether this viewer may pin in this chat (the server enforces it too). */
  canPin: boolean;
  /** Set by the pinned bar and by search results to scroll to a particular message. */
  jumpTarget: { id: string; nonce: number } | null;
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  onForward: (m: Message) => void;
};

function SystemRow({ message, meId, nameOf }: { message: Message; meId: string; nameOf: (id: string) => string }) {
  const text = message.system
    ? describeSystemEvent(message.system, (id, asTarget) => (id === meId ? (asTarget ? "you" : "You") : nameOf(id)))
    : message.body;
  return (
    <div className="my-2 flex justify-center px-6">
      <p className="max-w-md rounded-full bg-surface/85 px-3 py-1 text-center text-xs text-muted shadow-bubble">{text}</p>
    </div>
  );
}

function Intro({ chat }: { chat: ChatSummary }) {
  return (
    <div className="mx-auto my-6 flex max-w-xs flex-col items-center rounded-3xl bg-surface/85 px-6 py-6 text-center shadow-bubble">
      <Avatar name={chat.name} src={chat.avatarUrl} seed={chat.peer?.id ?? chat.id} size="xl" />
      <p className="mt-3 font-semibold">{chat.name}</p>
      {chat.peer && <p className="text-sm text-muted">@{chat.peer.username}</p>}
      <p className="mt-3 text-sm text-muted">This is the beginning of your conversation.</p>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading messages" className="flex flex-1 flex-col justify-end gap-2 p-4">
      {["w-48", "w-64", "w-36", "w-56", "w-40", "w-52"].map((w, i) => (
        <Skeleton key={w} className={cn("h-10 max-w-[70%] rounded-2xl", w, i % 3 === 1 ? "self-end" : "self-start")} />
      ))}
    </div>
  );
}

export function MessageList({ chat, meId, nameOf, personOf, mentionOf, canPin, jumpTarget, onReply, onEdit, onDelete, onForward }: Props) {
  const isGroup = chat.type === "group";
  const qc = useQueryClient();
  const query = useMessages(chat.id);
  const receipts = useReceipts(chat.id);
  const pending = useOutbox(useShallow((s) => s.items.filter((p) => p.chatId === chat.id)));
  const react = useReact(meId);
  const starredIds = useStarredIds();
  const pinnedQuery = usePinned(chat.id);
  const pinnedIds = useMemo(() => new Set((pinnedQuery.data ?? []).map((m) => m.id)), [pinnedQuery.data]);
  const setPinned = useSetPinned(chat.id);
  const setStarred = useSetStarred();

  const scrollRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [newWhileAway, setNewWhileAway] = useState(0);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const messages = useMemo(() => flattenMessages(query.data), [query.data]);

  // The unread divider is fixed at the moment the chat opens, like other messengers.
  const initialUnread = useRef(chat.unreadCount);
  const [firstUnread, setFirstUnread] = useState<{ id: string; count: number } | null | undefined>(undefined);
  useEffect(() => {
    if (firstUnread !== undefined || !query.data) return;
    const n = initialUnread.current;
    // Group events never count as unread (matches the server's count).
    const fromOthers = messages.filter((m) => m.senderId !== meId && m.type !== "system");
    const target = n > 0 ? (fromOthers.at(-n) ?? fromOthers[0]) : undefined;
    setFirstUnread(target ? { id: target.id, count: n } : null);
  }, [firstUnread, query.data, messages, meId]);

  const rows = useMemo(() => buildRows(messages, pending, meId, firstUnread ?? null), [messages, pending, meId, firstUnread]);

  // Open at the unread divider rather than the very bottom. scrollIntoView is unreliable in a
  // column-reverse scroller with content-visibility, so scroll by the measured offset instead.
  const scrolledToUnread = useRef(false);
  useLayoutEffect(() => {
    if (scrolledToUnread.current || !firstUnread) return;
    const scroller = scrollRef.current;
    const divider = document.getElementById("unread-divider");
    if (!scroller || !divider) return;
    scrolledToUnread.current = true;
    const box = scroller.getBoundingClientRect();
    const top = divider.getBoundingClientRect().top - box.top;
    // Already visible? Leave the view at the latest messages.
    if (top >= 0 && top < box.height) return;
    scroller.scrollBy({ top: top - box.height / 3 });
  }, [firstUnread]);

  // Mark as read while the chat is open and the window is in view.
  const newestFromOthers = useMemo(() => [...messages].reverse().find((m) => m.senderId !== meId && m.type !== "system")?.id, [messages, meId]);
  const lastMarked = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!newestFromOthers) return;
    const attempt = () => {
      if (document.visibilityState !== "visible" || (lastMarked.current && lastMarked.current >= newestFromOthers)) return;
      lastMarked.current = newestFromOthers;
      markChatRead(qc, chat.id, newestFromOthers).catch(() => (lastMarked.current = undefined));
    };
    const t = setTimeout(attempt, 250);
    document.addEventListener("visibilitychange", attempt);
    window.addEventListener("focus", attempt);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", attempt);
      window.removeEventListener("focus", attempt);
    };
  }, [newestFromOthers, chat.id, qc]);

  // Load older pages as the top comes into view. The column-reverse scroller keeps the
  // viewport anchored to the bottom, so prepending history doesn't make the view jump.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const el = topRef.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && !isFetchingNextPage && fetchNextPage(), {
      root: scrollRef.current,
      rootMargin: "600px 0px 0px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const scrollToBottom = useCallback((smooth = true) => {
    scrollRef.current?.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
    setNewWhileAway(0);
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = Math.abs(el.scrollTop) < 80;
    setAtBottom(bottom);
    if (bottom) setNewWhileAway(0);
  };

  // New message at the bottom: follow it if it's mine, otherwise count it if the user is reading history.
  const lastRow = rows.at(-1);
  const lastKey = lastRow?.key;
  const prevLastKey = useRef(lastKey);
  useEffect(() => {
    if (!lastKey || lastKey === prevLastKey.current) return;
    const hadPrevious = prevLastKey.current !== undefined;
    prevLastKey.current = lastKey;
    if (!hadPrevious || lastRow?.kind !== "message") return;
    if (lastRow.mine) scrollToBottom();
    else if (!atBottom) setNewWhileAway((n) => n + 1);
  }, [lastKey, lastRow, atBottom, scrollToBottom]);

  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return void toast("That message is further back — scroll up to load it.");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlighted(id);
    setTimeout(() => setHighlighted((h) => (h === id ? null : h)), 1600);
  }, []);

  // The pinned bar and search results ask for a particular message; the nonce makes
  // asking for the same one twice still scroll to it.
  useEffect(() => {
    if (jumpTarget) jumpTo(jumpTarget.id);
  }, [jumpTarget, jumpTo]);

  const onReact = useCallback((m: Message, emoji: string | null) => react.mutate({ message: m, emoji }), [react]);
  const onPin = useCallback((m: Message, pinned: boolean) => setPinned.mutate({ message: m, pinned }), [setPinned]);
  const onStar = useCallback((m: Message, starred: boolean) => setStarred.mutate({ message: m, starred }), [setStarred]);
  const onRetry = useCallback((p: PendingMessage) => void deliver(qc, p), [qc]);
  const onDiscard = useCallback((p: PendingMessage) => discardPending(p.clientId), []);

  // Arrow keys move between messages (one tab stop for the whole list).
  const onKeyDown = (e: KeyboardEvent) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    const target = e.target as HTMLElement;
    if (!target.matches("[data-msg-row]")) return;
    const all = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-msg-row]"));
    const i = all.indexOf(target);
    const next = e.key === "Home" ? all[0] : e.key === "End" ? all.at(-1) : all[i + (e.key === "ArrowUp" ? -1 : 1)];
    if (next) {
      e.preventDefault();
      target.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    }
  };

  if (query.isPending) return <ListSkeleton />;
  if (query.isError) return <ErrorState className="flex-1" title="Couldn't load messages" error={query.error} onRetry={() => query.refetch()} />;

  const lastMessageKey = [...rows].reverse().find((r) => r.kind === "message")?.key;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="scrollbar-thin flex min-h-0 flex-1 flex-col-reverse overflow-y-auto overscroll-contain">
        <div role="log" aria-label={`Messages with ${chat.name}`} aria-busy={isFetchingNextPage} onKeyDown={onKeyDown} className="flex flex-col pt-2 pb-3">
          <div ref={topRef} aria-hidden className="h-px" />
          {isFetchingNextPage && (
            <div className="flex justify-center py-3 text-muted">
              <Spinner label="Loading earlier messages" />
            </div>
          )}
          {!hasNextPage && <Intro chat={chat} />}

          {rows.map((row) => {
            if (row.kind === "day") {
              return (
                <div key={row.key} className="sticky top-2 z-[2] my-2 flex justify-center">
                  <span className="rounded-full bg-surface/90 px-3 py-1 text-xs font-medium text-muted shadow-bubble backdrop-blur">{row.label}</span>
                </div>
              );
            }
            if (row.kind === "unread") {
              return (
                <div key={row.key} id="unread-divider" className="my-3 flex items-center gap-3 px-6" role="separator">
                  <span className="h-px flex-1 bg-primary/30" />
                  <span className="text-xs font-semibold text-accent">
                    {row.count} unread message{row.count === 1 ? "" : "s"}
                  </span>
                  <span className="h-px flex-1 bg-primary/30" />
                </div>
              );
            }
            if (row.kind === "system") return <SystemRow key={row.key} message={row.message} meId={meId} nameOf={nameOf} />;
            const m = row.message;
            const sender = isGroup && !row.mine ? personOf(m.senderId) : undefined;
            return (
              <div key={row.key} className="[contain-intrinsic-size:auto_56px] [content-visibility:auto]">
                <MessageBubble
                  sender={sender && { id: m.senderId, ...sender }}
                  message={m}
                  pending={row.pending}
                  mine={row.mine}
                  first={row.first}
                  last={row.last}
                  status={row.pending ? row.pending.status : row.mine ? statusOf(m.id, receipts) : undefined}
                  meId={meId}
                  focusable={row.key === lastMessageKey}
                  highlighted={highlighted === m.id}
                  starred={starredIds.has(m.id)}
                  pinned={pinnedIds.has(m.id)}
                  canPin={canPin}
                  nameOf={nameOf}
                  mentionOf={mentionOf}
                  onReply={onReply}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onReact={onReact}
                  onJumpTo={jumpTo}
                  onRetry={onRetry}
                  onDiscard={onDiscard}
                  onForward={onForward}
                  onPin={onPin}
                  onStar={onStar}
                />
              </div>
            );
          })}
        </div>
      </div>

      {!atBottom && (
        <button
          onClick={() => scrollToBottom()}
          aria-label={newWhileAway ? `Jump to latest, ${newWhileAway} new` : "Jump to latest"}
          className="absolute right-4 bottom-4 grid size-11 animate-pop-in place-items-center rounded-full border border-border bg-surface text-muted shadow-pop hover:text-fg"
        >
          <ArrowDown className="size-5" />
          {newWhileAway > 0 && (
            <span className="absolute -top-1.5 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-fg">
              {newWhileAway}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
