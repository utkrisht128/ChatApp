import { useEffect, useMemo } from "react";
import { FileText, Music, Play, X } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_MAX_UPLOAD_BYTES, formatBytes, MAX_ATTACHMENTS, type FileKind } from "@chat/shared";
import { classify } from "@/lib/media";

export type LocalFile = { id: string; file: File; kind: FileKind };

/**
 * Validates picked/dropped/pasted files, explaining anything that's skipped.
 * Photos may start large — they're compressed before upload.
 */
export function toLocalFiles(list: Iterable<File>, alreadyPicked: number): LocalFile[] {
  const out: LocalFile[] = [];
  for (const f of list) {
    if (alreadyPicked + out.length >= MAX_ATTACHMENTS) {
      toast.error(`You can send up to ${MAX_ATTACHMENTS} files at once`);
      break;
    }
    const c = classify(f);
    if (!c) {
      toast.error(`“${f.name}” isn't a supported file type`);
      continue;
    }
    if (c.kind !== "image" && f.size > DEFAULT_MAX_UPLOAD_BYTES) {
      toast.error(`“${f.name}” is larger than 8 MB`);
      continue;
    }
    out.push({ id: crypto.randomUUID(), file: c.file, kind: c.kind });
  }
  return out;
}

function Thumb({ f }: { f: LocalFile }) {
  const url = useMemo(() => (f.kind === "image" || f.kind === "video" ? URL.createObjectURL(f.file) : null), [f]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  if (f.kind === "image" && url) return <img src={url} alt="" className="size-full object-cover" />;
  if (f.kind === "video" && url)
    return (
      <span className="relative block size-full">
        <video src={url} muted playsInline preload="metadata" className="size-full object-cover" />
        <Play className="absolute inset-0 m-auto size-5 fill-white text-white drop-shadow" />
      </span>
    );
  const Icon = f.kind === "audio" ? Music : FileText;
  return (
    <span className="flex size-full flex-col items-center justify-center gap-1 p-1 text-center">
      <Icon className="size-5 text-accent" />
      <span className="line-clamp-2 text-[10px] leading-tight break-all text-muted">{f.file.name}</span>
    </span>
  );
}

/** Picked files waiting to be sent, above the composer. The message text becomes the caption. */
export function AttachmentTray({ files, onRemove }: { files: LocalFile[]; onRemove: (id: string) => void }) {
  if (!files.length) return null;
  const total = files.reduce((n, f) => n + f.file.size, 0);
  return (
    <div className="mb-2 animate-fade-in">
      <ul aria-label="Attachments to send" className="flex gap-2 overflow-x-auto pb-1">
        {files.map((f) => (
          <li key={f.id} className="relative size-20 shrink-0 overflow-hidden rounded-xl border border-border bg-surface-2">
            <Thumb f={f} />
            <button
              type="button"
              onClick={() => onRemove(f.id)}
              aria-label={`Remove ${f.file.name}`}
              className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        {files.length} file{files.length === 1 ? "" : "s"} · {formatBytes(total)} · photos are compressed before sending
      </p>
    </div>
  );
}
