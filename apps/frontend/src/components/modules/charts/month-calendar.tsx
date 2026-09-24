import { monthGrid } from "@/lib/chart-data";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The doctor's mini month view (brief: "Upcoming follow-ups calendar"):
 * how many appointments fall on each day, today highlighted. */
export function MonthCalendar({
  year,
  month,
  counts,
  today,
}: {
  year: number;
  month: number;
  counts: Map<string, number>;
  today: string;
}) {
  const weeks = monthGrid(year, month, counts);
  const title = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
  return (
    <table className="w-full table-fixed text-center text-sm">
      <caption className="mb-2 text-left text-sm font-medium">{title}</caption>
      <thead>
        <tr>
          {WEEKDAYS.map((d) => (
            <th key={d} scope="col" className="pb-1 text-xs font-medium text-subtle">
              {d}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, i) => (
          <tr key={i}>
            {week.map((cell, j) => (
              <td key={j} className="p-0.5">
                {cell.date && (
                  <div
                    className={cn(
                      "flex h-10 flex-col items-center justify-center rounded-md border",
                      cell.date === today ? "border-primary" : "border-transparent",
                      cell.count > 0 ? "bg-primary-surface" : "",
                    )}
                    aria-label={`${cell.date}: ${cell.count} appointment${cell.count === 1 ? "" : "s"}`}
                  >
                    <span className={cn("text-xs", cell.date === today ? "font-semibold text-primary" : "text-muted")}>
                      {Number(cell.date.slice(8))}
                    </span>
                    {cell.count > 0 && <span className="text-[11px] font-medium text-primary tabular-nums">{cell.count}</span>}
                  </div>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
