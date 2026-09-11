/** Joins class names, skipping falsy values. Callers pass overrides last. */
export const cn = (...classes: (string | boolean | number | bigint | null | undefined)[]) => classes.filter(Boolean).join(" ");
