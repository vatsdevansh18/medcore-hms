"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { UserRole } from "@medcore/types";
import { configureApiClient, refreshAccessToken } from "@/lib/api-client";
import { authApi } from "@/services/auth";
import { useAuthStore } from "@/store/auth-store";
import { useNotificationStore } from "@/store/notification-store";
import { ROUTES } from "@/constants";

configureApiClient({
  getToken: () => useAuthStore.getState().accessToken,
  setToken: (token) => useAuthStore.getState().setAccessToken(token),
  onSessionExpired: () => useAuthStore.getState().clear(),
});

let bootstrap: Promise<void> | null = null;

/** Restores a session from the refresh cookie once per page load. */
function restoreSession(): Promise<void> {
  bootstrap ??= (async () => {
    const token = await refreshAccessToken();
    if (!token) {
      useAuthStore.getState().clear();
      return;
    }
    try {
      const user = await authApi.me();
      useAuthStore.getState().setSession(useAuthStore.getState().accessToken ?? token, user);
    } catch {
      useAuthStore.getState().clear();
    }
  })();
  return bootstrap;
}

/** Where a signed-in user belongs: the portal for patients; staff tools
 * come in Phase 13 (docs/05-DEVELOPMENT-PLAN.md). */
export function homeFor(role: UserRole): string {
  return role === UserRole.PATIENT ? ROUTES.portal : ROUTES.staff;
}

export function useAuth() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    if (status === "unknown") void restoreSession();
  }, [status]);

  const login = useCallback(async (email: string, password: string) => {
    const { accessToken } = await authApi.login(email, password);
    useAuthStore.getState().setAccessToken(accessToken);
    const me = await authApi.me();
    useAuthStore.getState().setSession(accessToken, me);
    return me;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // The session is ended locally whatever the server says.
    }
    bootstrap = null;
    useAuthStore.getState().clear();
    useNotificationStore.getState().reset();
    queryClient.clear();
    router.replace(ROUTES.login);
  }, [queryClient, router]);

  return { status, user, login, logout };
}
