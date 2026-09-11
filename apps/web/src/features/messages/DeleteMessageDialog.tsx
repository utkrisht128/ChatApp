import { Dialog as D } from "radix-ui";
import type { Message } from "@chat/shared";
import { DialogContent } from "@/components/ui/Dialog";

export function DeleteMessageDialog({
  message,
  mine,
  onClose,
  onDelete,
}: {
  message: Message | null;
  mine: boolean;
  onClose: () => void;
  onDelete: (scope: "me" | "everyone") => void;
}) {
  const canDeleteForEveryone = mine && !message?.deletedAt;
  const choose = (scope: "me" | "everyone") => {
    onDelete(scope);
    onClose();
  };
  return (
    <D.Root open={Boolean(message)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Delete message?"
        description={canDeleteForEveryone ? "Delete for everyone removes it for all members of this chat." : "It will be removed from this chat on your devices only."}
        bodyClassName="flex flex-col gap-2"
      >
        {canDeleteForEveryone && (
          <button onClick={() => choose("everyone")} className="h-11 rounded-xl bg-danger-solid font-semibold text-white hover:opacity-90">
            Delete for everyone
          </button>
        )}
        <button
          onClick={() => choose("me")}
          className={canDeleteForEveryone ? "h-11 rounded-xl font-semibold text-danger hover:bg-danger-soft" : "h-11 rounded-xl bg-danger-solid font-semibold text-white hover:opacity-90"}
        >
          Delete for me
        </button>
        <D.Close asChild>
          <button className="h-11 rounded-xl font-semibold hover:bg-surface-2">Cancel</button>
        </D.Close>
      </DialogContent>
    </D.Root>
  );
}
