import { create } from "zustand";
import { persist } from "zustand/middleware";

export const LIST_WIDTH = { min: 280, max: 480, default: 360 };

type UiState = {
  /** Chat list pane width on large screens (resizable). */
  listWidth: number;
  /** Chat details panel (inline on wide screens, slide-over otherwise). */
  detailsOpen: boolean;
  chatListView: "all" | "archived";
  setListWidth: (w: number) => void;
  setDetailsOpen: (open: boolean) => void;
  setChatListView: (view: "all" | "archived") => void;
};

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      listWidth: LIST_WIDTH.default,
      detailsOpen: false,
      chatListView: "all",
      setListWidth: (w) => set({ listWidth: Math.min(LIST_WIDTH.max, Math.max(LIST_WIDTH.min, Math.round(w))) }),
      setDetailsOpen: (detailsOpen) => set({ detailsOpen }),
      setChatListView: (chatListView) => set({ chatListView }),
    }),
    { name: "chatapp-ui", partialize: (s) => ({ listWidth: s.listWidth }) },
  ),
);
