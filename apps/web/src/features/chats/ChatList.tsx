import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowLeft, MessageCirclePlus, MoreVertical, Search, SearchX, Star, UsersRound } from "lucide-react";
import { useMatch } from "react-router";
import { ActionDropdown } from "@/components/ui/ActionMenu";
import { Button, IconButton } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { TextField } from "@/components/ui/TextField";
import { useCurrentUser } from "@/features/auth/api";
import { isSearchable, useDebounced } from "@/features/search/api";
import { cn } from "@/lib/cn";
import { useUi } from "@/stores/ui";
import { useChatList } from "./api";
import { ChatListItem } from "./ChatListItem";

// The search panel and these dialogs are only reachable once the user asks for them, and they
// pull in uploads, media handling and the message cache. Loading them on demand is most of what
// keeps first paint inside the bundle budget.
const SearchPanel = lazy(() => import("@/features/search/SearchPanel").then((m) => ({ default: m.SearchPanel })));
const StarredDialog = lazy(() => import("@/features/messages/StarredDialog").then((m) => ({ default: m.StarredDialog })));
const NewChatDialog = lazy(() => import("./NewChatDialog").then((m) => ({ default: m.NewChatDialog })));
const NewGroupDialog = lazy(() => import("@/features/groups/NewGroupDialog").then((m) => ({ default: m.NewGroupDialog })));

/** Mounts a lazy dialog on first open and keeps it mounted afterwards, so it still animates closed. */
function useLazyDialog() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  return {
    open,
    setOpen,
    mounted,
    show: () => {
      setMounted(true);
      setOpen(true);
    },
  };
}

type Filter = "all" | "unread" | "groups";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "groups", label: "Groups" },
];

export function ChatListSkeleton() {
  return (
    <div role="status" aria-label="Loading chats" className="flex flex-col gap-1 px-2">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="size-12 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChatList() {
  const me = useCurrentUser();
  const view = useUi((s) => s.chatListView);
  const setView = useUi((s) => s.setChatListView);
  const archivedView = view === "archived";
  const query = useChatList(archivedView);
  const archivedPreview = useChatList(true, !archivedView);
  const activeId = useMatch("/c/:chatId")?.params.chatId;

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const newChat = useLazyDialog();
  const newGroup = useLazyDialog();
  const starred = useLazyDialog();
  // Past two characters the search goes to the server (messages, people, files);
  // shorter queries just filter the chats already on screen.
  const debouncedSearch = useDebounced(search);
  const searchingEverywhere = isSearchable(debouncedSearch) && !archivedView;
  const searchRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Ctrl/Cmd+K focuses search from anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Infinite scroll.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(([entry]) => entry?.isIntersecting && !isFetchingNextPage && fetchNextPage(), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const chats = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/^@/, "");
    return chats.filter(
      (c) =>
        (!q || c.name.toLowerCase().includes(q) || c.peer?.username.includes(q)) &&
        (filter === "all" || (filter === "unread" ? c.unreadCount > 0 : c.type === "group")),
    );
  }, [chats, search, filter]);

  const archivedChats = archivedPreview.data?.pages[0]?.items ?? [];
  const archivedUnread = archivedChats.filter((c) => c.unreadCount > 0).length;
  const filtering = Boolean(search.trim()) || filter !== "all";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 pt-safe">
        <div className="flex h-14 items-center justify-between gap-2 px-4">
          {archivedView ? (
            <div className="flex items-center gap-1">
              <IconButton label="Back to chats" className="-ml-2" onClick={() => setView("all")}>
                <ArrowLeft />
              </IconButton>
              <h1 className="text-xl font-bold">Archived</h1>
            </div>
          ) : (
            <h1 className="text-2xl font-bold tracking-tight">Chats</h1>
          )}
          <div className="flex items-center">
            <IconButton label="New chat" onClick={newChat.show}>
              <MessageCirclePlus />
            </IconButton>
            <ActionDropdown
              actions={[
                { id: "group", label: "New group", icon: UsersRound, onSelect: newGroup.show },
                { id: "starred", label: "Starred messages", icon: Star, onSelect: starred.show },
                { id: "archived", label: "Archived chats", icon: Archive, onSelect: () => setView("archived"), hidden: archivedView },
              ]}
            >
              <IconButton label="More options" className="-mr-2">
                <MoreVertical />
              </IconButton>
            </ActionDropdown>
          </div>
        </div>
        <div className="px-4 pb-2">
          <TextField
            ref={searchRef}
            label="Search chats"
            hideLabel
            type="search"
            placeholder="Search"
            leading={<Search />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setSearch("")}
            inputClassName="h-10 rounded-full border-transparent bg-surface-2 focus:bg-surface"
          />
        </div>
        {!archivedView && !searchingEverywhere && (
          <div role="group" aria-label="Filter chats" className="flex gap-2 overflow-x-auto px-4 pb-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "h-8 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors",
                  filter === f.id ? "bg-primary-soft text-accent" : "bg-surface-2 text-muted hover:text-fg",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </header>

      {searchingEverywhere ? (
        <Suspense fallback={<ChatListSkeleton />}>
          <SearchPanel query={debouncedSearch.trim()} meId={me.id} onClose={() => setSearch("")} />
        </Suspense>
      ) : (
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-2">
        {!archivedView && !filtering && archivedChats.length > 0 && (
          <button onClick={() => setView("archived")} className="mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-2">
            <span className="grid size-12 place-items-center rounded-full bg-surface-2 text-muted">
              <Archive className="size-5" />
            </span>
            <span className="flex-1 font-semibold">Archived</span>
            {archivedUnread > 0 && <span className="text-sm font-semibold text-accent">{archivedUnread}</span>}
          </button>
        )}

        {query.isPending ? (
          <ChatListSkeleton />
        ) : query.isError ? (
          <ErrorState title="Couldn't load your chats" error={query.error} onRetry={() => query.refetch()} />
        ) : chats.length === 0 ? (
          archivedView ? (
            <EmptyState icon={Archive} title="No archived chats" description="Archive a chat to tuck it away without deleting it." />
          ) : (
            <EmptyState
              icon={MessageCirclePlus}
              title="No conversations yet"
              description="Start a conversation with someone to see it here."
              action={<Button onClick={newChat.show}>Start a conversation</Button>}
            />
          )
        ) : visible.length === 0 ? (
          <EmptyState icon={SearchX} title="No matches" description={search ? `No chats match “${search.trim()}”.` : "No chats in this filter."} />
        ) : (
          <ul aria-label={archivedView ? "Archived chats" : "Chats"} className="flex flex-col">
            {visible.map((chat) => (
              <li key={chat.id}>
                <ChatListItem chat={chat} active={chat.id === activeId} meId={me.id} />
              </li>
            ))}
          </ul>
        )}

        <div ref={sentinelRef} aria-hidden />
        {isFetchingNextPage && (
          <div className="flex justify-center py-3 text-muted">
            <Spinner label="Loading more chats" />
          </div>
        )}
      </div>
      )}

      <Suspense fallback={null}>
        {starred.mounted && <StarredDialog open={starred.open} onOpenChange={starred.setOpen} />}
        {newChat.mounted && (
          <NewChatDialog
            open={newChat.open}
            onOpenChange={newChat.setOpen}
            onNewGroup={() => {
              newChat.setOpen(false);
              newGroup.show();
            }}
          />
        )}
        {newGroup.mounted && <NewGroupDialog open={newGroup.open} onOpenChange={newGroup.setOpen} />}
      </Suspense>
    </div>
  );
}
