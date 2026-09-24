import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge, statusStyle } from "./status-badge";

describe("StatusBadge", () => {
  it("names the status in words, not colour alone (§1.3)", () => {
    const { container } = render(<StatusBadge status="CONFIRMED" />);
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("reads a lab IN_PROGRESS and a payment PENDING differently from an appointment's", () => {
    expect(statusStyle("IN_PROGRESS").label).toBe("In progress");
    expect(statusStyle("IN_PROGRESS", "lab").label).toBe("Testing");
    expect(statusStyle("PENDING").label).toBe("Awaiting confirmation");
    expect(statusStyle("PENDING", "payment").label).toBe("Processing");
  });

  it("falls back to a readable label for an unknown status", () => {
    render(<StatusBadge status="SOMETHING_NEW" />);
    expect(screen.getByText("something new")).toBeInTheDocument();
  });
});
