import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { PublicUser } from "@chat/shared";
import { api } from "@/lib/api";

export function useUserSearch(q: string) {
  return useQuery<PublicUser[]>({
    queryKey: ["users", "search", q],
    queryFn: ({ signal }) => api<{ items: PublicUser[] }>(`/users/search?q=${encodeURIComponent(q)}`, { signal }).then((r) => r.items),
    enabled: q.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
