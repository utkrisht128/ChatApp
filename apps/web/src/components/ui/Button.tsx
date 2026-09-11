import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

const variants = {
  primary: "bg-primary text-primary-fg hover:bg-primary-hover shadow-sm",
  secondary: "bg-surface-2 text-fg hover:bg-surface-3",
  outline: "border border-border-strong bg-transparent text-fg hover:bg-surface-2",
  ghost: "bg-transparent text-fg hover:bg-surface-2",
  danger: "bg-danger-solid text-white hover:opacity-90",
  "danger-ghost": "bg-transparent text-danger hover:bg-danger-soft",
};

const sizes = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-sm",
  md: "h-10 gap-2 rounded-xl px-4 text-sm",
  lg: "h-12 gap-2 rounded-xl px-5 text-base",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

export function Button({ variant = "primary", size = "md", loading, disabled, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center justify-center font-semibold whitespace-nowrap transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-55",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

const iconSizes = { sm: "size-8", md: "size-10", lg: "size-11" };
const iconVariants = {
  ghost: "text-muted hover:bg-surface-2 hover:text-fg",
  primary: "bg-primary text-primary-fg hover:bg-primary-hover",
  secondary: "bg-surface-2 text-fg hover:bg-surface-3",
};

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  /** Required: icon-only buttons need an accessible name. */
  label: string;
  size?: keyof typeof iconSizes;
  variant?: keyof typeof iconVariants;
  ref?: Ref<HTMLButtonElement>;
};

export function IconButton({ label, size = "md", variant = "ghost", className, children, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full transition-colors [&_svg]:size-5",
        "disabled:cursor-not-allowed disabled:opacity-45",
        iconSizes[size],
        iconVariants[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
