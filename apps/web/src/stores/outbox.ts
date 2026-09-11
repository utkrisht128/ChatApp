import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Message } from "@chat/shared";

export type PendingMessage = {
  clientId: string;
  chatId: string;
  body: string;
  replyTo: Message["replyTo"];
  createdAt: string;
  status: "sending" | "failed";
  /** Network/server trouble (retried automatically) vs. a rejection that needs the user. */
  retryable: boolean;
  error?: string;
};

type OutboxState = {
  items: PendingMessage[];
  add: (p: PendingMessage) => void;
  update: (clientId: string, patch: Partial<PendingMessage>) => void;
  remove: (clientId: string) => void;
  clearAll: () => void;
};

/**
 * Messages that haven't been confirmed by the server yet. Persisted, so a message typed
 * just before the tab closed or the network dropped is retried rather than lost.
 */
export const useOutbox = create<OutboxState>()(
  persist(
    (set) => ({
      items: [],
      add: (p) => set((s) => ({ items: [...s.items, p] })),
      update: (clientId, patch) => set((s) => ({ items: s.items.map((i) => (i.clientId === clientId ? { ...i, ...patch } : i)) })),
      remove: (clientId) => set((s) => (s.items.some((i) => i.clientId === clientId) ? { items: s.items.filter((i) => i.clientId !== clientId) } : s)),
      clearAll: () => set({ items: [] }),
    }),
    {
      name: "chatapp-outbox",
      // Anything that was mid-flight when the page closed is treated as failed-and-retryable.
      merge: (persisted, current) => ({
        ...current,
        items: ((persisted as Partial<OutboxState>)?.items ?? []).map((i) => (i.status === "sending" ? { ...i, status: "failed", retryable: true } : i)),
      }),
    },
  ),
);
