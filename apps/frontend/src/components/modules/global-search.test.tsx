import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GlobalSearchView } from "@medcore/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

let view: GlobalSearchView | undefined;
const calls: string[] = [];
vi.mock("@/services/staff", () => ({
  useGlobalSearch: (q: string) => {
    calls.push(q);
    return { data: q.length >= 2 ? view : undefined, isPending: q.length >= 2 && !view, isFetching: false, isError: false, error: null };
  },
}));

import { GlobalSearch, searchHref, toOptions } from "./global-search";

const VIEW: GlobalSearchView = {
  query: "an",
  scopes: ["patients", "doctors"],
  patients: { hits: [{ id: "p1", name: "Ananya Rao", email: "a@x.test", phone: "+911", dob: null }], total: 1 },
  doctors: { hits: [{ id: "d1", name: "Dr. Anil Kumar", specialization: "Cardiologist", department: "Cardiology" }], total: 1 },
};

describe("GlobalSearch", () => {
  beforeEach(() => {
    push.mockReset();
    calls.length = 0;
    view = VIEW;
  });

  it("flattens grouped results in scope order", () => {
    expect(toOptions(VIEW).map((o) => `${o.scope}:${o.primary}`)).toEqual(["patients:Ananya Rao", "doctors:Dr. Anil Kumar"]);
    expect(toOptions(undefined)).toEqual([]);
    expect(searchHref("an rao", "patients")).toBe("/dashboard/search?q=an+rao&scope=patients");
  });

  it("debounces: one query for a burst of typing, never for one character", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);
    await user.type(screen.getByRole("combobox"), "ana");
    await screen.findByRole("option", { name: /Ananya Rao/ });
    expect(calls.filter((q) => q.length > 0)).toEqual(["ana"]);
  });

  it("is keyboard operable: arrows pick a result, Enter opens its scope", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);
    const box = screen.getByRole("combobox");
    await user.type(box, "an");
    await screen.findByRole("listbox");
    expect(box).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("option", { name: /Dr\. Anil Kumar/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/dashboard/search?q=an&scope=doctors");
  });

  it("opens the full results for plain Enter, and Escape closes the list", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);
    const box = screen.getByRole("combobox");
    await user.type(box, "an");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");
    expect(box).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/dashboard/search?q=an");
  });

  it("says so when nothing matches", async () => {
    view = { query: "zz", scopes: ["patients"], patients: { hits: [], total: 0 } };
    const user = userEvent.setup();
    render(<GlobalSearch />);
    await user.type(screen.getByRole("combobox"), "zz");
    expect(await screen.findByText(/No matches for/)).toBeInTheDocument();
  });
});
