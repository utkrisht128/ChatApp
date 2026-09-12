import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { chatKeys, patchChatInCache } from "@/features/chats/api";
import { groupKey } from "@/features/groups/api";
import { retryFailed } from "@/features/messages/api";
import { applyMessageToChatList, applyPresence, applyReceipt, messageKeys, removeMessage, replaceMessage, upsertMessage } from "@/features/messages/cache";
import { connectSocket, disconnectSocket } from "@/lib/socket";
import { useConnection } from "@/stores/connection";
import { useTyping } from "@/stores/typing";
import { useUi } from "@/stores/ui";

/**
 * Owns the socket for the signed-in session and routes every server event into the
 * React Query caches — components never subscribe to the socket directly.
 */
export function useRealtime(meId: string) {
  const qc = useQueryClient();

  useEffect(() => {
    const setStatus = useConnection.getState().setStatus;
    const typing = useTyping.getState();
    let connectedBefore = false;
    // The socket library is loaded on demand, so wiring up the handlers is asynchronous. If the
    // effect is torn down first, the socket that arrives is closed immediately.
    let cancelled = false;
    setStatus("connecting");

    void connectSocket().then((socket) => {
      if (cancelled) return void socket.disconnect();

      socket.on("connect", () => {
      setStatus("connected");
      // Catch up on anything missed while disconnected.
      if (connectedBefore) {
        void qc.invalidateQueries({ queryKey: chatKeys.lists });
        void qc.invalidateQueries({ queryKey: messageKeys.all });
      }
        connectedBefore = true;
        retryFailed(qc);
      });
      socket.on("disconnect", (reason) => {
        typing.clearAll();
        if (reason === "io client disconnect") return setStatus("disconnected");
        setStatus("reconnecting");
        // The server dropped us (e.g. "log out everywhere"). Reconnecting fetches a new ticket,
        // which fails — and signs this tab out — if the session is gone.
        if (reason === "io server disconnect") socket.connect();
      });
      socket.on("connect_error", () => setStatus(connectedBefore ? "reconnecting" : "connecting"));

      socket.on("message:new", ({ message }) => {
        upsertMessage(qc, message);
        const isActive = useUi.getState().activeChatId === message.chatId && document.visibilityState === "visible";
        applyMessageToChatList(qc, message, { meId, isActive });
        if (message.senderId !== meId) {
          typing.set(message.chatId, message.senderId, false);
          socket.emit("message:delivered", { chatId: message.chatId, messageId: message.id });
        }
      });
      socket.on("message:updated", ({ message }) => replaceMessage(qc, message));
      socket.on("message:hidden", ({ chatId, messageId }) => removeMessage(qc, chatId, messageId));
      socket.on("receipt:updated", ({ chatId, ...receipt }) => applyReceipt(qc, chatId, receipt));
      socket.on("typing", ({ chatId, userId, isTyping }) => typing.set(chatId, userId, isTyping));
      socket.on("presence", (p) => applyPresence(qc, p));
      // Group info/membership changed (or we were removed): refetch; a lost membership shows as "not found".
      socket.on("chat:updated", ({ chatId }) => {
        void qc.invalidateQueries({ queryKey: groupKey(chatId) });
        void qc.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
        void qc.invalidateQueries({ queryKey: chatKeys.lists });
        // Pinning and unpinning are announced the same way.
        void qc.invalidateQueries({ queryKey: messageKeys.pinned(chatId) });
      });
      socket.on("chat:read", ({ chatId, unreadCount }) =>
        patchChatInCache(qc, chatId, (c) => ({ ...c, unreadCount, mentionCount: unreadCount ? c.mentionCount : 0 })),
      );
    });

    const onOnline = () => retryFailed(qc);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      disconnectSocket();
      typing.clearAll();
    };
  }, [qc, meId]);
}
