import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address").max(254));

export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_]{3,24}$/, "3–24 characters: letters, numbers and underscores")
  .transform((s) => s.toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128, "Use at most 128 characters");

export const displayNameSchema = z.string().trim().min(1, "Name is required").max(48);

export const registerSchema = z.strictObject({
  email: emailSchema,
  username: usernameSchema,
  displayName: displayNameSchema.optional(),
  password: passwordSchema,
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.strictObject({
  /** Username or email. */
  identifier: z.string().trim().toLowerCase().min(1, "Enter your username or email").max(254),
  password: z.string().min(1, "Enter your password").max(128),
});
export type LoginInput = z.input<typeof loginSchema>;

const tokenSchema = z.string().min(20).max(200);

export const verifyEmailSchema = z.strictObject({ token: tokenSchema });
export const forgotPasswordSchema = z.strictObject({ email: emailSchema });
export const resetPasswordSchema = z.strictObject({ token: tokenSchema, password: passwordSchema });
export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
