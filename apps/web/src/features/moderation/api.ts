import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { BlockedUser, CreateReportInput } from "@chat/shared";
import { chatKeys } from "@/features/chats/api";
import { api, errorMessage } from "@/lib/api";

export const blockedKey = ["blocked"] as const;

export const useBlocked = (enabled = true) =>
  useQuery({
    queryKey: blockedKey,
    queryFn: ({ signal }) => api<{ users: BlockedUser[] }>("/users/blocked", { signal }).then((r) => r.users),
    enabled,
    staleTime: 60_000,
  });

export function useSetBlocked() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, blocked }: { userId: string; blocked: boolean; name?: string }) =>
      api<{ users: BlockedUser[] }>(`/users/${userId}/blocked`, { method: "PUT", body: { blocked } }).then((r) => r.users),
    onSuccess: (users, { blocked, name }) => {
      qc.setQueryData(blockedKey, users);
      // Blocking changes what the chat list may show (presence), so refresh it.
      void qc.invalidateQueries({ queryKey: chatKeys.lists });
      toast.success(blocked ? `Blocked${name ? ` ${name}` : ""}` : `Unblocked${name ? ` ${name}` : ""}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useReport() {
  return useMutation({
    mutationFn: (input: CreateReportInput) => api<void>("/reports", { method: "POST", body: input }),
    onSuccess: () => toast.success("Report sent", { description: "Thanks — our moderators will take a look." }),
    onError: (err) => toast.error(errorMessage(err)),
  });
}
