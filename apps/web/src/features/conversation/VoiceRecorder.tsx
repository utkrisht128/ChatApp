import { useEffect, useRef, useState } from "react";
import { SendHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatDuration, MAX_VOICE_MS } from "@chat/shared";
import { IconButton } from "@/components/ui/Button";

const MIME_PREFERENCE = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];

export const voiceSupported = () =>
  typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

function micError(err: unknown) {
  const name = (err as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access is blocked. Allow it in your browser's site settings to record voice messages.";
  if (name === "NotFoundError") return "No microphone was found.";
  if (name === "NotReadableError") return "Your microphone is being used by another app.";
  return "Couldn't start recording.";
}

/** Downsamples recorded levels to `n` bars scaled 0–255 for the waveform. */
function toWaveform(levels: number[], n = 48) {
  if (!levels.length) return [];
  const peak = Math.max(...levels, 0.01);
  return Array.from({ length: n }, (_, i) => {
    const slice = levels.slice(Math.floor((i / n) * levels.length), Math.max(Math.floor(((i + 1) / n) * levels.length), Math.floor((i / n) * levels.length) + 1));
    return Math.round((Math.max(...slice) / peak) * 255);
  });
}

/**
 * Replaces the composer row while recording: cancel · ● timer · live waveform · send.
 * Tap-to-record (rather than hold) so it works with keyboards and assistive tech.
 */
export function VoiceRecorder({ onCancel, onSend }: { onCancel: () => void; onSend: (blob: Blob, durationMs: number, waveform: number[]) => void }) {
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const allLevels = useRef<number[]>([]);
  const sendOnStop = useRef(false);
  const started = useRef(0);
  const cleanup = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const mimeType = MIME_PREFERENCE.find((m) => MediaRecorder.isTypeSupported(m));
        const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
        recorder.current = rec;

        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);

        rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
        rec.onstop = () => {
          const durationMs = Date.now() - started.current;
          if (sendOnStop.current && durationMs > 500) {
            onSend(new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }), durationMs, toWaveform(allLevels.current));
          }
        };
        started.current = Date.now();
        rec.start(250);

        const tick = setInterval(() => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += ((v - 128) / 128) ** 2;
          const rms = Math.sqrt(sum / buf.length);
          allLevels.current.push(rms);
          setLevels((l) => [...l.slice(-39), rms]);
          const ms = Date.now() - started.current;
          setElapsed(ms);
          if (ms >= MAX_VOICE_MS) stop(true);
        }, 100);

        // Runs from both stop() and unmount, so it must be safe to call twice.
        cleanup.current = () => {
          cleanup.current = () => {};
          clearInterval(tick);
          stream.getTracks().forEach((t) => t.stop());
          if (ctx.state !== "closed") void ctx.close().catch(() => {});
        };
      } catch (err) {
        toast.error(micError(err));
        onCancel();
      }
    })();
    return () => {
      cancelled = true;
      sendOnStop.current = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
      cleanup.current();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = (send: boolean) => {
    sendOnStop.current = send;
    if (recorder.current?.state === "recording") recorder.current.stop();
    cleanup.current();
    if (!send) onCancel();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stop(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex items-center gap-2" role="group" aria-label="Recording voice message">
      <IconButton label="Cancel recording" onClick={() => stop(false)} className="text-danger hover:text-danger">
        <Trash2 />
      </IconButton>
      <div className="flex min-h-11 flex-1 items-center gap-3 rounded-3xl bg-surface-2 px-4">
        <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden />
        <span className="w-10 shrink-0 text-sm font-medium tabular-nums" aria-live="off">
          {formatDuration(elapsed)}
        </span>
        <span className="flex h-6 flex-1 items-center justify-end gap-[2px] overflow-hidden" aria-hidden>
          {levels.map((v, i) => (
            <span key={i} className="w-[3px] shrink-0 rounded-full bg-primary" style={{ height: `${Math.max(10, Math.min(100, v * 400))}%` }} />
          ))}
        </span>
      </div>
      <IconButton variant="primary" size="lg" label="Send voice message" onClick={() => stop(true)}>
        <SendHorizontal />
      </IconButton>
    </div>
  );
}
