"use client";

import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { RevenueTrend } from "@medcore/types";
import { revenueSeries } from "@/lib/chart-data";
import { formatMoney } from "@/lib/format";

/** Money collected (SUCCEEDED payments) and invoiced (finalized totals) per day. */
export function RevenueChart({ trend, height = 260 }: { trend: RevenueTrend; height?: number }) {
  const data = revenueSeries(trend);
  const money = (value: number) => formatMoney(value, trend.currency);
  return (
    <figure>
      <figcaption className="sr-only">
        Revenue from {trend.from} to {trend.to}: {money(Number(trend.totals.collected))} collected,{" "}
        {money(Number(trend.totals.invoiced))} invoiced.
      </figcaption>
      <div style={{ height }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart accessibilityLayer={false} data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={16} />
            <YAxis
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={64}
              tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
            />
            <Tooltip
              formatter={(value) => money(Number(value))}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
              labelStyle={{ color: "var(--foreground)" }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} />
            <Area
              type="linear"
              dataKey="invoiced"
              name="Invoiced"
              stroke="var(--info)"
              fill="var(--info-surface)"
              strokeDasharray="4 3"
              isAnimationActive={false}
            />
            <Area
              type="linear"
              dataKey="collected"
              name="Collected"
              stroke="var(--success)"
              fill="var(--success-surface)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
