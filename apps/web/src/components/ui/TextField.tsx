import { useId, useState, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./Button";

export const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3.5 text-base text-fg placeholder:text-subtle outline-none transition-[border-color,box-shadow] focus-visible:outline-none focus:border-primary focus:ring-3 focus:ring-primary/20 md:text-sm disabled:opacity-60";

type Common = { label: string; error?: string; hint?: ReactNode; hideLabel?: boolean; className?: string };

function Field({ id, label, error, hint, hideLabel, className, children }: Common & { id: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={cn("text-sm font-medium text-fg", hideLabel && "sr-only")}>
        {label}
      </label>
      {children}
      {(error || hint) && (
        <p id={`${id}-desc`} className={cn("text-xs", error ? "text-danger" : "text-muted")}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> &
  Common & { leading?: ReactNode; trailing?: ReactNode; ref?: Ref<HTMLInputElement>; inputClassName?: string };

export function TextField({ label, error, hint, hideLabel, className, leading, trailing, id, inputClassName, ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field id={inputId} label={label} error={error} hint={hint} hideLabel={hideLabel} className={className}>
      <div className="relative flex items-center">
        {leading && <span className="pointer-events-none absolute left-3.5 flex text-subtle [&_svg]:size-4">{leading}</span>}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${inputId}-desc` : undefined}
          className={cn(inputClass, "h-11", leading && "pl-10", trailing && "pr-12", error && "border-danger focus:border-danger focus:ring-danger/20", inputClassName)}
          {...rest}
        />
        {trailing && <span className="absolute right-1 flex">{trailing}</span>}
      </div>
    </Field>
  );
}

export function PasswordField(props: Omit<TextFieldProps, "type" | "trailing">) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...props}
      type={visible ? "text" : "password"}
      trailing={
        <IconButton
          label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          size="sm"
          onClick={() => setVisible((v) => !v)}
          className="[&_svg]:size-4"
        >
          {visible ? <EyeOff /> : <Eye />}
        </IconButton>
      }
    />
  );
}

type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> & Common & { ref?: Ref<HTMLTextAreaElement> };

export function TextAreaField({ label, error, hint, hideLabel, className, id, ...rest }: TextAreaFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field id={inputId} label={label} error={error} hint={hint} hideLabel={hideLabel} className={className}>
      <textarea
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${inputId}-desc` : undefined}
        className={cn(inputClass, "min-h-24 resize-none py-2.5", error && "border-danger")}
        {...rest}
      />
    </Field>
  );
}
