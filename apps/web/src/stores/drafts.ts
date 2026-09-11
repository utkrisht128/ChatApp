import { create } from "zustand";
import { persist } from "zustand/middleware";

type DraftState = {
  drafts: Record<string, string>;
  setDraft: (chatId: string, text: string) => void;
  clearAll: () => void;
};

/** Unsent composer text per chat. Survives reloads; wiped on logout. */
export const useDrafts = create<DraftState>()(
  persist(
    (set) => ({
      drafts: {},
      setDraft: (chatId, text) =>
        set((s) => {
          const drafts = { ...s.drafts };
          if (text) drafts[chatId] = text;
          else delete drafts[chatId];
          return { drafts };
        }),
      clearAll: () => set({ drafts: {} }),
    }),
    { name: "chatapp-drafts" },
  ),
);
