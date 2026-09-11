import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

// Every colour has ≥ 4.5:1 contrast with white initials.
const PALETTE = ["#b91c1c", "#c2410c", "#4d7c0f", "#047857", "#0e7490", "#1d4ed8", "#6d28d9", "#a21caf", "#be185d"];

const SIZES = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
  xl: "size-20 text-2xl",
  "2xl": "size-28 text-4xl",
};

// Same hues, lightened for text on dark bubbles (≥ 4.5:1 on the dark incoming bubble).
const PALETTE_ON_DARK = ["#f87171", "#fb923c", "#a3e635", "#34d399", "#22d3ee", "#60a5fa", "#a78bfa", "#e879f9", "#f472b6"];

export function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Stable per-person colour for sender names in group chats; matches their avatar hue. */
export const nameColor = (seed: string, theme: "light" | "dark") => (theme === "dark" ? PALETTE_ON_DARK : PALETTE)[hash(seed) % PALETTE.length];

type AvatarProps = {
  name: string;
  src?: string | null;
  /** Stable id so a person's colour never changes when they rename. */
  seed?: string;
  size?: keyof typeof SIZES;
  online?: boolean;
  className?: string;
};

/** Decorative by default — the name is always rendered next to it. */
export function Avatar({ name, src, seed, size = "md", online, className }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const showImage = Boolean(src) && !failed;

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        aria-hidden
        className={cn("inline-flex select-none items-center justify-center overflow-hidden rounded-full font-semibold text-white", SIZES[size])}
        style={showImage ? undefined : { backgroundColor: PALETTE[hash(seed ?? name) % PALETTE.length] }}
      >
        {showImage ? (
          <img src={src!} alt="" loading="lazy" decoding="async" className="size-full object-cover" onError={() => setFailed(true)} />
        ) : (
          initials(name)
        )}
      </span>
      {online && (
        <span className="absolute right-0 bottom-0 block size-[28%] min-h-2.5 min-w-2.5 rounded-full bg-online ring-2 ring-surface">
          <span className="sr-only">Online</span>
        </span>
      )}
    </span>
  );
}
