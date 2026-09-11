import { cn } from "@/lib/cn";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--primary)" />
      <path d="M8.5 12a4 4 0 0 1 4-4h7a4 4 0 0 1 4 4v4.5a4 4 0 0 1-4 4H15l-4.4 3.4c-.7.5-1.6 0-1.6-.8v-2.9a4 4 0 0 1-.5-2z" fill="#fff" />
      <circle cx="12.75" cy="14.25" r="1.25" fill="var(--primary)" />
      <circle cx="16" cy="14.25" r="1.25" fill="var(--primary)" />
      <circle cx="19.25" cy="14.25" r="1.25" fill="var(--primary)" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className="size-9" />
      <span className="text-xl font-bold tracking-tight">ChatApp</span>
    </span>
  );
}
