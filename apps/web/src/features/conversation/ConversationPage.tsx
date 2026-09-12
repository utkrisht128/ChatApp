import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MessageSquareOff, Upload } from "lucide-react";
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
import { useGroup } from "@/features/groups/api";
import { MessageList, type Person } from "@/features/messages/MessageList";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { ApiError } from "@/lib/api";
import { useTypingUsers } from "@/stores/typing";
import { useUi } from "@/stores/ui";
import type { MentionLookup } from "@/features/messages/RichText";
import { ReportDialog, type ReportTarget } from "@/features/moderation/ReportDialog";
import { toLocalFiles, type LocalFile } from "./AttachmentTray";
import { ChatDetails } from "./ChatDetails";
import { Composer } from "./Composer";
import { ConversationHeader } from "./ConversationHeader";
import { ForwardDialog } from "./ForwardDialog";
import { PinnedBar } from "./PinnedBar";

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
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [jumpTarget, setJumpTarget] = useState<{ id: string; nonce: number } | null>(null);
  const jumpTo = useCallback((id: string) => setJumpTarget({ id, nonce: Date.now() }), []);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const hasFilesIn = (e: DragEvent) => e.dataTransfer.types.includes("Files");
  const send = useSendMessage(chat.id);
  const edit = useEditMessage();
  const del = useDeleteMessage();

  // Incoming messages in the chat on screen don't bump the unread badge.
  useEffect(() => {
    useUi.getState().setActiveChatId(chat.id);
    return () => useUi.getState().setActiveChatId(null);
  }, [chat.id]);

  const isGroup = chat.type === "group";
  const group = useGroup(chat.id, isGroup);

  const people = useMemo(() => {
    const map = new Map<string, Person>();
    for (const m of group.data?.members ?? []) map.set(m.user.id, { name: m.user.displayName, avatarUrl: m.user.avatarUrl });
    if (chat.peer) map.set(chat.peer.id, { name: chat.peer.displayName, avatarUrl: chat.peer.avatarUrl });
    map.set(me.id, { name: "You", avatarUrl: me.avatarUrl });
    return map;
  }, [group.data, chat.peer, me.id, me.avatarUrl]);
  const personOf = useCallback((id: string): Person => people.get(id) ?? { name: isGroup ? "Former member" : "Deleted account", avatarUrl: null }, [people, isGroup]);
  const nameOf = useCallback((id: string) => personOf(id).name, [personOf]);

  /** Everyone who can be mentioned here, by username — the same set the server will accept. */
  const mentionable = useMemo(() => {
    const list = [
      ...(group.data?.members ?? []).filter((m) => m.active).map((m) => m.user),
      ...(chat.peer ? [chat.peer] : []),
    ];
    return list.filter((u) => u.id !== me.id);
  }, [group.data, chat.peer, me.id]);

  const byUsername = useMemo(() => {
    const map = new Map<string, { id: string; isMe: boolean }>();
    for (const u of mentionable) map.set(u.username.toLowerCase(), { id: u.id, isMe: false });
    map.set(me.username.toLowerCase(), { id: me.id, isMe: true });
    return map;
  }, [mentionable, me.id, me.username]);
  const mentionOf = useCallback<MentionLookup>((username) => byUsername.get(username) ?? null, [byUsername]);

  // Mirrors the server rule; the server still enforces it.
  const canPin = !isGroup || chat.role !== "member" || group.data?.permissions.editInfo === "all";

  const typingUsers = useTypingUsers(chat.id);
  const typingText = !typingUsers.length
    ? undefined
    : !isGroup
      ? "typing…"
      : typingUsers.length === 1
        ? `${nameOf(typingUsers[0]!)} is typing…`
        : typingUsers.length === 2
          ? `${nameOf(typingUsers[0]!)} and ${nameOf(typingUsers[1]!)} are typing…`
          : `${typingUsers.length} people are typing…`;

  // Mirrors the server rule; the server still enforces it.
  const canSend = !isGroup || !group.data || group.data.permissions.send === "all" || chat.role !== "member";

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
      <section
        aria-label={`Conversation with ${chat.name}`}
        className="relative flex min-w-0 flex-1 flex-col bg-chat"
        // Desktop drag-and-drop: a depth counter stops the overlay flickering over child elements.
        onDragEnter={(e) => {
          if (!canSend || !hasFilesIn(e)) return;
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => canSend && hasFilesIn(e) && e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }}
        onDrop={(e) => {
          if (!canSend || !hasFilesIn(e)) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          const dropped = Array.from(e.dataTransfer.files);
          setFiles((prev) => [...prev, ...toLocalFiles(dropped, prev.length)]);
        }}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-3 z-30 grid animate-fade-in place-items-center rounded-3xl border-2 border-dashed border-primary bg-surface/85 backdrop-blur-sm">
            <p className="flex flex-col items-center gap-2 text-center font-semibold text-accent">
              <Upload className="size-8" /> Drop files to send to {chat.name}
            </p>
          </div>
        )}
        <ConversationHeader chat={chat} subtitle={typingText} />
        <PinnedBar chat={chat} onJumpTo={jumpTo} />
        <MessageList
          chat={chat}
          meId={me.id}
          nameOf={nameOf}
          personOf={personOf}
          mentionOf={mentionOf}
          canPin={canPin}
          jumpTarget={jumpTarget}
          onReply={onReply}
          onEdit={onEdit}
          onDelete={setDeleting}
          onForward={setForwarding}
          onReport={(m) => setReporting({ subject: "message", id: m.id, name: nameOf(m.senderId), senderId: m.senderId })}
        />
        <Composer
          chatId={chat.id}
          disabledReason={canSend ? undefined : "Only admins can send messages in this group."}
          nameOf={nameOf}
          mentionable={isGroup ? mentionable : []}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          editing={editing}
          onCancelEdit={() => setEditing(null)}
          onSubmitEdit={(body) => {
            if (editing) edit.mutate({ message: editing, body });
            setEditing(null);
          }}
          onEditLast={editLast}
          files={files}
          onFilesChange={setFiles}
          onSend={(text) => {
            send(text, replyTo, files.map((f) => ({ file: f.file, kind: f.kind, name: f.file.name })));
            setReplyTo(null);
            setFiles([]);
          }}
          onSendVoice={(blob, durationMs, waveform) => {
            send("", replyTo, [{ file: blob, kind: "voice", name: "Voice message", durationMs, waveform }]);
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

      <ForwardDialog message={forwarding} onClose={() => setForwarding(null)} />
      <ReportDialog target={reporting} onClose={() => setReporting(null)} />

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
