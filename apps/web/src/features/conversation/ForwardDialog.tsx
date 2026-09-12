import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { MAX_FORWARD_TARGETS, summarizeMessage, type ChatSummary, type Message } from "@chat/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/States";
import { TextField } from "@/components/ui/TextField";
import { useChatList } from "@/features/chats/api";
import { useForward } from "@/features/messages/api";
import { cn } from "@/lib/cn";

/**
 * Picks the chats to forward a message into. The server re-checks membership and send
 * permission for every target, so this list is convenience, not authorization.
 */
export function ForwardDialog({ message, onClose }: { message: Message | null; onClose: () => void }) {
  const chats = useChatList(false, message !== null);
  const forward = useForward();
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const all = useMemo(() => chats.data?.pages.flatMap((p) => p.items) ?? [], [chats.data]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((c) => !q || c.name.toLowerCase().includes(q) || c.peer?.username.includes(q));
  }, [all, search]);

  const close = () => {
    onClose();
    setPicked([]);
    setSearch("");
  };

  const toggle = (chat: ChatSummary) =>
    setPicked((p) => (p.includes(chat.id) ? p.filter((id) => id !== chat.id) : p.length >= MAX_FORWARD_TARGETS ? p : [...p, chat.id]));

  return (
    <Dialog open={message !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent
        title="Forward to"
        description={message ? summarizeMessage(message) : undefined}
        className="sm:h-[min(620px,85dvh)]"
        bodyClassName="flex flex-col gap-3 px-3"
        footer={
          <Button
            disabled={!picked.length}
            loading={forward.isPending}
            onClick={() => message && forward.mutate({ message, chatIds: picked }, { onSuccess: close })}
          >
            Send{picked.length > 1 ? ` to ${picked.length}` : ""}
          </Button>
        }
      >
        <TextField
          label="Search chats"
          hideLabel
          type="search"
          placeholder="Search"
          leading={<Search />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          inputClassName="h-10 rounded-full border-transparent bg-surface-2 focus:bg-surface"
        />
        {picked.length >= MAX_FORWARD_TARGETS && (
          <p className="px-1 text-xs text-muted">You can forward to {MAX_FORWARD_TARGETS} chats at a time.</p>
        )}

        <div className="scrollbar-thin -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {chats.isPending ? (
            <div role="status" aria-label="Loading chats" className="flex flex-col gap-1">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 p-2">
                  <Skeleton className="size-10 rounded-full" />
                  <Skeleton className="h-3.5 w-2/5" />
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState title="No chats found" description={search ? `Nothing matches “${search.trim()}”.` : undefined} />
          ) : (
            <ul>
              {visible.map((chat) => {
                const selected = picked.includes(chat.id);
                return (
                  <li key={chat.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggle(chat)}
                      className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-surface-2"
                    >
                      <Avatar name={chat.name} src={chat.avatarUrl} seed={chat.peer?.id ?? chat.id} />
                      <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{chat.name}</span>
                      <span
                        className={cn(
                          "grid size-5 shrink-0 place-items-center rounded-full border-2",
                          selected ? "border-primary bg-primary text-primary-fg" : "border-border-strong",
                        )}
                      >
                        {selected && <Check className="size-3" strokeWidth={3} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
