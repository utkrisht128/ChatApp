import { Types } from "mongoose";

export type Id = Types.ObjectId | string;

/** Strict 24-hex check (mongoose's isValid also accepts any 12-character string). */
export const isObjectId = (value: unknown): value is string => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

export const sameId = (a: Id | null | undefined, b: Id | null | undefined) => a != null && b != null && String(a) === String(b);

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
