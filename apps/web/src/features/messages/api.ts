import { useCallback } from "react";
import { skipToken, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { messagePreview, type Message, type MessagePage, type Receipt } from "@chat/shared";
import { patchChatInCache } from "@/features/chats/api";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useOutbox, type PendingMessage } from "@/stores/outbox";
import { messageKeys, removeMessage, replaceMessage, upsertMessage, type MessagePages } from "./cache";

export function useMessages(chatId: string) {
  const qc = useQueryClient();
  return useInfiniteQuery({
    queryKey: messageKeys.list(chatId),
    queryFn: async ({ pageParam, signal }) => {
      const page = await api<MessagePage>(`/chats/${chatId}/messages${pageParam ? `?before=${pageParam}` : ""}`, { signal });
      if (page.receipts) qc.setQueryData(messageKeys.receipts(chatId), page.receipts);
      return page;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // Kept fresh by the socket; refetched after a reconnect.
    staleTime: Infinity,
  });
}

/** Receipts are written by useMessages and socket events; this only reads the cache. */
export const useReceipts = (chatId: string) => useQuery<Receipt[]>({ queryKey: messageKeys.receipts(chatId), queryFn: skipToken }).data ?? [];

export const flattenMessages = (data: Pick<MessagePages, "pages"> | undefined) => (data ? [...data.pages].reverse().flatMap((p) => p.items) : []);

/* ── Sending ────────────────────────────────────────────────────────────── */

// Sends within a chat go out one at a time, so messages can't overtake each other.
const chains = new Map<string, Promise<void>>();
function enqueue(chatId: string, task: () => Promise<void>) {
  const next = (chains.get(chatId) ?? Promise.resolve()).then(task, task);
  chains.set(chatId, next);
  return next;
}

export function deliver(qc: QueryClient, p: PendingMessage) {
  useOutbox.getState().update(p.clientId, { status: "sending", error: undefined });
  return enqueue(p.chatId, async () => {
    try {
      const { message } = await api<{ message: Message }>(`/chats/${p.chatId}/messages`, {
        method: "POST",
        body: { clientId: p.clientId, body: p.body, ...(p.replyTo ? { replyToId: p.replyTo.id } : {}) },
      });
      upsertMessage(qc, message);
    } catch (err) {
      const retryable = !(err instanceof ApiError) || err.status === 0 || err.status >= 500 || err.status === 429;
      useOutbox.getState().update(p.clientId, { status: "failed", retryable, error: retryable ? undefined : errorMessage(err) });
    }
  });
}

/** Retries everything that failed for transient reasons (called on reconnect / back online). */
export function retryFailed(qc: QueryClient) {
  for (const p of useOutbox.getState().items) if (p.status === "failed" && p.retryable) void deliver(qc, p);
}

export function useSendMessage(chatId: string) {
  const qc = useQueryClient();
  return useCallback(
    (body: string, replyTo: Message | null) => {
      const pending: PendingMessage = {
        clientId: crypto.randomUUID(),
        chatId,
        body,
        replyTo: replyTo ? { id: replyTo.id, senderId: replyTo.senderId, preview: messagePreview(replyTo.body) } : null,
        createdAt: new Date().toISOString(),
        status: "sending",
        retryable: true,
      };
      useOutbox.getState().add(pending);
      void deliver(qc, pending);
    },
    [chatId, qc],
  );
}

/* ── Editing, deleting, reacting ────────────────────────────────────────── */

function findMessage(qc: QueryClient, chatId: string, id: string) {
  return flattenMessages(qc.getQueryData<MessagePages>(messageKeys.list(chatId))).find((m) => m.id === id);
}

export function useEditMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ message, body }: { message: Message; body: string }) =>
      api<{ message: Message }>(`/messages/${message.id}`, { method: "PATCH", body: { body } }).then((r) => r.message),
    onMutate: ({ message, body }) => replaceMessage(qc, { ...message, body, editedAt: new Date().toISOString() }),
    onSuccess: (message) => replaceMessage(qc, message),
    onError: (err, { message }) => {
      replaceMessage(qc, message);
      toast.error("Couldn't edit message", { description: errorMessage(err) });
    },
  });
}

export function useDeleteMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ message, scope }: { message: Message; scope: "me" | "everyone" }) =>
      api<void>(`/messages/${message.id}?scope=${scope}`, { method: "DELETE" }),
    onMutate: ({ message, scope }) => {
      if (scope === "me") removeMessage(qc, message.chatId, message.id);
      else replaceMessage(qc, { ...message, body: "", reactions: [], deletedAt: new Date().toISOString() });
    },
    onError: (err, { message }) => {
      void qc.invalidateQueries({ queryKey: messageKeys.list(message.chatId) });
      toast.error("Couldn't delete message", { description: errorMessage(err) });
    },
  });
}

export function useReact(meId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ message, emoji }: { message: Message; emoji: string | null }) =>
      api<{ message: Message }>(`/messages/${message.id}/reaction`, { method: "PUT", body: { emoji } }).then((r) => r.message),
    onMutate: ({ message, emoji }) => {
      const current = findMessage(qc, message.chatId, message.id) ?? message;
      const without = current.reactions.map((r) => ({ ...r, userIds: r.userIds.filter((id) => id !== meId) })).filter((r) => r.userIds.length);
      const reactions = emoji
        ? without.some((r) => r.emoji === emoji)
          ? without.map((r) => (r.emoji === emoji ? { ...r, userIds: [...r.userIds, meId] } : r))
          : [...without, { emoji, userIds: [meId] }]
        : without;
      replaceMessage(qc, { ...current, reactions });
      return { previous: current };
    },
    onSuccess: (message) => replaceMessage(qc, message),
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) replaceMessage(qc, ctx.previous);
      toast.error(errorMessage(err));
    },
  });
}

export function markChatRead(qc: QueryClient, chatId: string, messageId: string) {
  patchChatInCache(qc, chatId, (c) => ({ ...c, unreadCount: 0, mentionCount: 0 }));
  return api<{ unreadCount: number }>(`/chats/${chatId}/read`, { method: "POST", body: { messageId } });
}
