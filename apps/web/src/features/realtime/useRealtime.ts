import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { chatKeys, patchChatInCache } from "@/features/chats/api";
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
    const socket = connectSocket();
    let connectedBefore = false;
    setStatus("connecting");

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
    socket.on("chat:read", ({ chatId, unreadCount }) =>
      patchChatInCache(qc, chatId, (c) => ({ ...c, unreadCount, mentionCount: unreadCount ? c.mentionCount : 0 })),
    );

    const onOnline = () => retryFailed(qc);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      disconnectSocket();
      typing.clearAll();
    };
  }, [qc, meId]);
}
