import { baseMime } from "@chat/shared";

const ascii = (buf: Buffer, start: number, end: number) => buf.subarray(start, end).toString("latin1");
const hex = (buf: Buffer, n: number) => buf.subarray(0, n).toString("hex");

/** Identifies a file family from its leading bytes. Returns null when unknown (e.g. plain text). */
export function sniff(buf: Buffer): string | null {
  if (hex(buf, 3) === "ffd8ff") return "jpeg";
  if (hex(buf, 8) === "89504e470d0a1a0a") return "png";
  if (["GIF87a", "GIF89a"].includes(ascii(buf, 0, 6))) return "gif";
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return "webp";
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WAVE") return "wav";
  if (ascii(buf, 0, 5) === "%PDF-") return "pdf";
  if (hex(buf, 4) === "1a45dfa3") return "ebml"; // Matroska / WebM (audio or video)
  if (ascii(buf, 4, 8) === "ftyp") return "isobmff"; // MP4 / MOV / M4A
  if (ascii(buf, 0, 4) === "OggS") return "ogg";
  if (ascii(buf, 0, 3) === "ID3" || (buf[0] === 0xff && ((buf[1] ?? 0) & 0xe0) === 0xe0)) return "mpeg-audio"; // MP3 / ADTS AAC
  if (hex(buf, 4) === "504b0304") return "zip"; // also DOCX / XLSX / PPTX
  if (hex(buf, 8) === "d0cf11e0a1b11ae1") return "cfb"; // legacy Office
  return null;
}

const FAMILY: Record<string, string[]> = {
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  gif: ["image/gif"],
  webp: ["image/webp"],
  wav: ["audio/wav"],
  pdf: ["application/pdf"],
  ebml: ["video/webm", "audio/webm"],
  isobmff: ["video/mp4", "video/quicktime", "audio/mp4", "audio/x-m4a", "audio/aac"],
  ogg: ["audio/ogg"],
  "mpeg-audio": ["audio/mpeg", "audio/aac"],
  zip: [
    "application/zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  cfb: ["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"],
};

const TEXT_TYPES = ["text/plain", "text/csv", "application/json"];

/**
 * Does the declared type agree with the bytes? Stops e.g. an HTML page or executable
 * being uploaded as "image/png". Text types have no signature, so they must simply
 * contain no NUL bytes.
 */
export function contentMatches(declared: string, buf: Buffer) {
  const mime = baseMime(declared);
  const family = sniff(buf);
  if (!family) return TEXT_TYPES.includes(mime) && !buf.subarray(0, 4096).includes(0);
  return FAMILY[family]?.includes(mime) ?? false;
}
