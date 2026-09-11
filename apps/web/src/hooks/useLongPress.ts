import { useRef, type PointerEvent, type MouseEvent } from "react";

/**
 * Long-press for touch/pen. Cancels if the finger moves (so scrolling never triggers it)
 * and swallows the click that follows a completed long-press.
 */
export function useLongPress(onLongPress: () => void, delayMs = 450) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };

  return {
    onPointerDown(e: PointerEvent) {
      if (e.pointerType === "mouse") return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        navigator.vibrate?.(10);
        onLongPress();
      }, delayMs);
    },
    onPointerMove(e: PointerEvent) {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClickCapture(e: MouseEvent) {
      if (fired.current) {
        e.preventDefault();
        e.stopPropagation();
        fired.current = false;
      }
    },
    // Suppress the OS long-press menu (copy/open link) — we show our own.
    onContextMenu(e: MouseEvent) {
      e.preventDefault();
    },
  };
}
