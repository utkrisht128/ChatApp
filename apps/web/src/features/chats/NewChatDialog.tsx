import { useState } from "react";
import { Search, UserRoundSearch, UsersRound } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { PublicUser } from "@chat/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { TextField } from "@/components/ui/TextField";
import { useUserSearch } from "@/features/users/api";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { errorMessage } from "@/lib/api";
import { useUi } from "@/stores/ui";
import { useOpenDirectChat } from "./api";

export function NewChatDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  const q = useDebouncedValue(query.trim(), 250);
  const search = useUserSearch(q);
  const openChat = useOpenDirectChat();
  const navigate = useNavigate();
  const setView = useUi((s) => s.setChatListView);
  const [pendingId, setPendingId] = useState<string>();

  const start = (user: PublicUser) => {
    setPendingId(user.id);
    openChat.mutate(user.id, {
      onSuccess: (chat) => {
        onOpenChange(false);
        setQuery("");
        setView("all");
        navigate(`/c/${chat.id}`);
      },
      onError: (err) => toast.error(errorMessage(err)),
      onSettled: () => setPendingId(undefined),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="New chat" description="Find people by name or username." className="sm:h-[min(560px,80dvh)]" bodyClassName="flex flex-col gap-3 px-3">
        <div className="px-2">
          <TextField
            label="Search people"
            hideLabel
            type="search"
            autoFocus
            placeholder="Name or @username"
            leading={<Search />}
            autoCapitalize="none"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="min-h-64 flex-1" aria-live="polite">
          {!q ? (
            <EmptyState icon={UserRoundSearch} title="Who do you want to talk to?" description="Search by their name or @username." />
          ) : search.isPending ? (
            <div role="status" aria-label="Searching" className="flex flex-col gap-1">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className="h-3.5 w-1/3" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : search.isError ? (
            <ErrorState title="Search failed" error={search.error} onRetry={() => search.refetch()} />
          ) : search.data.length === 0 ? (
            <EmptyState icon={UsersRound} title="No one found" description={`Nobody matches “${q}”. Check the spelling or try their username.`} />
          ) : (
            <ul aria-label="People" className="flex flex-col">
              {search.data.map((user) => (
                <li key={user.id}>
                  <button
                    onClick={() => start(user)}
                    disabled={openChat.isPending}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-2 disabled:opacity-60"
                  >
                    <Avatar name={user.displayName} src={user.avatarUrl} seed={user.id} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{user.displayName}</span>
                      <span className="block truncate text-sm text-muted">@{user.username}</span>
                    </span>
                    {pendingId === user.id && <Spinner className="size-4 text-muted" label="Opening chat" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
