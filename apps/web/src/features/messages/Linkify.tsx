import { Fragment } from "react";

// http(s) and www. links only, so nothing like `javascript:` can ever become a link.
// Trailing punctuation is left out of the match ("see example.com." → link without the dot).
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>]+[^\s<>.,:;"'!?)\]}])/gi;

export function Linkify({ text, linkClassName }: { text: string; linkClassName?: string }) {
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
