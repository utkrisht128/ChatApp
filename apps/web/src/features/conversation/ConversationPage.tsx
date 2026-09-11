import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MessageSquareOff } from "lucide-react";
import { Link, useParams } from "react-router";
import { EDIT_WINDOW_MS, type ChatSummary, type Message } from "@chat/shared";
import { SidePanel } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { useCurrentUser } from "@/features/auth/api";
import { useChat } from "@/features/chats/api";
import { flattenMessages, useDeleteMessage, useEditMessage, useSendMessage } from "@/features/messages/api";
import { messageKeys, type MessagePages } from "@/features/messages/cache";
import { DeleteMessageDialog } from "@/features/messages/DeleteMessageDialog";
import { MessageList } from "@/features/messages/MessageList";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { ApiError } from "@/lib/api";
import { useTypingUsers } from "@/stores/typing";
import { useUi } from "@/stores/ui";
import { ChatDetails } from "./ChatDetails";
import { Composer } from "./Composer";
import { ConversationHeader } from "./ConversationHeader";

export default function ConversationPage() {
  const { chatId = "" } = useParams();
  const chat = useChat(chatId);

  if (chat.isPending) return <ConversationSkeleton />;
  if (chat.isError) {
    if (chat.error instanceof ApiError && chat.error.status === 404) {
      return (
        <div className="grid flex-1 place-items-center bg-chat">
          <EmptyState
            icon={MessageSquareOff}
            title="Chat not found"
            description="It may have been removed, or you don't have access to it."
            action={
              <Link to="/" className="inline-flex items-center gap-1.5 font-semibold text-accent hover:underline">
                <ArrowLeft className="size-4" /> Back to chats
              </Link>
            }
          />
        </div>
      );
    }
    return (
      <div className="grid flex-1 place-items-center bg-chat">
        <ErrorState title="Couldn't open this chat" error={chat.error} onRetry={() => chat.refetch()} />
      </div>
    );
  }
  return <Conversation key={chatId} chat={chat.data} />;
}

function Conversation({ chat }: { chat: ChatSummary }) {
  const me = useCurrentUser();
  const qc = useQueryClient();
  const detailsOpen = useUi((s) => s.detailsOpen);
  const setDetailsOpen = useUi((s) => s.setDetailsOpen);
  const wide = useMediaQuery("(min-width: 1280px)");

  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const send = useSendMessage(chat.id);
  const edit = useEditMessage();
  const del = useDeleteMessage();

  // Incoming messages in the chat on screen don't bump the unread badge.
  useEffect(() => {
    useUi.getState().setActiveChatId(chat.id);
    return () => useUi.getState().setActiveChatId(null);
  }, [chat.id]);

  const typingUsers = useTypingUsers(chat.id);
  const typingText = typingUsers.length ? (chat.type === "direct" ? "typing…" : `${typingUsers.length} typing…`) : undefined;

  const nameOf = useCallback(
    (userId: string) => (userId === me.id ? "You" : chat.peer?.id === userId ? chat.peer.displayName : "Member"),
    [me.id, chat.peer],
  );

  const onReply = useCallback((m: Message) => {
    setEditing(null);
    setReplyTo(m);
  }, []);
  const onEdit = useCallback((m: Message) => {
    setReplyTo(null);
    setEditing(m);
  }, []);

  const editLast = () => {
    const all = flattenMessages(qc.getQueryData<MessagePages>(messageKeys.list(chat.id)));
    const last = [...all].reverse().find((m) => m.senderId === me.id && !m.deletedAt && Date.now() - Date.parse(m.createdAt) < EDIT_WINDOW_MS);
    if (last) onEdit(last);
  };

  return (
    <div className="flex min-h-0 flex-1 max-md:animate-slide-in-right">
      <section aria-label={`Conversation with ${chat.name}`} className="flex min-w-0 flex-1 flex-col bg-chat">
        <ConversationHeader chat={chat} subtitle={typingText} />
        <MessageList chat={chat} meId={me.id} nameOf={nameOf} onReply={onReply} onEdit={onEdit} onDelete={setDeleting} />
        <Composer
          chatId={chat.id}
          nameOf={nameOf}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          editing={editing}
          onCancelEdit={() => setEditing(null)}
          onSubmitEdit={(body) => {
            if (editing) edit.mutate({ message: editing, body });
            setEditing(null);
          }}
          onEditLast={editLast}
          onSend={(text) => {
            send(text, replyTo);
            setReplyTo(null);
          }}
        />
      </section>

      {wide ? (
        detailsOpen && (
          <aside aria-label="Chat info" className="scrollbar-thin w-80 shrink-0 overflow-y-auto border-l border-border bg-surface">
            <ChatDetails chat={chat} />
          </aside>
        )
      ) : (
        <SidePanel open={detailsOpen} onOpenChange={setDetailsOpen} title="Chat info">
          <ChatDetails chat={chat} />
        </SidePanel>
      )}

      <DeleteMessageDialog
        message={deleting}
        mine={deleting?.senderId === me.id}
        onClose={() => setDeleting(null)}
        onDelete={(scope) => deleting && del.mutate({ message: deleting, scope })}
      />
    </div>
  );
}

function ConversationSkeleton() {
  return (
    <div role="status" aria-label="Loading conversation" className="flex min-h-0 flex-1 flex-col bg-chat">
      <div className="flex h-16 items-center gap-3 border-b border-border bg-surface px-4">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-end gap-3 p-4">
        {["w-48", "w-64", "w-36", "w-56", "w-40"].map((w, i) => (
          <Skeleton key={w} className={`h-10 max-w-[70%] rounded-2xl ${w} ${i % 2 ? "self-end" : "self-start"}`} />
        ))}
      </div>
      <div className="h-16 border-t border-border bg-surface" />
    </div>
  );
}
