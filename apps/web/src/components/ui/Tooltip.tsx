import type { ReactElement } from "react";
import { Tooltip as T } from "radix-ui";

export const TooltipProvider = T.Provider;

/** Hover/focus hint. Never the only way to learn what a control does — pair with aria-label. */
export function Tip({ label, side = "right", children }: { label: string; side?: "top" | "right" | "bottom" | "left"; children: ReactElement }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={8} className="z-50 animate-fade-in rounded-lg bg-fg px-2.5 py-1.5 text-xs font-medium text-bg shadow-pop">
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
