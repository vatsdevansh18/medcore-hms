import { describe, expect, it } from "vitest";
import { cancelAppointmentSchema, registerSchema, resetPasswordSchema, verifyEmailSchema } from "./validation";

const validRegistration = {
  hospitalId: "h1",
  firstName: "Asha",
  lastName: "Rao",
  email: "asha@example.com",
  phone: "",
  password: "secret123",
  confirmPassword: "secret123",
};

describe("form schemas mirror the backend DTO rules", () => {
  it("accepts a valid registration, with or without a phone", () => {
    expect(registerSchema.safeParse(validRegistration).success).toBe(true);
    expect(registerSchema.safeParse({ ...validRegistration, phone: "+919812345678" }).success).toBe(true);
  });

  it.each([
    ["short", "Use at least 8 characters."],
    ["onlyletters", "Include at least one letter and one number."],
    ["12345678", "Include at least one letter and one number."],
    ["a1".repeat(37), "Use 72 characters or fewer."],
  ])("rejects the password %s", (password, message) => {
    const result = registerSchema.safeParse({ ...validRegistration, password, confirmPassword: password });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toContain(message);
  });

  it("rejects mismatched passwords on the confirm field", () => {
    const result = registerSchema.safeParse({ ...validRegistration, confirmPassword: "different1" });
    expect(result.error?.issues[0]).toMatchObject({ path: ["confirmPassword"], message: "The passwords don't match." });
  });

  it("rejects a phone without the international prefix, and a missing hospital", () => {
    expect(registerSchema.safeParse({ ...validRegistration, phone: "9812345678" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...validRegistration, hospitalId: "" }).success).toBe(false);
  });

  it("needs exactly six digits for the email code", () => {
    expect(verifyEmailSchema.safeParse({ email: "a@b.co", code: "123456" }).success).toBe(true);
    expect(verifyEmailSchema.safeParse({ email: "a@b.co", code: "12345" }).success).toBe(false);
    expect(verifyEmailSchema.safeParse({ email: "a@b.co", code: "12345a" }).success).toBe(false);
  });

  it("requires a cancellation reason of at most 500 characters", () => {
    expect(cancelAppointmentSchema.safeParse({ reason: "   " }).success).toBe(false);
    expect(cancelAppointmentSchema.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
    expect(cancelAppointmentSchema.safeParse({ reason: "Feeling better" }).success).toBe(true);
  });

  it("checks the new password twice on reset", () => {
    expect(resetPasswordSchema.safeParse({ newPassword: "secret123", confirmPassword: "secret123" }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ newPassword: "secret123", confirmPassword: "secret124" }).success).toBe(false);
  });
});
