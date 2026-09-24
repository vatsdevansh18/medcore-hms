import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiRequestError } from "@/lib/api-client";
import { DataTable, type Column } from "./data-table";

interface Row {
  id: string;
  name: string;
}
const columns: Column<Row>[] = [{ key: "name", header: "Name", cell: (r) => r.name }];
const empty = { title: "Nothing here" };

describe("DataTable states (§2.10)", () => {
  it("shows skeleton rows while loading, marked busy", () => {
    render(<DataTable caption="People" columns={columns} rows={undefined} rowKey={(r) => r.id} loading empty={empty} />);
    expect(screen.getByRole("table", { name: "People" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(7); // header + 6 placeholders
  });

  it("shows the empty state, not an empty table", () => {
    render(<DataTable caption="People" columns={columns} rows={[]} rowKey={(r) => r.id} loading={false} empty={empty} />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows a retryable error for a server fault but not for a 403", async () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <DataTable caption="People" columns={columns} rows={undefined} rowKey={(r) => r.id} loading={false} empty={empty}
        error={new ApiRequestError(500, "INTERNAL_ERROR", "boom")} onRetry={onRetry} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
    rerender(
      <DataTable caption="People" columns={columns} rows={undefined} rowKey={(r) => r.id} loading={false} empty={empty}
        error={new ApiRequestError(403, "FORBIDDEN_ROLE", "no")} onRetry={onRetry} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("doesn't have access");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("renders rows and server pagination", async () => {
    const onPage = vi.fn();
    render(
      <DataTable caption="People" columns={columns} rows={[{ id: "1", name: "Asha" }]} rowKey={(r) => r.id} loading={false} empty={empty}
        meta={{ page: 1, limit: 20, total: 41, totalPages: 3 }} onPage={onPage} />,
    );
    expect(screen.getByRole("cell", { name: "Asha" })).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});
