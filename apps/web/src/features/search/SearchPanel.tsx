import { Fragment, useMemo, useState } from "react";
import { FileText, MessageSquareText, SearchX, UsersRound } from "lucide-react";
import { useNavigate } from "react-router";
import {
  attachmentIcon,
  formatBytes,
  highlightParts,
  snippet,
  type ChatSummary,
  type FileHit,
  type MessageHit,
  type PublicUser,
  type SearchType,
} from "@chat/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { ChatListItem } from "@/features/chats/ChatListItem";
import { useOpenDirectChat } from "@/features/chats/api";
import { cn } from "@/lib/cn";
import { formatChatTime } from "@/lib/format";
import { useSearch } from "./api";

const TABS: { id: SearchType; label: string }[] = [
  { id: "messages", label: "Messages" },
  { id: "chats", label: "Chats" },
  { id: "users", label: "People" },
  { id: "files", label: "Files" },
];

/** Query words shown in bold inside a result. */
function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map(([part, hit], i) =>
        hit ? (
          <mark key={i} className="bg-transparent font-semibold text-accent">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function ResultRow({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-surface-2">
        {children}
      </button>
    </li>
  );
}

function MessageRow({ hit, query, onOpen }: { hit: MessageHit; query: string; onOpen: (chatId: string, messageId: string) => void }) {
  const { message, chat } = hit;
  return (
    <ResultRow onClick={() => onOpen(chat.id, message.id)}>
      <Avatar name={chat.name} src={chat.avatarUrl} seed={chat.id} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[15px] font-medium">{chat.name}</span>
          <time dateTime={message.createdAt} className="shrink-0 text-xs text-subtle">
            {formatChatTime(message.createdAt)}
          </time>
        </span>
        <span className="mt-0.5 block truncate text-sm text-muted">
          <Highlight text={snippet(message.body, query)} query={query} />
        </span>
      </span>
    </ResultRow>
  );
}

function FileRow({ hit, query, onOpen }: { hit: FileHit; query: string; onOpen: (chatId: string, messageId: string) => void }) {
  const { attachment: a, chat } = hit;
  return (
    <ResultRow onClick={() => onOpen(chat.id, hit.messageId)}>
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-lg" aria-hidden>
        {a.thumbUrl || a.kind === "image" ? (
          <img src={a.thumbUrl ?? a.url} alt="" className="size-11 rounded-xl object-cover" loading="lazy" />
        ) : (
          attachmentIcon(a.kind)
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">
          <Highlight text={a.name} query={query} />
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted">
          {chat.name} · {formatBytes(a.size)} · {formatChatTime(hit.createdAt)}
        </span>
      </span>
    </ResultRow>
  );
}

function UserRow({ user, query, onOpen }: { user: PublicUser; query: string; onOpen: (userId: string) => void }) {
  return (
    <ResultRow onClick={() => onOpen(user.id)}>
      <Avatar name={user.displayName} src={user.avatarUrl} seed={user.id} online={user.online} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">
          <Highlight text={user.displayName} query={query} />
        </span>
        <span className="mt-0.5 block truncate text-sm text-muted">
          @<Highlight text={user.username} query={query} />
        </span>
      </span>
    </ResultRow>
  );
}

function Results({ type, query, meId, onClose }: { type: SearchType; query: string; meId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const openDirect = useOpenDirectChat();
  const search = useSearch(type, query);
  const items = useMemo(() => search.data?.pages.flatMap((p) => p.items) ?? [], [search.data]);

  // Jumping to a message inside a chat: the conversation reads the hash and scrolls to it.
  const openMessage = (chatId: string, messageId: string) => {
    onClose();
    navigate(`/c/${chatId}#msg-${messageId}`);
  };
  const openUser = (userId: string) =>
    openDirect.mutate(userId, {
      onSuccess: (chat) => {
        onClose();
        navigate(`/c/${chat.id}`);
      },
    });

  if (search.isPending) {
    return (
      <div role="status" aria-label="Searching" className="flex flex-col gap-1 p-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-2 py-2">
            <Skeleton className="size-11 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (search.isError) return <ErrorState title="Couldn't search" error={search.error} onRetry={() => search.refetch()} />;
  if (!items.length) {
    const icon = type === "users" ? UsersRound : type === "files" ? FileText : type === "messages" ? MessageSquareText : SearchX;
    return <EmptyState icon={icon} title="No matches" description={`Nothing in ${TABS.find((t) => t.id === type)?.label.toLowerCase()} matches “${query}”.`} />;
  }

  return (
    <>
      <ul aria-label={`${type} results`} className="flex flex-col">
        {items.map((item, i) => {
          if (type === "chats") {
            const chat = item as ChatSummary;
            return (
              <li key={chat.id} onClick={onClose}>
                <ChatListItem chat={chat} active={false} meId={meId} />
              </li>
            );
          }
          if (type === "users") {
            const user = item as PublicUser;
            return <UserRow key={user.id} user={user} query={query} onOpen={openUser} />;
          }
          if (type === "files") {
            const hit = item as FileHit;
            return <FileRow key={`${hit.messageId}-${hit.attachment.id}-${i}`} hit={hit} query={query} onOpen={openMessage} />;
          }
          const hit = item as MessageHit;
          return <MessageRow key={hit.message.id} hit={hit} query={query} onOpen={openMessage} />;
        })}
      </ul>
      {search.hasNextPage && (
        <div className="flex justify-center py-3">
          <button onClick={() => search.fetchNextPage()} disabled={search.isFetchingNextPage} className="text-sm font-semibold text-accent hover:underline">
            {search.isFetchingNextPage ? <Spinner label="Loading more results" /> : "Show more"}
          </button>
        </div>
      )}
    </>
  );
}

/** Search results shown in place of the chat list while a query is active. */
export function SearchPanel({ query, meId, onClose }: { query: string; meId: string; onClose: () => void }) {
  const [tab, setTab] = useState<SearchType>("messages");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Search results" className="flex shrink-0 gap-2 overflow-x-auto px-4 pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "h-8 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors",
              tab === t.id ? "bg-primary-soft text-accent" : "bg-surface-2 text-muted hover:text-fg",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-2">
        <Results key={tab} type={tab} query={query} meId={meId} onClose={onClose} />
      </div>
    </div>
  );
}
