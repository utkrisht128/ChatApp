import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { SendHorizontal, Smile, X } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useMe } from "@/features/auth/api";
import { useIsTouch, useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/cn";
import { useDrafts } from "@/stores/drafts";
import { useResolvedTheme } from "@/stores/theme";

// ~250 KB; only fetched the first time someone opens the picker.
const EmojiPicker = lazy(() => import("emoji-picker-react"));

function EmojiPanel({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const theme = useResolvedTheme();
  const desktop = useMediaQuery("(min-width: 768px)");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element;
      if (desktop && ref.current && !ref.current.contains(target) && !target.closest("[data-emoji-toggle]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [desktop, onClose]);

  return (
    <div ref={ref} className="overflow-hidden max-md:mb-2 max-md:rounded-2xl md:absolute md:bottom-full md:left-3 md:z-20 md:mb-2 md:rounded-2xl md:shadow-pop">
      <Suspense
        fallback={
          <div className="grid h-[300px] w-full place-items-center bg-surface md:h-[400px] md:w-[340px]">
            <Spinner className="text-muted" label="Loading emoji" />
          </div>
        }
      >
        <EmojiPicker
          onEmojiClick={(e) => onPick(e.emoji)}
          theme={theme as never}
          // Native emoji: no image downloads from a third-party CDN.
          emojiStyle={"native" as never}
          width={desktop ? 340 : "100%"}
          height={desktop ? 400 : 300}
          lazyLoadEmojis
          autoFocusSearch={desktop}
          previewConfig={{ showPreview: false }}
        />
      </Suspense>
    </div>
  );
}

export function Composer({ chatId, onSend, disabled }: { chatId: string; onSend: (text: string) => void; disabled?: boolean }) {
  const draft = useDrafts((s) => s.drafts[chatId] ?? "");
  const setDraft = useDrafts((s) => s.setDraft);
  const enterToSend = useMe().data?.settings.enterToSend ?? true;
  const touch = useIsTouch();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  // Grow with content up to ~6 lines, then scroll.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  // Desktop: typing anywhere in the conversation goes to the composer.
  useEffect(() => {
    if (!touch) ref.current?.focus();
  }, [chatId, touch]);

  const canSend = draft.trim().length > 0 && !disabled;

  const send = () => {
    const text = draft.trim();
    if (!text || disabled) return;
    onSend(text);
    setDraft(chatId, "");
    ref.current?.focus();
  };

  // Enter sends on devices with a keyboard; on touch devices Enter is a newline (use the send button).
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && enterToSend && !touch) {
      e.preventDefault();
      send();
    }
  };

  const insertEmoji = (emoji: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    setDraft(chatId, draft.slice(0, start) + emoji + draft.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
      if (!touch) el.focus();
    });
  };

  return (
    <div className="relative shrink-0 border-t border-border bg-surface px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:px-4">
      {emojiOpen && <EmojiPanel onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />}
      <div className="flex items-end gap-1.5">
        <IconButton
          data-emoji-toggle
          label={emojiOpen ? "Close emoji picker" : "Insert emoji"}
          aria-expanded={emojiOpen}
          onClick={() => setEmojiOpen((o) => !o)}
          className="mb-0.5"
        >
          {emojiOpen && touch ? <X /> : <Smile />}
        </IconButton>
        <div className="flex min-h-11 flex-1 items-center rounded-3xl bg-surface-2 px-4 py-2.5 focus-within:ring-1 focus-within:ring-primary/30">
          <label htmlFor={id} className="sr-only">
            Message
          </label>
          <textarea
            id={id}
            ref={ref}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(chatId, e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => touch && setEmojiOpen(false)}
            placeholder="Message"
            enterKeyHint={enterToSend && !touch ? "send" : "enter"}
            maxLength={4000}
            className="scrollbar-thin max-h-40 w-full resize-none bg-transparent text-base leading-6 outline-none placeholder:text-subtle focus-visible:outline-none md:text-[15px]"
          />
        </div>
        <IconButton
          variant="primary"
          size="lg"
          label="Send message"
          disabled={!canSend}
          onClick={send}
          // Keep focus in the textarea on mobile so the keyboard stays open after sending.
          onPointerDown={(e) => e.preventDefault()}
          className={cn("transition-transform", canSend ? "scale-100" : "scale-95")}
        >
          <SendHorizontal />
        </IconButton>
      </div>
    </div>
  );
}
