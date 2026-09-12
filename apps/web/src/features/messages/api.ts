import { useCallback, useMemo } from "react";
import { skipToken, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DEFAULT_MAX_UPLOAD_BYTES, summarizeMessage, type FileKind, type Message, type MessagePage, type Receipt } from "@chat/shared";
import { chatKeys, patchChatInCache } from "@/features/chats/api";
import { api, ApiError, errorMessage } from "@/lib/api";
import { mediaDuration, prepareImage, prepareVideo } from "@/lib/media";
import { uploadBlob } from "@/lib/upload";
import { pendingBlobs, useOutbox, type PendingAttachment, type PendingMessage } from "@/stores/outbox";
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

class LostAttachmentError extends Error {}
const aborts = new Map<string, AbortController>();

/** Prepares (compress / poster) and uploads one attachment, recording progress in the outbox. */
async function uploadAttachment(p: PendingMessage, a: PendingAttachment, signal: AbortSignal): Promise<PendingAttachment> {
  if (a.fileId) return a;
  const blob = pendingBlobs.get(a.localId);
  if (!blob) throw new LostAttachmentError();
  const outbox = useOutbox.getState();
  let meta: Partial<PendingAttachment> = {};
  let body: Blob = blob;

  if (a.kind === "image" && blob instanceof File) {
    const prepared = await prepareImage(blob).catch(() => null);
    if (prepared) {
      body = prepared.blob;
      meta = { width: prepared.width, height: prepared.height, placeholder: prepared.placeholder };
    }
  } else if (a.kind === "video" && blob instanceof File) {
    const v = await prepareVideo(blob);
    meta = { width: v.width, height: v.height, durationMs: v.durationMs, placeholder: v.placeholder };
    if (v.poster) {
      const thumb = await uploadBlob(v.poster, { purpose: "thumb", kind: "image", chatId: p.chatId, name: "poster.jpg" }, { signal });
      meta.thumbFileId = thumb.id;
    }
  } else if (a.kind === "audio" && a.durationMs === undefined) {
    meta = { durationMs: await mediaDuration(blob) };
  }
  if (body.size > DEFAULT_MAX_UPLOAD_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", `“${a.name}” is larger than 8 MB.`);

  let last = 0;
  const file = await uploadBlob(body, { purpose: "attachment", kind: a.kind, chatId: p.chatId, name: a.name }, {
    signal,
    onProgress: (f) => {
      if (f - last >= 0.04 || f === 1) outbox.updateAttachment(p.clientId, a.localId, { progress: (last = f) });
    },
  });
  const done = { ...meta, fileId: file.id, progress: 1 };
  outbox.updateAttachment(p.clientId, a.localId, done);
  return { ...a, ...done };
}

export function deliver(qc: QueryClient, p: PendingMessage) {
  useOutbox.getState().update(p.clientId, { status: "sending", error: undefined });
  return enqueue(p.chatId, async () => {
    const current = useOutbox.getState().items.find((i) => i.clientId === p.clientId);
    if (!current) return; // discarded while queued
    const controller = new AbortController();
    aborts.set(p.clientId, controller);
    try {
      const uploaded = [];
      for (const a of current.attachments) uploaded.push(await uploadAttachment(current, a, controller.signal));
      const { message } = await api<{ message: Message }>(`/chats/${p.chatId}/messages`, {
        method: "POST",
        body: {
          clientId: p.clientId,
          body: current.body,
          ...(current.replyTo ? { replyToId: current.replyTo.id } : {}),
          attachments: uploaded.map((a) => ({
            fileId: a.fileId!,
            ...(a.width ? { width: a.width } : {}),
            ...(a.height ? { height: a.height } : {}),
            ...(a.durationMs !== undefined ? { durationMs: a.durationMs } : {}),
            ...(a.waveform?.length ? { waveform: a.waveform } : {}),
            ...(a.placeholder ? { placeholder: a.placeholder } : {}),
            ...(a.thumbFileId ? { thumbFileId: a.thumbFileId } : {}),
          })),
        },
      });
      upsertMessage(qc, message);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof LostAttachmentError) {
        return useOutbox.getState().update(p.clientId, { status: "failed", retryable: false, error: "The attachment was lost when the page closed. Please send it again." });
      }
      const retryable = !(err instanceof ApiError) || err.status === 0 || err.status >= 500 || err.status === 429;
      useOutbox.getState().update(p.clientId, { status: "failed", retryable, error: retryable ? undefined : errorMessage(err) });
    } finally {
      aborts.delete(p.clientId);
    }
  });
}

/** Stops an in-flight upload and forgets the message. */
export function discardPending(clientId: string) {
  aborts.get(clientId)?.abort();
  useOutbox.getState().remove(clientId);
}

/** Retries everything that failed for transient reasons (called on reconnect / back online). */
export function retryFailed(qc: QueryClient) {
  for (const p of useOutbox.getState().items) if (p.status === "failed" && p.retryable) void deliver(qc, p);
}

export type OutgoingFile = { file: File | Blob; kind: FileKind; name: string; durationMs?: number; waveform?: number[] };

export function useSendMessage(chatId: string) {
  const qc = useQueryClient();
  return useCallback(
    (body: string, replyTo: Message | null, files: OutgoingFile[] = []) => {
      const attachments: PendingAttachment[] = files.map((f) => {
        const localId = crypto.randomUUID();
        pendingBlobs.set(localId, f.file);
        return {
          localId,
          kind: f.kind,
          name: f.name,
          size: f.file.size,
          mime: f.file.type,
          previewUrl: f.kind === "image" || f.kind === "video" || f.kind === "voice" || f.kind === "audio" ? URL.createObjectURL(f.file) : undefined,
          progress: 0,
          durationMs: f.durationMs,
          waveform: f.waveform,
        };
      });
      const pending: PendingMessage = {
        clientId: crypto.randomUUID(),
        chatId,
        body,
        replyTo: replyTo ? { id: replyTo.id, senderId: replyTo.senderId, preview: summarizeMessage(replyTo) } : null,
        attachments,
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

/* ── Forwarding, pinning, starring ──────────────────────────────────────── */

export function useForward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ message, chatIds }: { message: Message; chatIds: string[] }) =>
      api<{ messages: Message[] }>(`/messages/${message.id}/forward`, {
        method: "POST",
        // One clientId per target, so a retry can't send the same forward twice.
        body: { targets: chatIds.map((chatId) => ({ chatId, clientId: crypto.randomUUID() })) },
      }).then((r) => r.messages),
    onSuccess: (sent) => {
      for (const m of sent) upsertMessage(qc, m);
      void qc.invalidateQueries({ queryKey: chatKeys.lists });
      toast.success(sent.length > 1 ? `Forwarded to ${sent.length} chats` : "Forwarded");
    },
    onError: (err) => toast.error("Couldn't forward", { description: errorMessage(err) }),
  });
}

/** The chat's pinned messages (shared by everyone in it). */
export const usePinned = (chatId: string) =>
  useQuery({
    queryKey: messageKeys.pinned(chatId),
    queryFn: ({ signal }) => api<{ messages: Message[] }>(`/chats/${chatId}/pinned`, { signal }).then((r) => r.messages),
    staleTime: 60_000,
  });

export function useSetPinned(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ message, pinned }: { message: Message; pinned: boolean }) =>
      api<{ messages: Message[] }>(`/messages/${message.id}/pinned`, { method: "PUT", body: { pinned } }).then((r) => r.messages),
    onSuccess: (messages, { pinned }) => {
      qc.setQueryData(messageKeys.pinned(chatId), messages);
      toast.success(pinned ? "Pinned" : "Unpinned");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

/** Everything you starred, newest first. Private to you. */
export const useStarred = (enabled = true) =>
  useQuery({
    queryKey: messageKeys.starred,
    queryFn: ({ signal }) => api<{ messages: Message[] }>("/messages/starred", { signal }).then((r) => r.messages),
    enabled,
    staleTime: 30_000,
  });

/** Ids of your starred messages, for the star marker on a bubble. */
export function useStarredIds() {
  const { data } = useStarred();
  return useMemo(() => new Set((data ?? []).map((m) => m.id)), [data]);
}

export function useSetStarred() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ message, starred }: { message: Message; starred: boolean }) =>
      api<void>(`/messages/${message.id}/starred`, { method: "PUT", body: { starred } }),
    onMutate: ({ message, starred }) => {
      const previous = qc.getQueryData<Message[]>(messageKeys.starred);
      qc.setQueryData<Message[]>(messageKeys.starred, (old = []) =>
        starred ? [message, ...old.filter((m) => m.id !== message.id)] : old.filter((m) => m.id !== message.id),
      );
      return { previous };
    },
    onSuccess: (_r, { starred }) => toast.success(starred ? "Starred" : "Removed from starred"),
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(messageKeys.starred, ctx.previous);
      toast.error(errorMessage(err));
    },
  });
}

export function markChatRead(qc: QueryClient, chatId: string, messageId: string) {
  patchChatInCache(qc, chatId, (c) => ({ ...c, unreadCount: 0, mentionCount: 0 }));
  return api<{ unreadCount: number }>(`/chats/${chatId}/read`, { method: "POST", body: { messageId } });
}
