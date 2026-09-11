import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

const EXPIRE_MS = 6000;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

type TypingState = {
  byChat: Record<string, string[]>;
  set: (chatId: string, userId: string, isTyping: boolean) => void;
  clearAll: () => void;
};

/** Who is typing where. Entries expire on their own in case a "stopped" event is lost. */
export const useTyping = create<TypingState>()((set, get) => ({
  byChat: {},
  set: (chatId, userId, isTyping) => {
    const key = `${chatId}:${userId}`;
    clearTimeout(timers.get(key));
    timers.delete(key);
    const current = get().byChat[chatId] ?? [];
    const next = isTyping ? (current.includes(userId) ? current : [...current, userId]) : current.filter((id) => id !== userId);
    if (isTyping) timers.set(key, setTimeout(() => get().set(chatId, userId, false), EXPIRE_MS));
    if (next !== current) set((s) => ({ byChat: { ...s.byChat, [chatId]: next } }));
  },
  clearAll: () => {
    timers.forEach(clearTimeout);
    timers.clear();
    set({ byChat: {} });
  },
}));

export const useTypingUsers = (chatId: string) => useTyping(useShallow((s) => s.byChat[chatId] ?? []));
