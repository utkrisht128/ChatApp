import type { ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./Button";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

type ContentProps = {
  title: string;
  description?: ReactNode;
  hideTitle?: boolean;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  footer?: ReactNode;
};

/**
 * Modal that is a bottom sheet on phones and a centred dialog from `sm` up.
 * Focus trapping, Esc to close and aria wiring come from Radix.
 */
export function DialogContent({ title, description, hideTitle, children, className, bodyClassName, footer }: ContentProps) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-overlay sm:items-center sm:p-4">
        <D.Content
          aria-describedby={description ? undefined : undefined}
          className={cn(
            "relative flex max-h-[88dvh] w-full animate-sheet-in flex-col overflow-hidden rounded-t-3xl bg-surface shadow-pop outline-none",
            "sm:max-w-md sm:animate-pop-in sm:rounded-2xl",
            className,
          )}
        >
          <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border-strong sm:hidden" aria-hidden />
          <div className="flex shrink-0 items-start justify-between gap-4 px-5 pt-3 sm:pt-5">
            <div className="min-w-0">
              <D.Title className={cn("text-lg font-semibold", hideTitle && "sr-only")}>{title}</D.Title>
              {description && <D.Description className="mt-1 text-sm text-muted">{description}</D.Description>}
            </div>
            <D.Close asChild>
              <IconButton label="Close" size="sm" className="-mt-1 -mr-2">
                <X />
              </IconButton>
            </D.Close>
          </div>
          <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-5", bodyClassName)}>{children}</div>
          {footer && (
            <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          )}
        </D.Content>
      </D.Overlay>
    </D.Portal>
  );
}

/** Slide-over panel from the right (chat info on narrower screens). */
export function SidePanel({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 animate-fade-in bg-overlay" />
        <D.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm animate-slide-in-right flex-col bg-surface shadow-pop outline-none pt-safe"
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2">
            <D.Close asChild>
              <IconButton label="Close">
                <X />
              </IconButton>
            </D.Close>
            <D.Title className="font-semibold">{title}</D.Title>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Confirmation for destructive actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  loading,
  destructive = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  loading?: boolean;
  destructive?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        description={description}
        bodyClassName="hidden"
        footer={
          <>
            <D.Close asChild>
              <button className="h-10 rounded-xl px-4 text-sm font-semibold hover:bg-surface-2">Cancel</button>
            </D.Close>
            <button
              className={cn(
                "inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold disabled:opacity-60",
                destructive ? "bg-danger-solid text-white" : "bg-primary text-primary-fg",
              )}
              disabled={loading}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </>
        }
      >
        {null}
      </DialogContent>
    </D.Root>
  );
}
