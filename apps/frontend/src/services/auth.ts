import type { CurrentUser, HospitalDirectoryEntry } from "@medcore/types";
import { apiRequest } from "@/lib/api-client";

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  hospitalId: string;
  phone?: string;
}

export const authApi = {
  login: (email: string, password: string) =>
    apiRequest<{ accessToken: string }>("/auth/login", { method: "POST", body: { email, password }, auth: false }),
  me: () => apiRequest<CurrentUser>("/auth/me"),
  logout: () => apiRequest<{ loggedOut: boolean }>("/auth/logout", { method: "POST" }),
  register: (input: RegisterInput) =>
    apiRequest<{ userId: string; email: string }>("/auth/register", { method: "POST", body: input, auth: false }),
  verifyEmail: (email: string, code: string) =>
    apiRequest<{ verified: boolean }>("/auth/verify-email", { method: "POST", body: { email, code }, auth: false }),
  resendEmailOtp: (email: string) =>
    apiRequest<unknown>("/auth/resend-email-otp", { method: "POST", body: { email }, auth: false }),
  forgotPassword: (email: string) =>
    apiRequest<{ sent: boolean }>("/auth/forgot-password", { method: "POST", body: { email }, auth: false }),
  resetPassword: (token: string, newPassword: string) =>
    apiRequest<{ reset: boolean }>("/auth/reset-password", {
      method: "POST",
      body: { token, newPassword },
      auth: false,
    }),
  hospitalDirectory: () => apiRequest<HospitalDirectoryEntry[]>("/hospitals/directory", { auth: false }),
};
