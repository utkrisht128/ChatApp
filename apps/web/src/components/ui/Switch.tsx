import { useId, type ReactNode } from "react";
import { RadioGroup, Switch as S } from "radix-ui";
import { cn } from "@/lib/cn";

/** A labelled settings row with a switch. The whole row is the label. */
export function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-[15px] font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-sm text-muted">{description}</span>}
      </label>
      <S.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-border-strong transition-colors data-[state=checked]:bg-primary disabled:opacity-50"
      >
        <S.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
      </S.Root>
    </div>
  );
}

/** Radio options rendered as settings rows. */
export function RadioRows<T extends string>({
  label,
  value,
  onValueChange,
  options,
}: {
  label: string;
  value: T;
  onValueChange: (v: T) => void;
  options: { value: T; label: string; description?: string }[];
}) {
  return (
    <RadioGroup.Root aria-label={label} value={value} onValueChange={(v) => onValueChange(v as T)} className="flex flex-col">
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          className="group flex items-center gap-3 px-4 py-3 text-left outline-none hover:bg-surface-2 focus-visible:bg-surface-2"
        >
          <span className="grid size-5 shrink-0 place-items-center rounded-full border-2 border-border-strong group-data-[state=checked]:border-primary">
            <RadioGroup.Indicator className="size-2.5 rounded-full bg-primary" />
          </span>
          <span className="min-w-0">
            <span className="block text-[15px]">{o.label}</span>
            {o.description && <span className="block text-sm text-muted">{o.description}</span>}
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

/** Rounded card grouping settings rows, with an optional heading. */
export function SettingsGroup({ title, footer, children, className }: { title?: string; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      {title && <h2 className="px-4 text-xs font-semibold tracking-wide text-muted uppercase">{title}</h2>}
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">{children}</div>
      {footer && <p className="px-4 text-xs text-muted">{footer}</p>}
    </section>
  );
}
