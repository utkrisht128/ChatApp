import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AdminReport, AdminStats, AdminUser, AdminUserFilter, Page, ReportStatus } from "@chat/shared";
import { api, errorMessage } from "@/lib/api";

export const adminKeys = {
  all: ["admin"] as const,
  stats: ["admin", "stats"] as const,
  users: (q: string, filter: AdminUserFilter) => ["admin", "users", q, filter] as const,
  reports: (status: ReportStatus | "all") => ["admin", "reports", status] as const,
};

export const useAdminStats = () =>
  useQuery({
    queryKey: adminKeys.stats,
    queryFn: ({ signal }) => api<{ stats: AdminStats }>("/admin/stats", { signal }).then((r) => r.stats),
    staleTime: 30_000,
  });

export function useAdminUsers(q: string, filter: AdminUserFilter) {
  return useInfiniteQuery({
    queryKey: adminKeys.users(q, filter),
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ filter });
      if (q) params.set("q", q);
      if (pageParam) params.set("cursor", pageParam);
      return api<Page<AdminUser>>(`/admin/users?${params}`, { signal });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useAdminReports(status: ReportStatus | "all") {
  return useInfiniteQuery({
    queryKey: adminKeys.reports(status),
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (pageParam) params.set("cursor", pageParam);
      return api<Page<AdminReport>>(`/admin/reports?${params}`, { signal });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Ban/unban and role changes both refresh the whole admin area, including the counts. */
function useAdminMutation<V>(fn: (vars: V) => Promise<unknown>, message: (vars: V) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: adminKeys.all });
      toast.success(message(vars));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export const useSetBan = () =>
  useAdminMutation(
    ({ userId, banned, reason }: { userId: string; banned: boolean; reason?: string; name: string }) =>
      api<{ user: AdminUser }>(`/admin/users/${userId}/ban`, { method: "PUT", body: { banned, reason: reason ?? "" } }),
    (v) => `${v.banned ? "Banned" : "Unbanned"} ${v.name}`,
  );

export const useSetUserRole = () =>
  useAdminMutation(
    ({ userId, role }: { userId: string; role: "user" | "admin"; name: string }) =>
      api<{ user: AdminUser }>(`/admin/users/${userId}/role`, { method: "PUT", body: { role } }),
    (v) => (v.role === "admin" ? `${v.name} is now an admin` : `${v.name} is no longer an admin`),
  );

export const useResolveReport = () =>
  useAdminMutation(
    ({ reportId, status, removeMessage }: { reportId: string; status: "reviewed" | "actioned" | "dismissed"; removeMessage?: boolean }) =>
      api<{ report: AdminReport }>(`/admin/reports/${reportId}`, { method: "PUT", body: { status, removeMessage: Boolean(removeMessage) } }),
    (v) => (v.status === "dismissed" ? "Report dismissed" : v.removeMessage ? "Message removed" : "Report resolved"),
  );
