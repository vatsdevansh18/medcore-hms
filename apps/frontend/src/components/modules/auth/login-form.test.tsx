import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CurrentUser } from "@medcore/types";
import { ApiRequestError } from "@/lib/api-client";
import { LoginForm } from "./login-form";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("LoginForm", () => {
  it("validates on submit and wires the errors to the inputs", async () => {
    const onLogin = vi.fn();
    render(<LoginForm onLogin={onLogin} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter your email address.")).toBeInTheDocument();
    const email = screen.getByLabelText("Email");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Enter your email address.");
    expect(onLogin).not.toHaveBeenCalled();
  });

  it("submits valid credentials", async () => {
    const onLogin = vi.fn().mockResolvedValue({} as CurrentUser);
    render(<LoginForm onLogin={onLogin} />);
    await userEvent.type(screen.getByLabelText("Email"), "asha@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onLogin).toHaveBeenCalledWith("asha@example.com", "secret123");
  });

  it("shows the server's message for bad credentials", async () => {
    const onLogin = vi.fn().mockRejectedValue(new ApiRequestError(401, "UNAUTHENTICATED", "Invalid email or password."));
    render(<LoginForm onLogin={onLogin} />);
    await userEvent.type(screen.getByLabelText("Email"), "asha@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
    expect(screen.queryByRole("link", { name: "Verify now" })).not.toBeInTheDocument();
  });

  it("offers email verification when the account isn't verified yet", async () => {
    const onLogin = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(401, "UNAUTHENTICATED", "Please verify your email before logging in."));
    render(<LoginForm onLogin={onLogin} />);
    await userEvent.type(screen.getByLabelText("Email"), "new@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const link = await screen.findByRole("link", { name: "Verify now" });
    expect(link).toHaveAttribute("href", "/verify-email?email=new%40example.com");
  });

  it("explains rate limiting in plain language", async () => {
    const onLogin = vi.fn().mockRejectedValue(new ApiRequestError(429, "RATE_LIMITED", "ThrottlerException"));
    render(<LoginForm onLogin={onLogin} />);
    await userEvent.type(screen.getByLabelText("Email"), "asha@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Too many attempts/);
  });
});
