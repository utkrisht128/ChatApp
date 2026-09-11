import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Me, UserSettings } from "@chat/shared";
import { meKey } from "@/features/auth/api";
import { api, errorMessage } from "@/lib/api";

export type SettingsPatch = Partial<Omit<UserSettings, "notifications">> & { notifications?: Partial<UserSettings["notifications"]> };

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { displayName?: string; username?: string; bio?: string }) =>
      api<{ user: Me }>("/users/me", { method: "PATCH", body: input }).then((r) => r.user),
    onSuccess: (user) => qc.setQueryData(meKey, user),
  });
}

/** Applies an uploaded photo (or null to remove it). Errors are reported by the caller. */
export function useSetAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string | null) => api<{ user: Me }>("/users/me/avatar", { method: "PUT", body: { fileId } }).then((r) => r.user),
    onSuccess: (user) => qc.setQueryData(meKey, user),
  });
}

/** Optimistic: toggles flip instantly and roll back if the server rejects them. */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api<{ user: Me }>("/users/me/settings", { method: "PATCH", body: patch }).then((r) => r.user),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: meKey });
      const prev = qc.getQueryData<Me>(meKey);
      if (prev) {
        qc.setQueryData<Me>(meKey, {
          ...prev,
          settings: { ...prev.settings, ...patch, notifications: { ...prev.settings.notifications, ...patch.notifications } },
        });
      }
      return { prev };
    },
    onError: (err, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(meKey, ctx.prev);
      toast.error("Couldn't save setting", { description: errorMessage(err) });
    },
    onSuccess: (user) => qc.setQueryData(meKey, user),
  });
}
