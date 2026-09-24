"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { SlotView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { useAvailability } from "@/services/portal";
import { useHospital } from "@/hooks/use-hospital";
import { addDays, formatDateKey, formatTime, todayKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BOOKING_HORIZON_DAYS } from "@/constants";

const WEEK = 7;

/**
 * Open slots for one doctor, a week at a time, in the hospital's timezone.
 * Days and slots come from the server (D-037); the page never invents a
 * time. `excludeStart` hides the appointment's own current slot when
 * rescheduling.
 */
export function SlotPicker({
  doctorId,
  selected,
  onSelect,
  excludeStart,
}: {
  doctorId: string;
  selected: SlotView | null;
  onSelect: (slot: SlotView) => void;
  excludeStart?: string;
}) {
  const { timezone } = useHospital();
  const today = todayKey(timezone);
  const [weekOffset, setWeekOffset] = useState(0);
  const from = addDays(today, weekOffset * WEEK);
  const to = addDays(from, WEEK - 1);
  const availability = useAvailability(doctorId, from, to);
  const lastWeek = Math.floor((BOOKING_HORIZON_DAYS - 1) / WEEK);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setWeekOffset((w) => w - 1)}
          disabled={weekOffset === 0}
          aria-label="Previous week"
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <p className="text-sm font-medium" aria-live="polite">
          {formatDateKey(from)} – {formatDateKey(to)}
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setWeekOffset((w) => w + 1)}
          disabled={weekOffset >= lastWeek}
          aria-label="Next week"
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>

      {availability.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Loading times">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : availability.isError ? (
        <ErrorState error={availability.error} onRetry={() => void availability.refetch()} />
      ) : (
        (() => {
          const days = availability.data
            .map((day) => ({ ...day, slots: day.slots.filter((s) => s.start !== excludeStart) }))
            .filter((day) => day.slots.length > 0);
          if (days.length === 0) {
            return (
              <EmptyState
                title="No open times this week"
                description={weekOffset < lastWeek ? "Try the next week." : "Please contact the hospital to book."}
              />
            );
          }
          return (
            <div className="flex flex-col gap-4">
              {days.map((day) => (
                <fieldset key={day.date}>
                  <legend className="mb-2 text-sm font-medium">{formatDateKey(day.date, { month: "long" })}</legend>
                  <div className="flex flex-wrap gap-2">
                    {day.slots.map((slot) => {
                      const isSelected = selected?.start === slot.start;
                      return (
                        <button
                          key={slot.start}
                          type="button"
                          onClick={() => onSelect(slot)}
                          aria-pressed={isSelected}
                          className={cn(
                            "min-w-24 rounded-md border px-3 py-2 text-sm",
                            isSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border-strong bg-surface hover:border-primary",
                          )}
                        >
                          {formatTime(slot.start, timezone)}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          );
        })()
      )}
      <p className="mt-3 text-xs text-subtle">Times are shown in the hospital&apos;s local time ({timezone}).</p>
    </div>
  );
}
