import { Archive, ArchiveRestore, ArrowLeft, Bell, BellOff, Info, MoreVertical, Pin, PinOff } from "lucide-react";
import { useNavigate } from "react-router";
import type { ChatSummary } from "@chat/shared";
import { ActionDropdown, type Action } from "@/components/ui/ActionMenu";
import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/Button";
import { FOREVER, useUpdateMembership } from "@/features/chats/api";
import { presenceText } from "@/features/chats/presence";
import { cn } from "@/lib/cn";
import { useUi } from "@/stores/ui";

export function ConversationHeader({ chat, subtitle }: { chat: ChatSummary; subtitle?: string }) {
  const navigate = useNavigate();
  const detailsOpen = useUi((s) => s.detailsOpen);
  const setDetailsOpen = useUi((s) => s.setDetailsOpen);
  const update = useUpdateMembership();
  const muted = Boolean(chat.mutedUntil);
  const status = subtitle ?? presenceText(chat);

  const actions: Action[] = [
    { id: "info", label: "Chat info", icon: Info, onSelect: () => setDetailsOpen(true) },
    { id: "mute", label: muted ? "Unmute" : "Mute notifications", icon: muted ? Bell : BellOff, onSelect: () => update.mutate({ id: chat.id, patch: { mutedUntil: muted ? null : FOREVER } }) },
    { id: "pin", label: chat.pinned ? "Unpin chat" : "Pin chat", icon: chat.pinned ? PinOff : Pin, onSelect: () => update.mutate({ id: chat.id, patch: { pinned: !chat.pinned } }) },
    {
      id: "archive",
      label: chat.archived ? "Unarchive" : "Archive chat",
      icon: chat.archived ? ArchiveRestore : Archive,
      onSelect: () => update.mutate({ id: chat.id, patch: { archived: !chat.archived } }),
    },
  ];

  return (
    <header className="z-10 shrink-0 border-b border-border bg-surface/95 pt-safe backdrop-blur">
      <div className="flex h-16 items-center gap-1 px-2 md:px-3">
        <IconButton label="Back to chats" className="md:hidden" onClick={() => navigate("/")}>
          <ArrowLeft />
        </IconButton>
        <button
          onClick={() => setDetailsOpen(!detailsOpen)}
          aria-expanded={detailsOpen}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1.5 py-1 text-left hover:bg-surface-2"
        >
          <Avatar name={chat.name} src={chat.avatarUrl} seed={chat.peer?.id ?? chat.id} online={chat.peer?.online} />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{chat.name}</span>
            <span className={cn("block truncate text-xs", status === "online" || status.endsWith("typing…") ? "text-accent" : "text-muted")} aria-live="polite">
              {status}
            </span>
          </span>
          <span className="sr-only">— open chat info</span>
        </button>
        <ActionDropdown actions={actions}>
          <IconButton label="Chat options">
            <MoreVertical />
          </IconButton>
        </ActionDropdown>
      </div>
    </header>
  );
}
