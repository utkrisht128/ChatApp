import { useMemo } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ChatSummary, Page, UpdateMembershipInput } from "@chat/shared";
import { api, errorMessage } from "@/lib/api";

export const chatKeys = {
  lists: ["chats", "list"] as const,
  list: (archived: boolean) => ["chats", "list", archived] as const,
  detail: (id: string) => ["chats", "detail", id] as const,
};

export type ChatPages = InfiniteData<Page<ChatSummary>, string | null>;

export function useChatList(archived = false, enabled = true) {
  return useInfiniteQuery({
    queryKey: chatKeys.list(archived),
    queryFn: ({ pageParam, signal }) =>
      api<Page<ChatSummary>>(`/chats?archived=${archived}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

export function findCachedChat(qc: QueryClient, id: string) {
  for (const [, data] of qc.getQueriesData<ChatPages>({ queryKey: chatKeys.lists })) {
    for (const page of data?.pages ?? []) {
      const hit = page.items.find((c) => c.id === id);
      if (hit) return hit;
    }
  }
  return undefined;
}

export function useChat(id: string) {
  const qc = useQueryClient();
  return useQuery<ChatSummary>({
    queryKey: chatKeys.detail(id),
    queryFn: ({ signal }) => api<{ chat: ChatSummary }>(`/chats/${id}`, { signal }).then((r) => r.chat),
    // Render the header instantly from the chat list while the fresh copy loads.
    placeholderData: () => findCachedChat(qc, id),
  });
}

/** Applies an update to a chat wherever it's cached (detail + every list page). */
export function patchChatInCache(qc: QueryClient, id: string, update: (c: ChatSummary) => ChatSummary) {
  qc.setQueryData<ChatSummary>(chatKeys.detail(id), (old) => (old ? update(old) : old));
  qc.setQueriesData<ChatPages>({ queryKey: chatKeys.lists }, (data) =>
    data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((c) => (c.id === id ? update(c) : c)) })) } : data,
  );
}

export function useUpdateMembership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateMembershipInput }) =>
      api<{ chat: ChatSummary }>(`/chats/${id}/membership`, { method: "PATCH", body: patch }).then((r) => r.chat),
    onMutate: ({ id, patch }) =>
      patchChatInCache(qc, id, (c) => ({
        ...c,
        ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
        ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
        ...(patch.mutedUntil !== undefined ? { mutedUntil: patch.mutedUntil } : {}),
      })),
    onSuccess: (chat) => qc.setQueryData(chatKeys.detail(chat.id), chat),
    onError: (err) => toast.error(errorMessage(err)),
    // Re-fetch lists so pinned/archived chats move to the right place.
    onSettled: () => qc.invalidateQueries({ queryKey: chatKeys.lists }),
  });
}

export function useOpenDirectChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api<{ chat: ChatSummary }>("/chats/direct", { method: "POST", body: { userId } }).then((r) => r.chat),
    onSuccess: (chat) => {
      qc.setQueryData(chatKeys.detail(chat.id), chat);
      qc.invalidateQueries({ queryKey: chatKeys.lists });
    },
  });
}

/** Unread messages across non-muted chats (nav badge + tab title). */
export function useTotalUnread() {
  const { data } = useChatList(false);
  return useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.items).reduce((n, c) => n + (c.mutedUntil ? 0 : c.unreadCount), 0),
    [data],
  );
}

export const FOREVER = "9999-12-31T00:00:00.000Z";
export const MUTE_OPTIONS = [
  { id: "1h", label: "For 1 hour", ms: 3_600_000 },
  { id: "8h", label: "For 8 hours", ms: 8 * 3_600_000 },
  { id: "1w", label: "For 1 week", ms: 7 * 86_400_000 },
  { id: "always", label: "Always", ms: null },
] as const;
export const muteUntil = (ms: number | null) => (ms === null ? FOREVER : new Date(Date.now() + ms).toISOString());
