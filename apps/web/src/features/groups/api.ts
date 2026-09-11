import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ChatSummary, CreateGroupInput, GroupInfo, UpdateGroupInput } from "@chat/shared";
import { chatKeys } from "@/features/chats/api";
import { api, errorMessage } from "@/lib/api";

export const groupKey = (chatId: string) => ["groups", chatId] as const;

export function useGroup(chatId: string, enabled = true) {
  return useQuery({
    queryKey: groupKey(chatId),
    queryFn: ({ signal }) => api<{ group: GroupInfo }>(`/groups/${chatId}`, { signal }).then((r) => r.group),
    enabled,
    staleTime: 60_000,
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGroupInput) => api<{ chat: ChatSummary }>("/groups", { method: "POST", body: input }).then((r) => r.chat),
    onSuccess: (chat) => {
      qc.setQueryData(chatKeys.detail(chat.id), chat);
      void qc.invalidateQueries({ queryKey: chatKeys.lists });
    },
  });
}

/** Shared plumbing for group mutations: store the fresh group, refresh the chat summaries. */
function useGroupMutation<V>(chatId: string, fn: (vars: V) => Promise<GroupInfo | void>, successMessage?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (group) => {
      if (group) qc.setQueryData(groupKey(chatId), group);
      void qc.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
      void qc.invalidateQueries({ queryKey: chatKeys.lists });
      if (successMessage) toast.success(successMessage);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

const groupReq = (method: "PATCH" | "POST" | "DELETE", path: string, body?: unknown) =>
  api<{ group: GroupInfo } | undefined>(path, { method, body }).then((r) => r?.group);

export const useUpdateGroup = (chatId: string) =>
  useGroupMutation(chatId, (patch: UpdateGroupInput) => groupReq("PATCH", `/groups/${chatId}`, patch), "Group updated");

export const useAddMembers = (chatId: string) =>
  useGroupMutation(chatId, (userIds: string[]) => groupReq("POST", `/groups/${chatId}/members`, { userIds }));

export const useRemoveMember = (chatId: string) =>
  useGroupMutation(chatId, (userId: string) => groupReq("DELETE", `/groups/${chatId}/members/${userId}`));

export const useSetRole = (chatId: string) =>
  useGroupMutation(chatId, ({ userId, role }: { userId: string; role: "admin" | "member" }) =>
    groupReq("PATCH", `/groups/${chatId}/members/${userId}`, { role }),
  );

/** Applies an uploaded group photo (or null to remove). Errors are reported by the caller. */
export function useSetGroupAvatar(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string | null) => api<{ group: GroupInfo }>(`/groups/${chatId}/avatar`, { method: "PUT", body: { fileId } }).then((r) => r.group),
    onSuccess: (group) => {
      qc.setQueryData(groupKey(chatId), group);
      void qc.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
      void qc.invalidateQueries({ queryKey: chatKeys.lists });
    },
  });
}

export function useLeaveGroup(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/groups/${chatId}/leave`, { method: "POST" }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: groupKey(chatId) });
      qc.removeQueries({ queryKey: chatKeys.detail(chatId) });
      void qc.invalidateQueries({ queryKey: chatKeys.lists });
      toast.success("You left the group");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}
