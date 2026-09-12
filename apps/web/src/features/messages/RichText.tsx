import { Fragment } from "react";
import { mentionParts } from "@chat/shared";
import { cn } from "@/lib/cn";

// http(s) and www. links only, so nothing like `javascript:` can ever become a link.
// Trailing punctuation is left out of the match ("see example.com." → link without the dot).
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>]+[^\s<>.,:;"'!?)\]}])/gi;

export type MentionLookup = (username: string) => { id: string; isMe: boolean } | null;

function Links({ text, linkClassName }: { text: string; linkClassName?: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={/^https?:\/\//i.test(part) ? part : `https://${part}`}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={linkClassName}
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * Message body: links, plus `@username` highlighted when it names someone actually in the
 * chat. `mentionOf` resolves a username against the current members, so a stale or invented
 * @name renders as ordinary text — matching what the server stored.
 */
export function RichText({
  text,
  mine,
  mentionOf,
  onMentionClick,
}: {
  text: string;
  mine?: boolean;
  mentionOf?: MentionLookup;
  onMentionClick?: (userId: string) => void;
}) {
  const linkClassName = cn("underline underline-offset-2", mine ? "text-white" : "text-accent");
  if (!mentionOf) return <Links text={text} linkClassName={linkClassName} />;

  return (
    <>
      {mentionParts(text).map(([chunk, username], i) => {
        const hit = username ? mentionOf(username) : null;
        if (!hit) return <Links key={i} text={chunk} linkClassName={linkClassName} />;
        return (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMentionClick?.(hit.id);
            }}
            className={cn(
              "rounded font-semibold",
              hit.isMe && (mine ? "bg-white/25 px-0.5" : "bg-primary-soft px-0.5"),
              mine ? "text-white" : "text-accent",
            )}
          >
            {chunk}
          </button>
        );
      })}
    </>
  );
}
