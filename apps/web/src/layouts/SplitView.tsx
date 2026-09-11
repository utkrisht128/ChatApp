import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { LIST_WIDTH, useUi } from "@/stores/ui";

function ResizeHandle() {
  const width = useUi((s) => s.listWidth);
  const setWidth = useUi((s) => s.setListWidth);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const startX = e.clientX;
    const startWidth = width;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setWidth(startWidth + ev.clientX - startX);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat list"
      aria-valuenow={width}
      aria-valuemin={LIST_WIDTH.min}
      aria-valuemax={LIST_WIDTH.max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => setWidth(LIST_WIDTH.default)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") setWidth(width - 16);
        if (e.key === "ArrowRight") setWidth(width + 16);
      }}
      className="relative z-10 -ml-0.5 hidden w-1 shrink-0 cursor-col-resize touch-none transition-colors hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none lg:block"
    />
  );
}

/**
 * List + detail layout.
 *  - Phones: one pane at a time (`showDetail` picks which).
 *  - Tablet: both panes, fixed-width list.
 *  - Desktop: both panes, resizable list.
 */
export function SplitView({ list, children, showDetail }: { list: ReactNode; children: ReactNode; showDetail: boolean }) {
  const width = useUi((s) => s.listWidth);
  return (
    <div className="flex min-w-0 flex-1">
      <div
        className={cn(
          "flex min-h-0 w-full flex-col bg-surface md:w-[300px] md:shrink-0 md:border-r md:border-border lg:w-(--list-w)",
          showDetail && "max-md:hidden",
        )}
        style={{ "--list-w": `${width}px` } as CSSProperties}
      >
        {list}
      </div>
      <ResizeHandle />
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !showDetail && "max-md:hidden")}>{children}</div>
    </div>
  );
}
