import { lazy, Suspense, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Camera, CornerUpLeft, FileText, Image as ImageIcon, Mic, Paperclip, Pencil, SendHorizontal, Smile, X } from "lucide-react";
import { MAX_ATTACHMENTS, MAX_MESSAGE_LENGTH, type Message, type PublicUser } from "@chat/shared";
import { ActionDropdown } from "@/components/ui/ActionMenu";
import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/Button";
import { DOCUMENT_ACCEPT } from "@/lib/media";
import { AttachmentTray, toLocalFiles, type LocalFile } from "./AttachmentTray";
import { VoiceRecorder, voiceSupported } from "./VoiceRecorder";
import { Spinner } from "@/components/ui/Spinner";
import { useMe } from "@/features/auth/api";
import { useIsTouch, useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/cn";
import { getSocket } from "@/lib/socket";
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

/** Emits "typing" at most every 3s while typing, and "stopped" after 4s idle or on send. */
function useTypingSignal(chatId: string) {
  const lastSent = useRef(0);
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);

  const stop = () => {
    clearTimeout(idle.current);
    if (lastSent.current) getSocket()?.emit("typing", { chatId, isTyping: false });
    lastSent.current = 0;
  };
  useEffect(() => stop, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    ping() {
      const now = Date.now();
      if (now - lastSent.current > 3000) {
        getSocket()?.emit("typing", { chatId, isTyping: true });
        lastSent.current = now;
      }
      clearTimeout(idle.current);
      idle.current = setTimeout(stop, 4000);
    },
    stop,
  };
}

type ComposerProps = {
  chatId: string;
  onSend: (text: string) => void;
  replyTo: Message | null;
  onCancelReply: () => void;
  editing: Message | null;
  onCancelEdit: () => void;
  onSubmitEdit: (text: string) => void;
  /** ↑ in an empty composer edits your last message. */
  onEditLast: () => void;
  nameOf: (userId: string) => string;
  /** People who can be @mentioned here (group chats). Empty disables the autocomplete. */
  mentionable: PublicUser[];
  disabled?: boolean;
  /** When set, the composer is replaced by this explanation (e.g. admins-only group). */
  disabledReason?: string;
  /** Picked files waiting to be sent (owned by the conversation so drag-and-drop can add to them). */
  files: LocalFile[];
  onFilesChange: (files: LocalFile[]) => void;
  onSendVoice: (blob: Blob, durationMs: number, waveform: number[]) => void;
};

export function Composer(props: ComposerProps) {
  if (props.disabledReason) {
    return (
      <div className="shrink-0 border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-sm text-muted" role="status">
        {props.disabledReason}
      </div>
    );
  }
  return <ActiveComposer {...props} />;
}

function ActiveComposer({
  chatId,
  onSend,
  replyTo,
  onCancelReply,
  editing,
  onCancelEdit,
  onSubmitEdit,
  onEditLast,
  nameOf,
  mentionable,
  disabled,
  files,
  onFilesChange,
  onSendVoice,
}: ComposerProps) {
  const [recording, setRecording] = useState(false);
  const mediaInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const addFiles = (list: FileList | File[] | null) => {
    if (list?.length) onFilesChange([...files, ...toLocalFiles(Array.from(list), files.length)]);
  };
  const draft = useDrafts((s) => s.drafts[chatId] ?? "");
  const setDraft = useDrafts((s) => s.setDraft);
  const enterToSend = useMe().data?.settings.enterToSend ?? true;
  const touch = useIsTouch();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [editText, setEditText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const typing = useTypingSignal(chatId);

  // @mention autocomplete: an "@word" being typed immediately before the caret.
  const [mention, setMention] = useState<{ start: number; text: string } | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const suggestions = useMemo(() => {
    if (!mention || !mentionable.length) return [];
    const q = mention.text;
    return mentionable.filter((u) => u.username.includes(q) || u.displayName.toLowerCase().includes(q)).slice(0, 6);
  }, [mention, mentionable]);

  const detectMention = (text: string, caret: number | null) => {
    if (!mentionable.length || caret === null) return null;
    const m = /(?:^|\s)@([a-zA-Z0-9_]{0,24})$/.exec(text.slice(0, caret));
    if (!m) return null;
    setHighlighted(0);
    return { start: caret - m[1]!.length - 1, text: m[1]!.toLowerCase() };
  };

  const insertMention = (user: PublicUser) => {
    if (!mention) return;
    const end = mention.start + 1 + mention.text.length;
    const next = `${value.slice(0, mention.start)}@${user.username} ${value.slice(end)}`;
    setValue(next);
    setMention(null);
    const caret = mention.start + user.username.length + 2;
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const value = editing ? editText : draft;
  const setValue = (text: string) => (editing ? setEditText(text) : setDraft(chatId, text));

  // Entering edit mode loads the message; the draft is left untouched and comes back afterwards.
  useEffect(() => {
    if (!editing) return;
    setEditText(editing.body);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [editing]);

  useEffect(() => {
    if (replyTo) ref.current?.focus();
  }, [replyTo]);

  // Grow with content up to ~6 lines, then scroll.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  useEffect(() => {
    if (!touch) ref.current?.focus();
  }, [chatId, touch]);

  const hasFiles = files.length > 0 && !editing;
  const canSubmit = (value.trim().length > 0 || hasFiles) && !disabled;

  const submit = () => {
    const text = value.trim();
    if ((!text && !hasFiles) || disabled) return;
    if (editing) {
      if (text !== editing.body) onSubmitEdit(text);
      else onCancelEdit();
    } else {
      onSend(text);
      setDraft(chatId, "");
      typing.stop();
    }
    ref.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // The mention list takes the arrow, Enter/Tab and Escape keys while it's open.
    if (suggestions.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        return setHighlighted((i) => (i + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        return insertMention(suggestions[highlighted]!);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        return setMention(null);
      }
    }
    if (e.key === "Escape") {
      if (editing) return onCancelEdit();
      if (replyTo) return onCancelReply();
    }
    if (e.key === "ArrowUp" && !value && !editing && !touch) {
      e.preventDefault();
      return onEditLast();
    }
    // Enter sends with a keyboard; on touch devices Enter is a newline (use the send button).
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && enterToSend && !touch) {
      e.preventDefault();
      submit();
    }
  };

  const insertEmoji = (emoji: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    setValue(value.slice(0, start) + emoji + value.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
      if (!touch) el.focus();
    });
  };

  const context = editing
    ? { icon: Pencil, title: "Edit message", text: editing.body, cancel: onCancelEdit, cancelLabel: "Cancel editing" }
    : replyTo
      ? { icon: CornerUpLeft, title: `Replying to ${nameOf(replyTo.senderId)}`, text: replyTo.body, cancel: onCancelReply, cancelLabel: "Cancel reply" }
      : null;

  return (
    <div className="relative shrink-0 border-t border-border bg-surface px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:px-4">
      {emojiOpen && <EmojiPanel onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />}
      {suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label="Mention someone"
          className="absolute bottom-full left-2 z-20 mb-2 w-[min(20rem,calc(100%-1rem))] overflow-hidden rounded-2xl border border-border bg-surface py-1 shadow-pop md:left-4"
        >
          {suggestions.map((u, i) => (
            <li key={u.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlighted}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => insertMention(u)}
                onPointerEnter={() => setHighlighted(i)}
                className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left", i === highlighted && "bg-surface-2")}
              >
                <Avatar name={u.displayName} src={u.avatarUrl} seed={u.id} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{u.displayName}</span>
                <span className="shrink-0 truncate text-xs text-muted">@{u.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {context && (
        <div className="mb-2 flex animate-fade-in items-center gap-3 rounded-xl bg-surface-2 py-1.5 pr-1 pl-3">
          <context.icon className="size-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1 border-l-2 border-primary pl-2.5">
            <p className="text-xs font-semibold text-accent">{context.title}</p>
            <p className="truncate text-sm text-muted">{context.text}</p>
          </div>
          <IconButton label={context.cancelLabel} size="sm" onClick={context.cancel}>
            <X />
          </IconButton>
        </div>
      )}
      {!editing && <AttachmentTray files={files} onRemove={(id) => onFilesChange(files.filter((f) => f.id !== id))} />}
      <input ref={mediaInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
      <input ref={docInput} type="file" accept={DOCUMENT_ACCEPT} multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
      {recording ? (
        <VoiceRecorder
          onCancel={() => setRecording(false)}
          onSend={(blob, durationMs, waveform) => {
            setRecording(false);
            onSendVoice(blob, durationMs, waveform);
          }}
        />
      ) : (
      <div className="flex items-end gap-1.5">
        {!editing && (
          <ActionDropdown
            align="start"
            actions={[
              { id: "media", label: "Photos & videos", icon: ImageIcon, onSelect: () => mediaInput.current?.click() },
              { id: "camera", label: "Camera", icon: Camera, onSelect: () => cameraInput.current?.click(), hidden: !touch },
              { id: "doc", label: "Document", icon: FileText, onSelect: () => docInput.current?.click() },
            ]}
          >
            <IconButton label="Attach files" className="mb-0.5" disabled={files.length >= MAX_ATTACHMENTS}>
              <Paperclip />
            </IconButton>
          </ActionDropdown>
        )}
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
            {editing ? "Edit message" : "Message"}
          </label>
          <textarea
            id={id}
            ref={ref}
            rows={1}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setMention(detectMention(e.target.value, e.target.selectionStart));
              if (!editing && e.target.value) typing.ping();
            }}
            onClick={(e) => setMention(detectMention(value, e.currentTarget.selectionStart))}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              // Pasted screenshots/files go to the tray; pasted text behaves normally.
              if (!editing && e.clipboardData.files.length) {
                e.preventDefault();
                addFiles(e.clipboardData.files);
              }
            }}
            onBlur={() => {
              typing.stop();
              // Let a click on a suggestion land before the list disappears.
              setTimeout(() => setMention(null), 150);
            }}
            onFocus={() => touch && setEmojiOpen(false)}
            placeholder="Message"
            enterKeyHint={enterToSend && !touch ? "send" : "enter"}
            maxLength={MAX_MESSAGE_LENGTH}
            className="scrollbar-thin max-h-40 w-full resize-none bg-transparent text-base leading-6 outline-none placeholder:text-subtle focus-visible:outline-none md:text-[15px]"
          />
        </div>
        {!canSubmit && !editing && voiceSupported() ? (
          <IconButton variant="primary" size="lg" label="Record voice message" onClick={() => setRecording(true)}>
            <Mic />
          </IconButton>
        ) : (
          <IconButton
            variant="primary"
            size="lg"
            label={editing ? "Save edit" : "Send message"}
            disabled={!canSubmit}
            onClick={submit}
            // Keep focus in the textarea on mobile so the keyboard stays open after sending.
            onPointerDown={(e) => e.preventDefault()}
            className={cn("transition-transform", canSubmit ? "scale-100" : "scale-95")}
          >
            <SendHorizontal />
          </IconButton>
        )}
      </div>
      )}
    </div>
  );
}
