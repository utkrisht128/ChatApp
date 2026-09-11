import { useState } from "react";
import { Check, Search, UsersRound, X } from "lucide-react";
import type { PublicUser } from "@chat/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { TextField } from "@/components/ui/TextField";
import { useUserSearch } from "@/features/users/api";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn } from "@/lib/cn";

/** Multi-select people search: results toggle selection, chips show who's picked. */
export function UserPicker({
  selected,
  onChange,
  excludeIds = [],
  max,
}: {
  selected: PublicUser[];
  onChange: (users: PublicUser[]) => void;
  excludeIds?: string[];
  max?: number;
}) {
  const [query, setQuery] = useState("");
  const q = useDebouncedValue(query.trim(), 250);
  const search = useUserSearch(q);
  const picked = new Set(selected.map((u) => u.id));
  const results = (search.data ?? []).filter((u) => !excludeIds.includes(u.id));
  const full = max !== undefined && selected.length >= max;

  const toggle = (user: PublicUser) =>
    onChange(picked.has(user.id) ? selected.filter((u) => u.id !== user.id) : full ? selected : [...selected, user]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {selected.length > 0 && (
        <ul aria-label="Selected people" className="flex flex-wrap gap-1.5 px-2">
          {selected.map((u) => (
            <li key={u.id}>
              <button
                onClick={() => toggle(u)}
                aria-label={`Remove ${u.displayName}`}
                className="flex h-8 items-center gap-1.5 rounded-full bg-primary-soft py-0.5 pr-2 pl-0.5 text-sm font-medium text-accent hover:bg-primary-soft/70"
              >
                <Avatar name={u.displayName} src={u.avatarUrl} seed={u.id} size="xs" />
                {u.displayName}
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
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
      <div className="min-h-56 flex-1" aria-live="polite">
        {!q ? (
          <EmptyState icon={UsersRound} title="Find people to add" description="Search by name or @username." />
        ) : search.isPending ? (
          <div role="status" aria-label="Searching" className="flex flex-col gap-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2">
                <Skeleton className="size-10 rounded-full" />
                <Skeleton className="h-3.5 w-1/3" />
              </div>
            ))}
          </div>
        ) : search.isError ? (
          <ErrorState title="Search failed" error={search.error} onRetry={() => search.refetch()} />
        ) : results.length === 0 ? (
          <EmptyState icon={UsersRound} title="No one found" description={`Nobody matches “${q}”.`} />
        ) : (
          <ul aria-label="People" className="flex flex-col">
            {results.map((u) => {
              const on = picked.has(u.id);
              return (
                <li key={u.id}>
                  <button
                    role="checkbox"
                    aria-checked={on}
                    disabled={!on && full}
                    onClick={() => toggle(u)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-2 disabled:opacity-50"
                  >
                    <Avatar name={u.displayName} src={u.avatarUrl} seed={u.id} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{u.displayName}</span>
                      <span className="block truncate text-sm text-muted">@{u.username}</span>
                    </span>
                    <span
                      aria-hidden
                      className={cn("grid size-6 place-items-center rounded-full border-2", on ? "border-primary bg-primary text-primary-fg" : "border-border-strong")}
                    >
                      {on && <Check className="size-3.5" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
