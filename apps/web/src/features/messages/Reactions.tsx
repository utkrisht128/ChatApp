import { useState } from "react";
import { SmilePlus } from "lucide-react";
import { Popover } from "radix-ui";
import { QUICK_REACTIONS, type Reaction } from "@chat/shared";
import { IconButton } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

export function QuickReactions({ current, onPick }: { current: string | null; onPick: (emoji: string | null) => void }) {
  return (
    <div role="group" aria-label="Reactions" className="flex gap-0.5">
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          aria-label={current === emoji ? `Remove ${emoji} reaction` : `React with ${emoji}`}
          aria-pressed={current === emoji}
          onClick={() => onPick(current === emoji ? null : emoji)}
          className={cn(
            "grid size-10 place-items-center rounded-full text-[22px] transition-transform hover:scale-110 hover:bg-surface-2 active:scale-95",
            current === emoji && "bg-primary-soft",
          )}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

/** Desktop: smiley button in the hover toolbar that opens the quick-reaction bar. */
export function ReactionPopover({ current, onPick }: { current: string | null; onPick: (emoji: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <IconButton label="Add reaction" size="sm" className="[&_svg]:size-4">
          <SmilePlus />
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" sideOffset={6} collisionPadding={8} className="z-50 animate-pop-in rounded-full border border-border bg-surface p-1 shadow-pop">
          <QuickReactions
            current={current}
            onPick={(e) => {
              setOpen(false);
              onPick(e);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ReactionChips({
  reactions,
  meId,
  onToggle,
  nameOf,
  align,
}: {
  reactions: Reaction[];
  meId: string;
  onToggle: (emoji: string | null) => void;
  nameOf: (userId: string) => string;
  align: "start" | "end";
}) {
  if (!reactions.length) return null;
  return (
    <div className={cn("-mt-1 flex flex-wrap gap-1", align === "end" ? "justify-end" : "justify-start")}>
      {reactions.map((r) => {
        const mine = r.userIds.includes(meId);
        const who = r.userIds.map(nameOf).join(", ");
        return (
          <button
            key={r.emoji}
            aria-pressed={mine}
            aria-label={`${r.emoji} from ${who}. ${mine ? "Remove your reaction" : "React with this"}`}
            title={who}
            onClick={() => onToggle(mine ? null : r.emoji)}
            className={cn(
              "relative z-[1] flex h-6 items-center gap-1 rounded-full border px-1.5 text-sm shadow-bubble transition-colors",
              mine ? "border-primary/50 bg-primary-soft" : "border-border bg-surface hover:bg-surface-2",
            )}
          >
            <span>{r.emoji}</span>
            {r.userIds.length > 1 && <span className="text-xs font-medium text-muted">{r.userIds.length}</span>}
          </button>
        );
      })}
    </div>
  );
}
