import { z } from "zod";

/**
 * Form schemas. Each mirrors the backend DTO's class-validator rules so the
 * user sees the same limits before submitting; the server still validates
 * everything (SEC-INPUT-001).
 */

const email = z.string().trim().min(1, "Enter your email address.").email("Enter a valid email address.");

/** RegisterDto / ResetPasswordDto: 8-72 characters, a letter and a number. */
const newPassword = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(72, "Use 72 characters or fewer.")
  .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Include at least one letter and one number.");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    hospitalId: z.string().min(1, "Choose the hospital you visit."),
    firstName: z.string().trim().min(1, "Enter your first name.").max(100, "Use 100 characters or fewer."),
    lastName: z.string().trim().min(1, "Enter your last name.").max(100, "Use 100 characters or fewer."),
    email,
    phone: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\+[1-9]\d{7,14}$/.test(v), "Use international format, e.g. +919812345678.")
      .optional(),
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "The passwords don't match.",
    path: ["confirmPassword"],
  });
export type RegisterValues = z.infer<typeof registerSchema>;

export const verifyEmailSchema = z.object({
  email,
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the email."),
});
export type VerifyEmailValues = z.infer<typeof verifyEmailSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({ newPassword, confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "The passwords don't match.",
    path: ["confirmPassword"],
  });
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

/** UpdateAppointmentStatusDto.cancelledReason: required to cancel, max 500. */
export const cancelAppointmentSchema = z.object({
  reason: z.string().trim().min(1, "Tell the hospital why you're cancelling.").max(500, "Use 500 characters or fewer."),
});
export type CancelAppointmentValues = z.infer<typeof cancelAppointmentSchema>;

/** BookAppointmentDto.reasonForVisit: optional, max 500. */
export const visitReasonSchema = z.object({
  reasonForVisit: z.string().trim().max(500, "Use 500 characters or fewer."),
});
export type VisitReasonValues = z.infer<typeof visitReasonSchema>;
