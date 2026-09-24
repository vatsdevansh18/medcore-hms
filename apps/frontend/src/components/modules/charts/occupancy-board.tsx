import type { BedStatus, OccupancyView } from "@medcore/types";
import { occupancyPercent } from "@/lib/chart-data";
import { cn } from "@/lib/utils";

const BED_STYLE: Record<BedStatus, { label: string; cell: string; mark: string }> = {
  OCCUPIED: { label: "Occupied", cell: "bg-danger-surface border-danger/40 text-danger", mark: "●" },
  VACANT: { label: "Vacant", cell: "bg-success-surface border-success/40 text-success", mark: "○" },
  MAINTENANCE: { label: "Maintenance", cell: "bg-surface-muted border-border-strong text-muted", mark: "▲" },
};

/**
 * Department occupancy heat map / ward bed board (brief: Admin "Department
 * occupancy heat map", Nurse "ward/bed occupancy board"; D-007 limits
 * inpatient data to bed status). Each bed is a labelled cell with a status
 * word, a symbol, and a colour. `compact` shows only per-department bars.
 */
export function OccupancyBoard({ data, compact = false }: { data: OccupancyView; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-wrap gap-4 text-xs text-muted" aria-label="Legend">
        {(Object.keys(BED_STYLE) as BedStatus[]).map((status) => (
          <li key={status} className="flex items-center gap-1">
            <span className={cn("inline-flex size-4 items-center justify-center rounded border text-[10px]", BED_STYLE[status].cell)} aria-hidden="true">
              {BED_STYLE[status].mark}
            </span>
            {BED_STYLE[status].label} ({data.counts[status]})
          </li>
        ))}
      </ul>
      {data.departments.map((department) => {
        const percent = occupancyPercent(department.counts);
        return (
          <section key={department.id} aria-label={`${department.name}: ${percent}% occupied`}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <h3 className="font-medium">{department.name}</h3>
              <span className="text-muted tabular-nums">
                {department.counts.OCCUPIED}/{department.counts.VACANT + department.counts.OCCUPIED + department.counts.MAINTENANCE} occupied ·{" "}
                {percent}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
              <div
                className={cn("h-full rounded-full", percent >= 85 ? "bg-danger" : percent >= 60 ? "bg-warning" : "bg-success")}
                style={{ width: `${percent}%` }}
              />
            </div>
            {!compact && (
              <div className="mt-3 flex flex-col gap-2">
                {department.rooms.map((room) => (
                  <div key={room.id} className="flex flex-wrap items-center gap-2">
                    <span className="w-24 shrink-0 text-xs text-subtle">
                      Room {room.roomNumber} · {room.type.toLowerCase()}
                    </span>
                    <ul className="flex flex-wrap gap-1.5">
                      {room.beds.map((bed) => (
                        <li
                          key={bed.id}
                          className={cn("flex min-w-16 items-center gap-1 rounded border px-2 py-1 text-xs", BED_STYLE[bed.status].cell)}
                          title={`${bed.bedNumber}: ${BED_STYLE[bed.status].label}`}
                        >
                          <span aria-hidden="true">{BED_STYLE[bed.status].mark}</span>
                          {bed.bedNumber}
                          <span className="sr-only">: {BED_STYLE[bed.status].label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
