import { memo, useRef, useState, type PointerEvent } from "react";
import { Ban, Check, CheckCheck, CircleAlert, Clock3, Copy, CornerUpLeft, Forward, MoreHorizontal, Pencil, Pin, PinOff, RotateCw, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EDIT_WINDOW_MS, type Message } from "@chat/shared";
import { ActionDropdown, ActionMenu, type Action } from "@/components/ui/ActionMenu";
import { Avatar, nameColor } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/Button";
import { useIsTouch } from "@/hooks/useMediaQuery";
import { useResolvedTheme } from "@/stores/theme";
import { cn } from "@/lib/cn";
import { formatClock } from "@/lib/format";
import type { PendingMessage } from "@/stores/outbox";
import { AttachmentsView } from "./Attachments";
import { RichText, type MentionLookup } from "./RichText";
import { QuickReactions, ReactionChips, ReactionPopover } from "./Reactions";
import type { DeliveryStatus } from "./status";

const STATUS: Record<DeliveryStatus, { icon: typeof Check; label: string }> = {
  sending: { icon: Clock3, label: "Sending" },
  failed: { icon: CircleAlert, label: "Not sent" },
  sent: { icon: Check, label: "Sent" },
  delivered: { icon: CheckCheck, label: "Delivered" },
  read: { icon: CheckCheck, label: "Read" },
};

function StatusIcon({ status }: { status: DeliveryStatus }) {
  const { icon: Icon, label } = STATUS[status];
  return (
    <span className={cn("inline-flex", status === "read" && "text-read")}>
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Touch: drag a message to the right to reply. */
function useSwipeToReply(onReply: () => void, enabled: boolean) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"h" | "v" | null>(null);
  const reset = () => {
    if (dx > 56) {
      navigator.vibrate?.(10);
      onReply();
    }
    setDx(0);
    start.current = null;
  };
  return {
    style: dx ? { transform: `translateX(${dx}px)`, transition: "none" } : { transition: "transform 180ms ease-out" },
    handlers: enabled
      ? {
          onPointerDown: (e: PointerEvent) => {
            if (e.pointerType !== "touch") return;
            start.current = { x: e.clientX, y: e.clientY };
            axis.current = null;
          },
          onPointerMove: (e: PointerEvent) => {
            const s = start.current;
            if (!s) return;
            const mx = e.clientX - s.x;
            const my = e.clientY - s.y;
            if (!axis.current && (Math.abs(mx) > 8 || Math.abs(my) > 8)) axis.current = Math.abs(mx) > Math.abs(my) ? "h" : "v";
            if (axis.current === "h") setDx(Math.max(0, Math.min(72, mx)));
          },
          onPointerUp: reset,
          onPointerCancel: reset,
        }
      : {},
  };
}

export type BubbleProps = {
  /** Group chats: someone else's message shows their name (first in a run) and avatar (last in a run). */
  sender?: { id: string; name: string; avatarUrl: string | null };
  message: Message;
  pending?: PendingMessage;
  mine: boolean;
  first: boolean;
  last: boolean;
  status?: DeliveryStatus;
  meId: string;
  focusable: boolean;
  highlighted: boolean;
  starred?: boolean;
  pinned?: boolean;
  /** Whether this viewer may pin in this chat (admins only, in most groups). */
  canPin?: boolean;
  nameOf: (userId: string) => string;
  mentionOf?: MentionLookup;
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  onReact: (m: Message, emoji: string | null) => void;
  onJumpTo: (messageId: string) => void;
  onRetry: (p: PendingMessage) => void;
  onDiscard: (p: PendingMessage) => void;
  onForward: (m: Message) => void;
  onPin: (m: Message, pinned: boolean) => void;
  onStar: (m: Message, starred: boolean) => void;
};

export const MessageBubble = memo(function MessageBubble(props: BubbleProps) {
  const { message: m, pending, mine, first, last, status, meId, nameOf, highlighted, sender, starred, pinned } = props;
  const touch = useIsTouch();
  const theme = useResolvedTheme();
  const isMedia = (a: { kind: string }) => a.kind === "image" || a.kind === "video";
  const hasMedia = m.attachments.some(isMedia);
  // Photos/videos with no caption show the time over the image instead of below it.
  const mediaOnly = hasMedia && !m.body && m.attachments.every(isMedia);
  const deleted = Boolean(m.deletedAt);
  const interactive = !pending && !deleted;
  const myReaction = m.reactions.find((r) => r.userIds.includes(meId))?.emoji ?? null;
  const editable = mine && interactive && m.type === "text" && Date.now() - Date.parse(m.createdAt) < EDIT_WINDOW_MS;
  const swipe = useSwipeToReply(() => props.onReply(m), touch && interactive);

  const actions: Action[] = [
    { id: "reply", label: "Reply", icon: CornerUpLeft, onSelect: () => props.onReply(m), hidden: !interactive },
    {
      id: "copy",
      label: "Copy text",
      icon: Copy,
      hidden: deleted || !m.body,
      onSelect: () => navigator.clipboard.writeText(m.body).then(() => toast.success("Copied"), () => toast.error("Couldn't copy")),
    },
    { id: "forward", label: "Forward", icon: Forward, onSelect: () => props.onForward(m), hidden: !interactive },
    { id: "star", label: starred ? "Remove star" : "Star", icon: Star, onSelect: () => props.onStar(m, !starred), hidden: !interactive },
    {
      id: "pin",
      label: pinned ? "Unpin" : "Pin",
      icon: pinned ? PinOff : Pin,
      onSelect: () => props.onPin(m, !pinned),
      hidden: !interactive || !props.canPin,
    },
    { id: "edit", label: "Edit", icon: Pencil, onSelect: () => props.onEdit(m), hidden: !editable },
    { id: "retry", label: "Retry sending", icon: RotateCw, onSelect: () => pending && props.onRetry(pending), hidden: pending?.status !== "failed" },
    { id: "discard", label: "Discard", icon: Trash2, danger: true, onSelect: () => pending && props.onDiscard(pending), hidden: !pending || pending.status !== "failed" },
    { id: "delete", label: "Delete", icon: Trash2, danger: true, onSelect: () => props.onDelete(m), hidden: Boolean(pending) },
  ];

  const who = mine ? "You" : nameOf(m.senderId);
  const time = formatClock(new Date(m.createdAt));

  return (
    <div className={cn("flex flex-col px-3 md:px-6", mine ? "items-end" : "items-start", first ? "mt-2.5" : "mt-0.5", sender && "pl-12 md:pl-[4.5rem]")}>
      <div className="group/msg relative flex max-w-[min(85%,38rem)] items-center gap-1 md:max-w-[min(75%,38rem)]">
        {/* Positioned by a wrapper: Avatar's own root is `relative`, which would override `absolute`. */}
        {sender && last && (
          <span className="absolute right-full bottom-0 mr-2 flex">
            <Avatar name={sender.name} src={sender.avatarUrl} seed={sender.id} size="sm" />
          </span>
        )}
        <ActionMenu
          actions={actions}
          title={deleted ? "Message" : `Message from ${who}`}
          header={interactive ? (close) => <div className="px-2 pb-2"><QuickReactions current={myReaction} onPick={(e) => (close(), props.onReact(m, e))} /></div> : undefined}
        >
          <div
            id={`msg-${m.id}`}
            data-msg-row
            tabIndex={props.focusable ? 0 : -1}
            {...swipe.handlers}
            style={swipe.style}
            className={cn(
              hasMedia ? "p-1" : "px-3 pt-1.5 pb-1",
              "relative min-w-0 touch-pan-y rounded-2xl shadow-bubble outline-offset-2 transition-[background-color,box-shadow] select-text [-webkit-touch-callout:none]",
              mine ? "bg-bubble-out text-bubble-out-fg" : "bg-bubble-in text-bubble-in-fg",
              mine ? cn(!first && "rounded-tr-md", !last && "rounded-br-md") : cn(!first && "rounded-tl-md", !last && "rounded-bl-md"),
              pending?.status === "failed" && "opacity-80",
              highlighted && "ring-2 ring-primary ring-offset-2 ring-offset-chat",
            )}
          >
            <span className="sr-only">
              {who}, {time}:{" "}
            </span>
            {sender && first && (
              <p aria-hidden className={cn("mb-0.5 truncate text-[13px] font-semibold", hasMedia && "px-2 pt-1")} style={{ color: nameColor(sender.id, theme) }}>
                {sender.name}
              </p>
            )}
            {m.forwarded && !deleted && (
              <p className={cn("flex items-center gap-1 text-xs italic opacity-70", hasMedia && "px-2 pt-1")}>
                <Forward className="size-3.5" aria-hidden /> Forwarded
              </p>
            )}
            {m.replyTo && (
              <button
                onClick={() => props.onJumpTo(m.replyTo!.id)}
                className={cn(
                  "mt-0.5 mb-1 flex w-full min-w-40 flex-col rounded-lg border-l-[3px] px-2.5 py-1 text-left text-sm",
                  mine ? "border-white/70 bg-white/15" : "border-primary bg-primary-soft",
                )}
              >
                <span className={cn("text-xs font-semibold", mine ? "text-white" : "text-accent")}>{nameOf(m.replyTo.senderId)}</span>
                <span className="line-clamp-2 opacity-90">{m.replyTo.preview}</span>
                <span className="sr-only">— jump to original message</span>
              </button>
            )}
            {!deleted && m.attachments.length > 0 && <AttachmentsView attachments={m.attachments} mine={mine} pending={pending?.attachments} />}
            {mediaOnly && !deleted ? (
              <span className="absolute right-2.5 bottom-2.5 flex items-center gap-1 rounded-full bg-black/50 px-1.5 text-[11px] leading-5 text-white">
                <time dateTime={m.createdAt}>{time}</time>
                {mine && status && <StatusIcon status={status} />}
              </span>
            ) : (
              <div className={cn("flex flex-wrap items-end justify-end gap-x-2", hasMedia && "px-2 pt-1 pb-0.5")}>
                {deleted ? (
                  <p className="flex min-w-0 flex-auto items-center gap-1.5 py-0.5 text-[15px] italic opacity-75">
                    <Ban className="size-4 shrink-0" /> {mine ? "You deleted this message" : "This message was deleted"}
                  </p>
                ) : m.body ? (
                  <p className="min-w-0 flex-auto py-0.5 text-[15px] leading-snug break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
                    <RichText text={m.body} mine={mine} mentionOf={props.mentionOf} />
                  </p>
                ) : null}
                <span className={cn("ml-auto flex shrink-0 translate-y-0.5 items-center gap-1 text-[11px] leading-5", mine ? "text-bubble-out-muted" : "text-bubble-in-muted")}>
                  {pinned && (
                    <>
                      <Pin className="size-3" aria-hidden />
                      <span className="sr-only">Pinned</span>
                    </>
                  )}
                  {starred && (
                    <>
                      <Star className="size-3 fill-current" aria-hidden />
                      <span className="sr-only">Starred</span>
                    </>
                  )}
                  {m.editedAt && !deleted && <span>edited</span>}
                  <time dateTime={m.createdAt}>{time}</time>
                  {mine && status && <StatusIcon status={status} />}
                </span>
              </div>
            )}
          </div>
        </ActionMenu>

        {/* Desktop hover/focus toolbar */}
        {!touch && interactive && (
          <div
            className={cn(
              "absolute top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/msg:opacity-100 group-hover/msg:opacity-100 has-[[data-state=open]]:opacity-100",
              mine ? "right-full mr-1 flex-row-reverse" : "left-full ml-1",
            )}
          >
            <ReactionPopover current={myReaction} onPick={(e) => props.onReact(m, e)} />
            <IconButton label="Reply" size="sm" className="[&_svg]:size-4" onClick={() => props.onReply(m)}>
              <CornerUpLeft />
            </IconButton>
            <ActionDropdown actions={actions.filter((a) => a.id !== "reply")} align={mine ? "end" : "start"}>
              <IconButton label="More actions" size="sm" className="[&_svg]:size-4">
                <MoreHorizontal />
              </IconButton>
            </ActionDropdown>
          </div>
        )}
      </div>

      <ReactionChips reactions={m.reactions} meId={meId} nameOf={nameOf} align={mine ? "end" : "start"} onToggle={(e) => props.onReact(m, e)} />

      {pending?.status === "failed" && (
        <div role="alert" className="mt-1 flex items-center gap-2 text-xs text-danger">
          <CircleAlert className="size-3.5" />
          <span>{pending.error ?? "Not sent."}</span>
          <button className="font-semibold underline" onClick={() => props.onRetry(pending)}>
            Retry
          </button>
          <button className="font-semibold underline" onClick={() => props.onDiscard(pending)}>
            Discard
          </button>
        </div>
      )}
    </div>
  );
});
