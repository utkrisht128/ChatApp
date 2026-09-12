import { useQuery } from "@tanstack/react-query";
import { firstLink, type LinkPreview } from "@chat/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

/**
 * Previews are fetched by the server (see safeFetch) and cached there, so the reader's
 * browser never contacts the linked site — a link in a chat can't be used to log who read it.
 */
function useLinkPreview(url: string | null) {
  return useQuery({
    queryKey: ["link-preview", url],
    queryFn: ({ signal }) =>
      api<{ preview: LinkPreview | null }>(`/links/preview?url=${encodeURIComponent(url!)}`, { signal }).then((r) => r.preview),
    enabled: Boolean(url),
    staleTime: Infinity,
    // A link that can't be previewed shouldn't be retried on every render.
    retry: false,
  });
}

export function LinkPreviewCard({ body, mine }: { body: string; mine: boolean }) {
  const url = firstLink(body);
  const { data: preview } = useLinkPreview(url);
  if (!url || !preview) return null;

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "mt-1 mb-0.5 flex flex-col gap-0.5 rounded-lg border-l-[3px] px-2.5 py-1.5 no-underline",
        mine ? "border-white/70 bg-white/15" : "border-primary bg-primary-soft",
      )}
    >
      <span className={cn("truncate text-xs font-semibold", mine ? "text-white/90" : "text-accent")}>
        {preview.siteName || preview.host}
      </span>
      <span className="line-clamp-2 text-sm font-medium">{preview.title}</span>
      {preview.description && <span className="line-clamp-2 text-xs opacity-80">{preview.description}</span>}
    </a>
  );
}
