import { ALLOWED_MIME, baseMime, type FileKind } from "@chat/shared";

const MAX_IMAGE_DIM = 1600;
const POSTER_DIM = 640;

const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

export const DOCUMENT_ACCEPT = Object.keys(EXT_MIME)
  .map((e) => `.${e}`)
  .join(",");

/**
 * Decides how a picked file is sent, or returns null if it isn't allowed.
 * Some systems report no type (or a vague one) for documents, so the extension fills in.
 */
export function classify(file: File): { file: File; kind: FileKind } | null {
  let mime = baseMime(file.type);
  if (!mime || mime === "application/octet-stream") mime = EXT_MIME[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? mime;
  for (const kind of ["image", "video", "audio", "file"] as const) {
    if (ALLOWED_MIME[kind].includes(mime)) return { file: mime === file.type ? file : new File([file], file.name, { type: mime }), kind };
  }
  return null;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

function canvasOf(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  return { canvas, ctx };
}

/** ~1 KB blurred preview shown while the real image loads (no layout shift, no blank box). */
function placeholderOf(source: CanvasImageSource, w: number, h: number) {
  const pw = 16;
  const ph = Math.max(1, Math.round((h / w) * pw));
  const { canvas, ctx } = canvasOf(pw, ph);
  ctx.drawImage(source, 0, 0, pw, ph);
  return canvas.toDataURL("image/jpeg", 0.5);
}

async function encode(canvas: HTMLCanvasElement) {
  // WebP where the browser can encode it (it silently falls back to PNG otherwise), else JPEG.
  const webp = await toBlob(canvas, "image/webp", 0.82);
  if (webp?.type === "image/webp") return webp;
  const jpeg = await toBlob(canvas, "image/jpeg", 0.85);
  if (!jpeg) throw new Error("Couldn't encode image");
  return jpeg;
}

export type PreparedImage = { blob: Blob; width: number; height: number; placeholder?: string };

/** Downscales to ≤1600px and re-encodes (respecting EXIF orientation). GIFs are kept as-is to stay animated. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { width, height } = bitmap;
    const placeholder = placeholderOf(bitmap, width, height);
    if (file.type === "image/gif") return { blob: file, width, height, placeholder };

    const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(width, height));
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const { canvas, ctx } = canvasOf(w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await encode(canvas);
    // Already small and efficient? Keep the original bytes.
    return blob.size >= file.size && scale === 1 ? { blob: file, width, height, placeholder } : { blob, width: w, height: h, placeholder };
  } finally {
    bitmap.close();
  }
}

function once(el: HTMLMediaElement, event: string, timeoutMs = 10_000) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    el.addEventListener(event, () => (clearTimeout(t), resolve()), { once: true });
    el.addEventListener("error", () => (clearTimeout(t), reject(new Error("Media could not be read"))), { once: true });
  });
}

export type PreparedVideo = { width?: number; height?: number; durationMs?: number; poster?: Blob; placeholder?: string };

/** Reads dimensions/duration and grabs an early frame as the poster. Best effort: failures just skip the poster. */
export async function prepareVideo(file: File): Promise<PreparedVideo> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await once(video, "loadedmetadata");
    const durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined;
    const { videoWidth: vw, videoHeight: vh } = video;
    if (!vw || !vh) return { durationMs };
    video.currentTime = Math.min(0.1, (video.duration || 0) / 2);
    await once(video, "seeked");
    const scale = Math.min(1, POSTER_DIM / Math.max(vw, vh));
    const { canvas, ctx } = canvasOf(Math.round(vw * scale), Math.round(vh * scale));
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const poster = (await toBlob(canvas, "image/jpeg", 0.72)) ?? undefined;
    return { width: vw, height: vh, durationMs, poster, placeholder: placeholderOf(canvas, canvas.width, canvas.height) };
  } catch {
    return {};
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function mediaDuration(file: Blob): Promise<number | undefined> {
  const url = URL.createObjectURL(file);
  const audio = new Audio();
  audio.preload = "metadata";
  audio.src = url;
  try {
    await once(audio, "loadedmetadata", 5000);
    return Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined;
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Centre-crops to a 512px square for profile and group photos. */
export async function squarePhoto(file: File, size = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const { canvas, ctx } = canvasOf(size, size);
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    return encode(canvas);
  } finally {
    bitmap.close();
  }
}
