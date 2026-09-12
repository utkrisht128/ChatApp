import { useMemo } from "react";
import { Star, StarOff } from "lucide-react";
import { useNavigate } from "react-router";
import { summarizeMessage } from "@chat/shared";
import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/Button";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { useChatList } from "@/features/chats/api";
import { formatChatTime } from "@/lib/format";
import { useSetStarred, useStarred } from "./api";

/** Your starred messages across every chat. Private to you. */
export function StarredDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const starred = useStarred(open);
  const chats = useChatList(false, open);
  const setStarred = useSetStarred();

  const chatById = useMemo(
    () => new Map((chats.data?.pages.flatMap((p) => p.items) ?? []).map((c) => [c.id, c])),
    [chats.data],
  );

  const messages = starred.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Starred messages" className="sm:h-[min(620px,85dvh)]" bodyClassName="px-2">
        {starred.isPending ? (
          <div role="status" aria-label="Loading starred messages" className="flex flex-col gap-1">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 p-2">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </div>
            ))}
          </div>
        ) : starred.isError ? (
          <ErrorState title="Couldn't load starred messages" error={starred.error} onRetry={() => starred.refetch()} />
        ) : messages.length === 0 ? (
          <EmptyState
            icon={Star}
            title="Nothing starred yet"
            description="Star a message to keep it here — handy for addresses, links and anything you'll need again."
          />
        ) : (
          <ul className="flex flex-col">
            {messages.map((m) => {
              const chat = chatById.get(m.chatId);
              return (
                <li key={m.id} className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      onOpenChange(false);
                      navigate(`/c/${m.chatId}#msg-${m.id}`);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left hover:bg-surface-2"
                  >
                    <Avatar name={chat?.name ?? "Chat"} src={chat?.avatarUrl ?? null} seed={chat?.peer?.id ?? m.chatId} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[15px] font-medium">{chat?.name ?? "Chat"}</span>
                        <time dateTime={m.createdAt} className="shrink-0 text-xs text-subtle">
                          {formatChatTime(m.createdAt)}
                        </time>
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-muted">{summarizeMessage(m)}</span>
                    </span>
                  </button>
                  <IconButton label="Remove star" size="sm" onClick={() => setStarred.mutate({ message: m, starred: false })}>
                    <StarOff />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
