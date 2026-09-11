import { useState, type ComponentType, type ReactElement, type ReactNode } from "react";
import { ContextMenu, Dialog as D, DropdownMenu, Slot } from "radix-ui";
import { useIsTouch } from "@/hooks/useMediaQuery";
import { useLongPress } from "@/hooks/useLongPress";
import { cn } from "@/lib/cn";

export type Action = {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
};

const itemClass = (danger?: boolean) =>
  cn(
    "flex h-10 cursor-default select-none items-center gap-3 rounded-lg px-3 text-sm outline-none",
    "data-[highlighted]:bg-surface-2 data-[disabled]:opacity-45",
    danger ? "text-danger" : "text-fg",
  );
const contentClass = "z-50 min-w-52 animate-pop-in rounded-xl border border-border bg-surface p-1 shadow-pop";

/**
 * One list of actions, two presentations: a right-click context menu with a mouse,
 * and a long-press bottom sheet on touch devices. Keyboard users get the context menu
 * via the Menu key / Shift+F10.
 */
type SheetHeader = ReactNode | ((close: () => void) => ReactNode);

export function ActionMenu({ actions, title, header, children }: { actions: Action[]; title: string; header?: SheetHeader; children: ReactElement }) {
  const touch = useIsTouch();
  const [sheetOpen, setSheetOpen] = useState(false);
  const longPress = useLongPress(() => setSheetOpen(true));
  const visible = actions.filter((a) => !a.hidden);

  if (touch) {
    return (
      <>
        <Slot.Root {...longPress}>{children}</Slot.Root>
        <ActionSheet open={sheetOpen} onOpenChange={setSheetOpen} title={title} header={header} actions={visible} />
      </>
    );
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={contentClass} collisionPadding={8}>
          {visible.map((a) => (
            <ContextMenu.Item key={a.id} disabled={a.disabled} onSelect={a.onSelect} className={itemClass(a.danger)}>
              {a.icon && <a.icon className="size-4 opacity-80" />}
              {a.label}
            </ContextMenu.Item>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** A button-triggered dropdown with the same actions (e.g. a header "⋮" button). */
export function ActionDropdown({ actions, children, align = "end" }: { actions: Action[]; children: ReactElement; align?: "start" | "end" }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} sideOffset={6} collisionPadding={8} className={contentClass}>
          {actions
            .filter((a) => !a.hidden)
            .map((a) => (
              <DropdownMenu.Item key={a.id} disabled={a.disabled} onSelect={a.onSelect} className={itemClass(a.danger)}>
                {a.icon && <a.icon className="size-4 opacity-80" />}
                {a.label}
              </DropdownMenu.Item>
            ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function ActionSheet({
  open,
  onOpenChange,
  title,
  header,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Extra content above the actions (e.g. quick reactions); a function receives `close`. */
  header?: SheetHeader;
  actions: Action[];
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 flex animate-fade-in items-end bg-overlay">
          <D.Content
            aria-describedby={undefined}
            className="w-full animate-sheet-in rounded-t-3xl bg-surface px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-pop outline-none"
          >
            <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-border-strong" aria-hidden />
            <D.Title className="truncate px-3 pb-2 text-sm font-semibold text-muted">{title}</D.Title>
            {typeof header === "function" ? header(() => onOpenChange(false)) : header}
            <ul className="flex flex-col">
              {actions.map((a) => (
                <li key={a.id}>
                  <button
                    disabled={a.disabled}
                    onClick={() => {
                      onOpenChange(false);
                      a.onSelect();
                    }}
                    className={cn(
                      "flex h-12 w-full items-center gap-4 rounded-xl px-3 text-left text-[15px] active:bg-surface-2 disabled:opacity-45",
                      a.danger ? "text-danger" : "text-fg",
                    )}
                  >
                    {a.icon && <a.icon className="size-5 opacity-80" />}
                    {a.label}
                  </button>
                </li>
              ))}
            </ul>
          </D.Content>
        </D.Overlay>
      </D.Portal>
    </D.Root>
  );
}
