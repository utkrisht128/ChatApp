import { z } from "zod";
import { displayNameSchema, usernameSchema } from "./auth";

export const VISIBILITY = ["everyone", "contacts", "nobody"] as const;
export type Visibility = (typeof VISIBILITY)[number];

export const userSettingsSchema = z.strictObject({
  theme: z.enum(["system", "light", "dark"]),
  readReceipts: z.boolean(),
  lastSeenVisibility: z.enum(VISIBILITY),
  onlineVisibility: z.enum(VISIBILITY),
  enterToSend: z.boolean(),
  sounds: z.boolean(),
  notifications: z.strictObject({
    messages: z.boolean(),
    groups: z.boolean(),
    mentions: z.boolean(),
    showPreview: z.boolean(),
  }),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

export const DEFAULT_SETTINGS: UserSettings = {
  theme: "system",
  readReceipts: true,
  lastSeenVisibility: "everyone",
  onlineVisibility: "everyone",
  enterToSend: true,
  sounds: true,
  notifications: { messages: true, groups: true, mentions: true, showPreview: true },
};

export const updateSettingsSchema = userSettingsSchema
  .omit({ notifications: true })
  .partial()
  .extend({ notifications: userSettingsSchema.shape.notifications.partial().optional() })
  .strict();

export const updateProfileSchema = z.strictObject({
  displayName: displayNameSchema.optional(),
  username: usernameSchema.optional(),
  bio: z.string().trim().max(160).optional(),
});

/** What any signed-in user may see about another user. */
export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  /** Omitted when hidden by the user's privacy settings or a block. */
  online?: boolean;
  lastSeenAt?: string | null;
};

/** The signed-in user. */
export type Me = PublicUser & {
  email: string;
  emailVerified: boolean;
  role: "user" | "admin";
  settings: UserSettings;
  createdAt: string;
};
