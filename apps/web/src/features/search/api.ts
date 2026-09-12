import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { MIN_SEARCH_LENGTH, type ChatSummary, type FileHit, type MessageHit, type Page, type PublicUser, type SearchType } from "@chat/shared";
import { api } from "@/lib/api";

export const searchKeys = {
  all: ["search"] as const,
  query: (type: SearchType, q: string, chatId?: string) => ["search", type, q, chatId ?? null] as const,
};

/** Result shape per tab. */
export type ResultOf = {
  messages: MessageHit;
  files: FileHit;
  chats: ChatSummary;
  users: PublicUser;
};

/** Waits for typing to settle before firing a request. */
export function useDebounced<T>(value: T, ms = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

export const isSearchable = (q: string) => q.trim().length >= MIN_SEARCH_LENGTH;

export function useSearch<T extends SearchType>(type: T, q: string, chatId?: string) {
  const query = q.trim();
  return useInfiniteQuery({
    queryKey: searchKeys.query(type, query, chatId),
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ q: query, type });
      if (chatId) params.set("chatId", chatId);
      if (pageParam) params.set("cursor", pageParam);
      return api<Page<ResultOf[T]>>(`/search?${params}`, { signal });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: isSearchable(query),
    // Results go stale quickly as people keep chatting, but re-running the same
    // search while flicking between tabs shouldn't refetch.
    staleTime: 30_000,
  });
}
