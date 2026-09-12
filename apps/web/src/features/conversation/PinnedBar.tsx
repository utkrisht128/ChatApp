import { useEffect, useState } from "react";
import { Pin, X } from "lucide-react";
import { summarizeMessage, type ChatSummary, type Message } from "@chat/shared";
import { IconButton } from "@/components/ui/Button";
import { usePinned, useSetPinned } from "@/features/messages/api";
import { cn } from "@/lib/cn";

/**
 * Strip above the message list showing the chat's pinned messages. Tapping it jumps to the
 * pinned message; with several pinned, each tap moves to the next (like other messengers).
 */
export function PinnedBar({ chat, onJumpTo }: { chat: ChatSummary; onJumpTo: (messageId: string) => void }) {
  const pinned = usePinned(chat.id);
  const setPinned = useSetPinned(chat.id);
  const [index, setIndex] = useState(0);

  const messages: Message[] = pinned.data ?? [];
  // Unpinning the last one in the list would otherwise leave the index out of range.
  useEffect(() => {
    if (index >= messages.length) setIndex(0);
  }, [index, messages.length]);

  const current = messages[Math.min(index, messages.length - 1)];
  if (!current) return null;

  const canUnpin = chat.type === "direct" || chat.role !== "member";

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface/95 px-2 py-1.5 backdrop-blur md:px-3">
      <button
        onClick={() => {
          onJumpTo(current.id);
          if (messages.length > 1) setIndex((i) => (i + 1) % messages.length);
        }}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1 text-left hover:bg-surface-2"
      >
        <Pin className="size-4 shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-accent">
            Pinned message{messages.length > 1 ? ` ${Math.min(index, messages.length - 1) + 1} of ${messages.length}` : ""}
          </span>
          <span className="block truncate text-sm text-muted">{summarizeMessage(current)}</span>
        </span>
        {messages.length > 1 && (
          <span aria-hidden className="flex shrink-0 flex-col gap-0.5">
            {messages.slice(0, 5).map((m, i) => (
              <span key={m.id} className={cn("h-1 w-0.5 rounded-full", i === Math.min(index, messages.length - 1) ? "bg-primary" : "bg-border-strong")} />
            ))}
          </span>
        )}
        <span className="sr-only">— jump to it</span>
      </button>
      {canUnpin && (
        <IconButton label="Unpin this message" size="sm" onClick={() => setPinned.mutate({ message: current, pinned: false })}>
          <X />
        </IconButton>
      )}
    </div>
  );
}
