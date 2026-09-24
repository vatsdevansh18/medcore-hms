"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AppointmentTrend } from "@medcore/types";
import { STATUS_SERIES, appointmentSeries } from "@/lib/chart-data";
import { statusStyle } from "@/components/shared/status-badge";

/** Status colours: the semantic tokens (§2.1), named in the legend and
 * tooltip too, so colour never carries meaning alone. */
const COLOURS: Record<(typeof STATUS_SERIES)[number], string> = {
  COMPLETED: "var(--success)",
  IN_PROGRESS: "var(--primary)",
  CONFIRMED: "var(--info)",
  PENDING: "var(--warning)",
  NO_SHOW: "var(--subtle)",
  CANCELLED: "var(--danger)",
};

/** Appointment volume per day, stacked by status (brief: "Appointment
 * volume bar chart (last 7 days)"). */
export function AppointmentsChart({ trend, height = 260 }: { trend: AppointmentTrend; height?: number }) {
  const data = appointmentSeries(trend);
  const total = data.reduce((sum, d) => sum + d.total, 0);
  return (
    <figure>
      <figcaption className="sr-only">
        Appointments per day from {trend.from} to {trend.to}: {data.map((d) => `${d.label} ${d.total}`).join(", ")}. Total {total}.
      </figcaption>
      <div style={{ height }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
            <YAxis allowDecimals={false} tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} axisLine={false} />
            <Tooltip
              cursor={{ fill: "var(--surface-muted)" }}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
              labelStyle={{ color: "var(--foreground)" }}
            />
            <Legend iconType="square" wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} />
            {STATUS_SERIES.map((status) => (
              <Bar
                key={status}
                dataKey={status}
                name={statusStyle(status).label}
                stackId="status"
                fill={COLOURS[status]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
