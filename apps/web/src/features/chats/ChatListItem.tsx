import { memo } from "react";
import { Archive, ArchiveRestore, Bell, BellOff, Pin, PinOff } from "lucide-react";
import { NavLink } from "react-router";
import type { ChatSummary } from "@chat/shared";
import { ActionMenu, type Action } from "@/components/ui/ActionMenu";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/cn";
import { formatChatTime } from "@/lib/format";
import { FOREVER, useUpdateMembership } from "./api";

function previewOf(chat: ChatSummary, meId: string) {
  const last = chat.lastMessage;
  if (!last) return chat.type === "direct" && chat.peer ? `@${chat.peer.username}` : "No messages yet";
  const mine = last.senderId === meId;
  return `${mine ? "You: " : ""}${last.preview}`;
}

export const ChatListItem = memo(function ChatListItem({ chat, active, meId }: { chat: ChatSummary; active: boolean; meId: string }) {
  const update = useUpdateMembership();
  const muted = Boolean(chat.mutedUntil);
  const unread = chat.unreadCount > 0;

  const actions: Action[] = [
    {
      id: "pin",
      label: chat.pinned ? "Unpin" : "Pin to top",
      icon: chat.pinned ? PinOff : Pin,
      onSelect: () => update.mutate({ id: chat.id, patch: { pinned: !chat.pinned } }),
    },
    {
      id: "mute",
      label: muted ? "Unmute" : "Mute notifications",
      icon: muted ? Bell : BellOff,
      onSelect: () => update.mutate({ id: chat.id, patch: { mutedUntil: muted ? null : FOREVER } }),
    },
    {
      id: "archive",
      label: chat.archived ? "Unarchive" : "Archive",
      icon: chat.archived ? ArchiveRestore : Archive,
      onSelect: () => update.mutate({ id: chat.id, patch: { archived: !chat.archived } }),
    },
  ];

  const time = chat.lastMessage?.createdAt ?? chat.lastMessageAt;

  return (
    <ActionMenu actions={actions} title={chat.name}>
      <NavLink
        to={`/c/${chat.id}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "mx-2 flex select-none items-center gap-3 rounded-xl px-3 py-2.5 transition-colors [-webkit-touch-callout:none]",
          active ? "bg-surface-3" : "hover:bg-surface-2 active:bg-surface-2",
        )}
      >
        <Avatar name={chat.name} src={chat.avatarUrl} seed={chat.peer?.id ?? chat.id} size="lg" online={chat.peer?.online} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[15px] font-semibold">{chat.name}</span>
            <time dateTime={time} className={cn("shrink-0 text-xs", unread && !muted ? "font-semibold text-accent" : "text-subtle")}>
              {formatChatTime(time)}
            </time>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className={cn("truncate text-sm", unread ? "text-fg" : "text-muted")}>{previewOf(chat, meId)}</p>
            <span className="flex shrink-0 items-center gap-1.5 text-subtle">
              {muted && (
                <>
                  <BellOff className="size-3.5" />
                  <span className="sr-only">Muted</span>
                </>
              )}
              {chat.pinned && !unread && (
                <>
                  <Pin className="size-3.5" />
                  <span className="sr-only">Pinned</span>
                </>
              )}
              {chat.mentionCount > 0 && (
                <span className="grid size-5 place-items-center rounded-full bg-primary text-xs font-bold text-primary-fg" aria-label="You were mentioned">
                  @
                </span>
              )}
              {unread && (
                <span
                  className={cn(
                    "grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-xs font-semibold",
                    muted ? "bg-subtle text-surface" : "bg-primary text-primary-fg",
                  )}
                >
                  {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                  <span className="sr-only"> unread</span>
                </span>
              )}
            </span>
          </div>
        </div>
      </NavLink>
    </ActionMenu>
  );
});
