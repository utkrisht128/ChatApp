import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FileKind, Message } from "@chat/shared";

export type PendingAttachment = {
  localId: string;
  kind: FileKind;
  name: string;
  size: number;
  mime: string;
  /** Object URL for instant previews (not persisted — it dies with the page). */
  previewUrl?: string;
  /** 0–1 upload progress. */
  progress: number;
  /** Set once uploaded, so a retry never uploads the same file twice. */
  fileId?: string;
  thumbFileId?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  waveform?: number[];
  placeholder?: string;
};

export type PendingMessage = {
  clientId: string;
  chatId: string;
  body: string;
  replyTo: Message["replyTo"];
  attachments: PendingAttachment[];
  createdAt: string;
  status: "sending" | "failed";
  /** Network/server trouble (retried automatically) vs. a rejection that needs the user. */
  retryable: boolean;
  error?: string;
};

/**
 * File bytes for pending attachments, keyed by localId. Kept in memory only — browsers
 * can't put Blobs in localStorage — so a reload before upload finishes loses them
 * (the message then asks to be re-sent rather than failing silently).
 */
export const pendingBlobs = new Map<string, Blob>();

type OutboxState = {
  items: PendingMessage[];
  add: (p: PendingMessage) => void;
  update: (clientId: string, patch: Partial<PendingMessage>) => void;
  updateAttachment: (clientId: string, localId: string, patch: Partial<PendingAttachment>) => void;
  remove: (clientId: string) => void;
  clearAll: () => void;
};

const revoke = (p: PendingMessage | undefined) =>
  p?.attachments.forEach((a) => {
    if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    pendingBlobs.delete(a.localId);
    pendingBlobs.delete(`${a.localId}:thumb`);
  });

/**
 * Messages that haven't been confirmed by the server yet. Persisted, so a message typed
 * just before the tab closed or the network dropped is retried rather than lost.
 */
export const useOutbox = create<OutboxState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (p) => set((s) => ({ items: [...s.items, p] })),
      update: (clientId, patch) => set((s) => ({ items: s.items.map((i) => (i.clientId === clientId ? { ...i, ...patch } : i)) })),
      updateAttachment: (clientId, localId, patch) =>
        set((s) => ({
          items: s.items.map((i) =>
            i.clientId === clientId ? { ...i, attachments: i.attachments.map((a) => (a.localId === localId ? { ...a, ...patch } : a)) } : i,
          ),
        })),
      remove: (clientId) => {
        const target = get().items.find((i) => i.clientId === clientId);
        if (!target) return;
        revoke(target);
        set((s) => ({ items: s.items.filter((i) => i.clientId !== clientId) }));
      },
      clearAll: () => {
        get().items.forEach(revoke);
        set({ items: [] });
      },
    }),
    {
      name: "chatapp-outbox",
      partialize: (s) => ({ items: s.items.map((i) => ({ ...i, attachments: i.attachments.map(({ previewUrl: _, ...a }) => a) })) }),
      // Anything that was mid-flight when the page closed is treated as failed-and-retryable.
      merge: (persisted, current) => ({
        ...current,
        items: ((persisted as Partial<OutboxState>)?.items ?? []).map((i) => ({
          ...i,
          attachments: i.attachments ?? [],
          ...(i.status === "sending" ? { status: "failed" as const, retryable: true } : {}),
        })),
      }),
    },
  ),
);
