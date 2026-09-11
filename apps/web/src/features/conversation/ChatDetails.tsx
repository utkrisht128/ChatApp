import type { ButtonHTMLAttributes, ComponentType, ReactElement, Ref } from "react";
import { Archive, ArchiveRestore, Bell, BellOff, Pin, PinOff } from "lucide-react";
import type { ChatSummary } from "@chat/shared";
import { ActionDropdown } from "@/components/ui/ActionMenu";
import { Avatar } from "@/components/ui/Avatar";
import { MUTE_OPTIONS, muteUntil, useUpdateMembership } from "@/features/chats/api";
import { presenceText } from "@/features/chats/presence";

// Spreads unknown props so it can be a Radix trigger (asChild passes handlers, aria and ref).
function QuickAction({
  icon: Icon,
  label,
  ref,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: ComponentType<{ className?: string }>; label: string; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button ref={ref} type="button" {...rest} className="flex flex-col items-center gap-1.5 rounded-2xl bg-surface-2 px-2 py-3 text-xs font-medium text-fg hover:bg-surface-3">
      <Icon className="size-5 text-accent" />
      {label}
    </button>
  );
}

function MuteButton({ chat, children }: { chat: ChatSummary; children: ReactElement }) {
  const update = useUpdateMembership();
  if (chat.mutedUntil) return children;
  return (
    <ActionDropdown
      align="start"
      actions={MUTE_OPTIONS.map((o) => ({ id: o.id, label: o.label, onSelect: () => update.mutate({ id: chat.id, patch: { mutedUntil: muteUntil(o.ms) } }) }))}
    >
      {children}
    </ActionDropdown>
  );
}

export function ChatDetails({ chat }: { chat: ChatSummary }) {
  const update = useUpdateMembership();
  const muted = Boolean(chat.mutedUntil);
  const mutedForever = chat.mutedUntil?.startsWith("9999");

  return (
    <div className="flex flex-col items-center px-6 py-8 text-center">
      <Avatar name={chat.name} src={chat.avatarUrl} seed={chat.peer?.id ?? chat.id} size="2xl" />
      <h2 className="mt-4 text-xl font-semibold">{chat.name}</h2>
      {chat.peer && <p className="text-sm text-muted">@{chat.peer.username}</p>}
      <p className="mt-1 text-sm text-muted">{presenceText(chat)}</p>
      {chat.peer?.bio && <p className="mt-4 max-w-xs text-sm whitespace-pre-line">{chat.peer.bio}</p>}

      <div className="mt-6 grid w-full grid-cols-3 gap-2">
        <MuteButton chat={chat}>
          <QuickAction
            icon={muted ? BellOff : Bell}
            label={muted ? "Unmute" : "Mute"}
            onClick={muted ? () => update.mutate({ id: chat.id, patch: { mutedUntil: null } }) : undefined}
          />
        </MuteButton>
        <QuickAction icon={chat.pinned ? PinOff : Pin} label={chat.pinned ? "Unpin" : "Pin"} onClick={() => update.mutate({ id: chat.id, patch: { pinned: !chat.pinned } })} />
        <QuickAction
          icon={chat.archived ? ArchiveRestore : Archive}
          label={chat.archived ? "Unarchive" : "Archive"}
          onClick={() => update.mutate({ id: chat.id, patch: { archived: !chat.archived } })}
        />
      </div>
      {muted && (
        <p className="mt-3 text-xs text-muted">
          {mutedForever ? "Notifications muted" : `Muted until ${new Date(chat.mutedUntil!).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`}
        </p>
      )}
    </div>
  );
}
