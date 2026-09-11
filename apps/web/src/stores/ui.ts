import { create } from "zustand";
import { persist } from "zustand/middleware";

export const LIST_WIDTH = { min: 280, max: 480, default: 360 };

type UiState = {
  /** Chat list pane width on large screens (resizable). */
  listWidth: number;
  /** Chat details panel (inline on wide screens, slide-over otherwise). */
  detailsOpen: boolean;
  chatListView: "all" | "archived";
  /** The conversation currently on screen — incoming messages there don't count as unread. */
  activeChatId: string | null;
  setListWidth: (w: number) => void;
  setDetailsOpen: (open: boolean) => void;
  setChatListView: (view: "all" | "archived") => void;
  setActiveChatId: (id: string | null) => void;
};

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      listWidth: LIST_WIDTH.default,
      detailsOpen: false,
      chatListView: "all",
      activeChatId: null,
      setListWidth: (w) => set({ listWidth: Math.min(LIST_WIDTH.max, Math.max(LIST_WIDTH.min, Math.round(w))) }),
      setDetailsOpen: (detailsOpen) => set({ detailsOpen }),
      setChatListView: (chatListView) => set({ chatListView }),
      setActiveChatId: (activeChatId) => set({ activeChatId }),
    }),
    { name: "chatapp-ui", partialize: (s) => ({ listWidth: s.listWidth }) },
  ),
);
