import type { ComponentType, ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

type Icon = ComponentType<{ className?: string }>;

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: Icon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      {Icon && (
        <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-primary-soft text-accent">
          <Icon className="size-7" />
        </div>
      )}
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      {description && <p className="mt-1.5 max-w-xs text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  error,
  onRetry,
  className,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-danger-soft text-danger">
        <AlertTriangle className="size-7" />
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1.5 max-w-xs text-sm text-muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-5" onClick={onRetry}>
          <RotateCw className="size-4" /> Try again
        </Button>
      )}
    </div>
  );
}
