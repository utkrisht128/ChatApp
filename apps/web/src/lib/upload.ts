import type { ApiResponse, FileKind, UploadedFile, UploadPurpose } from "@chat/shared";
import { ApiError } from "./api";

type UploadParams = { purpose: UploadPurpose; kind: FileKind; chatId?: string; name: string };

/**
 * Uploads raw bytes to POST /api/files. Uses XHR (not fetch) because only XHR reports
 * upload progress in every browser.
 */
export function uploadBlob(
  blob: Blob,
  params: UploadParams,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] != null));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/files?${qs}`);
    xhr.withCredentials = true;
    xhr.timeout = 180_000;
    xhr.setRequestHeader("X-Requested-With", "chatapp");
    xhr.setRequestHeader("Content-Type", blob.type || "application/octet-stream");

    xhr.upload.onprogress = (e) => e.lengthComputable && opts.onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let json: ApiResponse<{ file: UploadedFile }> | null = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        /* proxy/gateway page */
      }
      if (json?.success) return resolve(json.data.file);
      if (json && !json.success) return reject(new ApiError(xhr.status, json.error.code, json.error.message));
      reject(new ApiError(xhr.status, "INTERNAL_ERROR", xhr.status === 413 ? "That file is too large." : "Upload failed. Please try again."));
    };
    xhr.onerror = () => reject(new ApiError(0, "NETWORK_ERROR", "Upload failed — check your connection."));
    xhr.ontimeout = () => reject(new ApiError(0, "TIMEOUT", "The upload took too long. Please try again."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    if (opts.signal?.aborted) return xhr.abort();
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}
