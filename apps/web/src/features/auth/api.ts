import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { LoginInput, Me, RegisterInput } from "@chat/shared";
import { api, ApiError } from "@/lib/api";
import { useDrafts } from "@/stores/drafts";
import { useOutbox } from "@/stores/outbox";

type UserResponse = { user: Me };

export const meKey = ["me"] as const;

/** The signed-in user, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async () => {
      try {
        // Generous timeout: this is the request that wakes a sleeping free-tier server.
        return (await api<UserResponse>("/auth/me", { timeoutMs: 75_000 })).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
    retry: 3,
  });
}

/** Non-null current user — only use inside authenticated routes. */
export function useCurrentUser() {
  const me = useMe().data;
  if (!me) throw new Error("useCurrentUser used outside an authenticated route");
  return me;
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api<UserResponse>("/auth/login", { method: "POST", body: input }),
    onSuccess: ({ user }) => qc.setQueryData(meKey, user),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => api<UserResponse>("/auth/register", { method: "POST", body: input }),
    onSuccess: ({ user }) => qc.setQueryData(meKey, user),
  });
}

/**
 * Clears every cached query and local draft so nothing leaks to the next person on this device,
 * then lands on the login screen (without a ?next= back into the previous account's pages).
 */
function useSignedOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return () => {
    navigate("/login", { replace: true });
    useDrafts.getState().clearAll();
    useOutbox.getState().clearAll();
    qc.clear();
    qc.setQueryData(meKey, null);
  };
}

export function useLogout() {
  const signedOut = useSignedOut();
  return useMutation({
    mutationFn: () => api<void>("/auth/logout", { method: "POST" }),
    onSettled: signedOut,
  });
}

export function useLogoutEverywhere() {
  const signedOut = useSignedOut();
  return useMutation({
    mutationFn: () => api<void>("/auth/logout-all", { method: "POST" }),
    onSuccess: signedOut,
  });
}

export const useForgotPassword = () =>
  useMutation({ mutationFn: (email: string) => api("/auth/forgot-password", { method: "POST", body: { email } }) });

export const useResetPassword = () =>
  useMutation({
    mutationFn: (input: { token: string; password: string }) => api("/auth/reset-password", { method: "POST", body: input }),
  });

export function useVerifyEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api("/auth/verify-email", { method: "POST", body: { token } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  });
}

export const useResendVerification = () =>
  useMutation({ mutationFn: () => api("/auth/resend-verification", { method: "POST" }) });

export const useChangePassword = () =>
  useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api("/auth/change-password", { method: "POST", body: input }),
  });
