import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, Download, FileArchive, FileSpreadsheet, FileText, File as FileIcon, Pause, Play, X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { formatBytes, formatDuration, type Attachment } from "@chat/shared";
import { IconButton } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { PendingAttachment } from "@/stores/outbox";

const isMedia = (a: Attachment) => a.kind === "image" || a.kind === "video";
const downloadUrl = (a: Attachment) => (a.url.startsWith("blob:") ? a.url : `${a.url}?download`);

/** Circular upload progress for pending media. */
function Progress({ value }: { value: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <span className="absolute inset-0 grid place-items-center bg-black/35" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Uploading">
      <svg viewBox="0 0 44 44" className="size-11 -rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" stroke="white" strokeOpacity=".3" strokeWidth="3" />
        <circle cx="22" cy="22" r={r} fill="none" stroke="white" strokeWidth="3" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0.03, value))} strokeLinecap="round" className="transition-[stroke-dashoffset]" />
      </svg>
    </span>
  );
}

function MediaTile({
  a,
  onOpen,
  progress,
  className,
  overlay,
  style,
}: {
  a: Attachment;
  onOpen: () => void;
  progress?: number;
  className?: string;
  overlay?: string;
  style?: CSSProperties;
}) {
  const [loaded, setLoaded] = useState(false);
  const src = a.kind === "video" ? (a.thumbUrl ?? undefined) : a.url || undefined;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={a.kind === "video" ? `Play video${a.durationMs ? `, ${formatDuration(a.durationMs)}` : ""}` : "View photo"}
      className={cn("relative block overflow-hidden bg-black/10 bg-cover bg-center", className)}
      style={{ ...style, ...(a.placeholder && !loaded ? { backgroundImage: `url(${a.placeholder})` } : {}) }}
    >
      {src && (
        <img src={src} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(true)} className={cn("size-full object-cover transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0")} />
      )}
      {a.kind === "video" && !src && a.url && <video src={a.url} muted playsInline preload="metadata" className="size-full object-cover" />}
      {a.kind === "video" && progress === undefined && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-12 place-items-center rounded-full bg-black/50 text-white backdrop-blur">
            <Play className="size-6 translate-x-0.5 fill-current" />
          </span>
          {a.durationMs !== undefined && <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/55 px-1.5 text-[11px] text-white">{formatDuration(a.durationMs)}</span>}
        </span>
      )}
      {overlay && <span className="absolute inset-0 grid place-items-center bg-black/45 text-2xl font-semibold text-white">{overlay}</span>}
      {progress !== undefined && progress < 1 && <Progress value={progress} />}
    </button>
  );
}

/** 2 → side by side; 3 → one wide + two; 4+ → 2×2 with "+N". */
export function MediaGrid({ items, onOpen, progressOf }: { items: Attachment[]; onOpen: (i: number) => void; progressOf: (id: string) => number | undefined }) {
  const shown = items.slice(0, 4);
  return (
    <div className="grid w-[min(320px,70vw)] max-w-full grid-cols-2 gap-0.5 overflow-hidden rounded-xl">
      {shown.map((a, i) => (
        <MediaTile
          key={a.id}
          a={a}
          onOpen={() => onOpen(i)}
          progress={progressOf(a.id)}
          className={cn("aspect-square", items.length === 3 && i === 0 && "col-span-2 aspect-[2/1]")}
          overlay={i === 3 && items.length > 4 ? `+${items.length - 4}` : undefined}
        />
      ))}
    </div>
  );
}

/**
 * A single photo/video keeps its own shape (clamped between 1:2 and 2:1), with space reserved
 * from the stored dimensions so nothing jumps when it loads.
 */
export function SingleMedia({ a, onOpen, progress }: { a: Attachment; onOpen: () => void; progress?: number }) {
  const ratio = a.width && a.height ? Math.min(2, Math.max(0.5, a.width / a.height)) : 4 / 3;
  return <MediaTile a={a} onOpen={onOpen} progress={progress} className="w-[min(320px,70vw)] max-w-full rounded-xl" style={{ aspectRatio: String(ratio) }} />;
}

/* ── Lightbox ──────────────────────────────────────────────────────────── */

export function Lightbox({ items, index, onClose }: { items: Attachment[]; index: number | null; onClose: () => void }) {
  const [i, setI] = useState(index ?? 0);
  const start = useRef<number | null>(null);
  useEffect(() => void (index !== null && setI(index)), [index]);
  const a = items[i];
  const go = (d: number) => setI((v) => (v + d + items.length) % items.length);

  return (
    <D.Root open={index !== null} onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        {/* Solid black: the photo is the only thing that should be visible. */}
        <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black" />
        <D.Content
          aria-describedby={undefined}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "ArrowRight") go(1);
            if (e.key === "ArrowLeft") go(-1);
          }}
          className="fixed inset-0 z-50 flex flex-col text-white outline-none"
        >
          <div className="flex h-14 shrink-0 items-center justify-between px-2 pt-safe">
            <D.Title className="px-2 text-sm font-medium">{items.length > 1 ? `${i + 1} of ${items.length}` : a?.kind === "video" ? "Video" : "Photo"}</D.Title>
            <div className="flex items-center">
              {a && (
                <a href={downloadUrl(a)} download={a.name} aria-label="Download" className="grid size-10 place-items-center rounded-full text-white/85 hover:bg-white/10 hover:text-white">
                  <Download className="size-5" />
                </a>
              )}
              <D.Close asChild>
                <IconButton label="Close" className="text-white/85 hover:bg-white/10 hover:text-white">
                  <X />
                </IconButton>
              </D.Close>
            </div>
          </div>
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center p-2 touch-pan-y"
            onPointerDown={(e: PointerEvent) => void (start.current = e.clientX)}
            onPointerUp={(e: PointerEvent) => {
              if (start.current !== null && items.length > 1 && Math.abs(e.clientX - start.current) > 60) go(e.clientX < start.current ? 1 : -1);
              start.current = null;
            }}
          >
            {a?.kind === "video" ? (
              <video key={a.id} src={a.url} controls autoPlay playsInline className="max-h-full max-w-full" />
            ) : a ? (
              <img key={a.id} src={a.url} alt={a.name} className="max-h-full max-w-full object-contain select-none" draggable={false} />
            ) : null}
            {items.length > 1 && (
              <>
                <IconButton label="Previous" onClick={() => go(-1)} className="absolute left-2 bg-black/40 text-white hover:bg-black/60 hover:text-white max-sm:hidden">
                  <ChevronLeft />
                </IconButton>
                <IconButton label="Next" onClick={() => go(1)} className="absolute right-2 bg-black/40 text-white hover:bg-black/60 hover:text-white max-sm:hidden">
                  <ChevronRight />
                </IconButton>
              </>
            )}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/* ── Audio / voice ─────────────────────────────────────────────────────── */

let nowPlaying: HTMLAudioElement | null = null;
const RATES = [1, 1.5, 2];
const FLAT = Array.from({ length: 40 }, (_, i) => 60 + ((i * 37) % 90));

function resample(values: number[], n: number) {
  if (values.length === n) return values;
  return Array.from({ length: n }, (_, i) => values[Math.floor((i / n) * values.length)] ?? 0);
}

export function AudioPlayer({ a, mine, progress }: { a: Attachment; mine: boolean; progress?: number }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState((a.durationMs ?? 0) / 1000);
  const [rate, setRate] = useState(1);
  const bars = resample(a.waveform?.length ? a.waveform : FLAT, 40);
  const fraction = duration ? Math.min(1, time / duration) : 0;
  const uploading = progress !== undefined && progress < 1;

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      // One thing plays at a time.
      if (nowPlaying && nowPlaying !== el) nowPlaying.pause();
      nowPlaying = el;
      void el.play();
    } else el.pause();
  };
  const seek = (f: number) => {
    const el = ref.current;
    if (el && duration) el.currentTime = Math.max(0, Math.min(duration, f * duration));
  };
  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]!;
    setRate(next);
    if (ref.current) ref.current.playbackRate = next;
  };

  return (
    <div className="flex w-[min(270px,62vw)] items-center gap-2.5 py-1">
      <button
        type="button"
        onClick={toggle}
        disabled={!a.url || uploading}
        aria-label={playing ? "Pause" : a.kind === "voice" ? "Play voice message" : `Play ${a.name}`}
        className={cn("relative grid size-10 shrink-0 place-items-center rounded-full disabled:opacity-60", mine ? "bg-white text-bubble-out" : "bg-primary text-primary-fg")}
      >
        {playing ? <Pause className="size-5 fill-current" /> : <Play className="size-5 translate-x-px fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        {a.kind === "audio" && <p className="truncate text-sm font-medium">{a.name}</p>}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Playback position"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${formatDuration(time * 1000)} of ${formatDuration(duration * 1000)}`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            seek((e.clientX - r.left) / r.width);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") seek((time + 5) / duration);
            if (e.key === "ArrowLeft") seek((time - 5) / duration);
          }}
          className="flex h-7 cursor-pointer items-center gap-[2px]"
        >
          {bars.map((v, i) => (
            <span
              key={i}
              className={cn(
                "w-[3px] flex-1 rounded-full",
                i / bars.length < fraction ? (mine ? "bg-white" : "bg-primary") : mine ? "bg-white/40" : "bg-border-strong",
              )}
              style={{ height: `${Math.max(12, (v / 255) * 100)}%` }}
            />
          ))}
        </div>
        <div className={cn("mt-0.5 flex items-center justify-between text-[11px]", mine ? "text-bubble-out-muted" : "text-bubble-in-muted")}>
          <span>{uploading ? `Uploading ${Math.round((progress ?? 0) * 100)}%` : formatDuration((playing || time ? time : duration) * 1000)}</span>
          {a.kind === "voice" && (
            <button type="button" onClick={cycleRate} className="rounded-full bg-black/10 px-1.5 font-semibold" aria-label={`Playback speed ${rate}×`}>
              {rate}×
            </button>
          )}
        </div>
      </div>
      <audio
        ref={ref}
        src={a.url || undefined}
        preload="metadata"
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => (setPlaying(false), setTime(0))}
      />
    </div>
  );
}

/* ── Documents ─────────────────────────────────────────────────────────── */

function iconFor(mime: string) {
  if (mime.includes("zip")) return FileArchive;
  if (mime.includes("sheet") || mime.includes("excel") || mime === "text/csv") return FileSpreadsheet;
  if (mime.startsWith("text/") || mime.includes("pdf") || mime.includes("word")) return FileText;
  return FileIcon;
}

export function FileCard({ a, mine, progress }: { a: Attachment; mine: boolean; progress?: number }) {
  const Icon = iconFor(a.mime);
  const ext = a.name.includes(".") ? a.name.split(".").pop()!.toUpperCase() : "";
  const uploading = progress !== undefined && progress < 1;
  const body = (
    <>
      <span className={cn("grid size-11 shrink-0 place-items-center rounded-lg", mine ? "bg-white/20" : "bg-primary-soft text-accent")}>
        <Icon className="size-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{a.name}</span>
        <span className={cn("block text-xs", mine ? "text-bubble-out-muted" : "text-bubble-in-muted")}>
          {uploading ? `Uploading ${Math.round((progress ?? 0) * 100)}%` : [formatBytes(a.size), ext].filter(Boolean).join(" · ")}
        </span>
        {uploading && (
          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-black/15">
            <span className={cn("block h-full rounded-full transition-[width]", mine ? "bg-white" : "bg-primary")} style={{ width: `${(progress ?? 0) * 100}%` }} />
          </span>
        )}
      </span>
      {!uploading && a.url && <Download className="size-5 shrink-0 opacity-70" />}
    </>
  );
  const cls = cn("flex w-[min(280px,65vw)] items-center gap-3 rounded-xl p-2", mine ? "bg-white/10 hover:bg-white/15" : "bg-surface-2 hover:bg-surface-3");
  return uploading || !a.url ? (
    <div className={cls}>{body}</div>
  ) : (
    <a href={downloadUrl(a)} download={a.name} className={cls} aria-label={`Download ${a.name}, ${formatBytes(a.size)}`}>
      {body}
    </a>
  );
}

/* ── Composition ───────────────────────────────────────────────────────── */

export function AttachmentsView({ attachments, mine, pending }: { attachments: Attachment[]; mine: boolean; pending?: PendingAttachment[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const media = attachments.filter(isMedia);
  const others = attachments.filter((a) => !isMedia(a));
  const progressOf = (id: string) => pending?.find((p) => p.localId === id)?.progress;

  return (
    <div className="flex flex-col gap-1.5">
      {media.length === 1 ? (
        <SingleMedia a={media[0]!} onOpen={() => setOpen(0)} progress={progressOf(media[0]!.id)} />
      ) : media.length > 1 ? (
        <MediaGrid items={media} onOpen={setOpen} progressOf={progressOf} />
      ) : null}
      {others.map((a) =>
        a.kind === "voice" || a.kind === "audio" ? (
          <AudioPlayer key={a.id} a={a} mine={mine} progress={progressOf(a.id)} />
        ) : (
          <FileCard key={a.id} a={a} mine={mine} progress={progressOf(a.id)} />
        ),
      )}
      {media.length > 0 && <Lightbox items={media} index={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
