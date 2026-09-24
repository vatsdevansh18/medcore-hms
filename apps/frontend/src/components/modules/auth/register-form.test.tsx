import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiRequestError } from "@/lib/api-client";
import { RegisterForm } from "./register-form";

const hospitals = [
  { id: "h1", name: "City Hospital", slug: "city", city: "Pune" },
  { id: "h2", name: "Metro Hospital", slug: "metro", city: null },
];

async function fill(overrides: Partial<Record<string, string>> = {}) {
  const values = {
    Hospital: "h1",
    "First name": "Asha",
    "Last name": "Rao",
    Email: "asha@example.com",
    Password: "secret123",
    "Confirm password": "secret123",
    ...overrides,
  };
  await userEvent.selectOptions(screen.getByLabelText("Hospital"), values.Hospital as string);
  for (const label of ["First name", "Last name", "Email", "Password", "Confirm password"] as const) {
    if (values[label]) await userEvent.type(screen.getByLabelText(label), values[label] as string);
  }
  if (overrides.phone) await userEvent.type(screen.getByLabelText("Mobile number (optional)"), overrides.phone);
}

describe("RegisterForm", () => {
  it("lists each hospital with its city", () => {
    render(<RegisterForm hospitals={hospitals} onRegister={vi.fn()} />);
    expect(screen.getByRole("option", { name: "City Hospital — Pune" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Metro Hospital" })).toBeInTheDocument();
  });

  it("sends the registration without the confirm field or an empty phone", async () => {
    const onRegister = vi.fn().mockResolvedValue(undefined);
    render(<RegisterForm hospitals={hospitals} onRegister={onRegister} />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(onRegister).toHaveBeenCalledWith({
      hospitalId: "h1",
      firstName: "Asha",
      lastName: "Rao",
      email: "asha@example.com",
      password: "secret123",
      phone: undefined,
    });
  });

  it("blocks mismatched passwords and a malformed phone before calling the API", async () => {
    const onRegister = vi.fn();
    render(<RegisterForm hospitals={hospitals} onRegister={onRegister} />);
    await fill({ "Confirm password": "secret124", phone: "98123" });
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("The passwords don't match.")).toBeInTheDocument();
    expect(screen.getByText(/Use international format/)).toBeInTheDocument();
    expect(onRegister).not.toHaveBeenCalled();
  });

  it("shows a server validation message (e.g. a taken email)", async () => {
    const onRegister = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(400, "VALIDATION_ERROR", "An account with this email already exists."));
    render(<RegisterForm hospitals={hospitals} onRegister={onRegister} />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("An account with this email already exists.");
  });
});
