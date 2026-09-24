import { create } from "zustand";
import type { CurrentUser } from "@medcore/types";

export type AuthStatus = "unknown" | "authenticated" | "anonymous";

interface AuthState {
  /** The access token lives only in memory. The refresh token is an
   * httpOnly cookie the page never sees (docs/03-ARCHITECTURE.md §6). */
  accessToken: string | null;
  user: CurrentUser | null;
  status: AuthStatus;
  setAccessToken: (token: string | null) => void;
  setSession: (token: string, user: CurrentUser) => void;
  setUser: (user: CurrentUser) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  status: "unknown",
  setAccessToken: (accessToken) => set({ accessToken }),
  setSession: (accessToken, user) => set({ accessToken, user, status: "authenticated" }),
  setUser: (user) => set({ user }),
  clear: () => set({ accessToken: null, user: null, status: "anonymous" }),
}));
