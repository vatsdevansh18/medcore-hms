"use client";

import { BedDouble, CalendarCheck, IndianRupee, Stethoscope, Users } from "lucide-react";
import { StatCard } from "@/components/shared/stat-card";
import { Panel, PanelRow, Reveal } from "@/components/shared/panel";
import { AppointmentsChart } from "@/components/modules/charts/appointments-chart";
import { RevenueChart } from "@/components/modules/charts/revenue-chart";
import { OccupancyBoard } from "@/components/modules/charts/occupancy-board";
import { useAppointmentTrend, useAuditLogs, useLowStock, useOccupancy, useOverview, useRevenueTrend } from "@/services/staff";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { addDays, formatDateTime, formatMoney } from "@/lib/format";
import { ROUTES } from "@/constants";
import { DashboardHeader, PanelBody, todayIn } from "./common";

/** Hospital Admin (docs/04-UI-UX.md §5, brief "Hospital Admin Dashboard"):
 * KPI row, 7-day appointment volume, revenue, department occupancy, low
 * stock, and recent activity. `platform` is the Super Admin's
 * all-hospitals variant (no occupancy or stock, which are per hospital). */
export function AdminDashboard({ platform = false }: { platform?: boolean }) {
  const timeZone = useWorkspaceTimeZone();
  const today = todayIn(timeZone).key;
  const overview = useOverview();
  const week = useAppointmentTrend({ from: addDays(today, platform ? -13 : -6), to: today });
  const revenue = useRevenueTrend({ from: addDays(today, -29), to: today });
  const occupancy = useOccupancy(!platform);
  const lowStock = useLowStock(1, !platform);
  const activity = useAuditLogs({}, 1);
  const k = overview.data;

  return (
    <>
      <DashboardHeader
        title={platform ? "Platform overview" : "Hospital overview"}
        subtitle={k ? `Today, ${k.date} (${k.timezone})` : undefined}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {platform && <StatCard label="Active hospitals" value={k?.activeHospitals ?? 0} loading={!k} />}
        <StatCard label="Patients today" value={k?.patientsToday ?? 0} icon={Users} loading={!k} />
        <StatCard label="Appointments today" value={k?.appointmentsToday ?? 0} icon={CalendarCheck} loading={!k} />
        <StatCard label="Revenue today" value={k ? formatMoney(k.revenueToday, k.currency) : "—"} icon={IndianRupee} loading={!k} />
        {!platform && (
          <StatCard
            label="Occupied beds"
            value={k ? `${k.occupiedBeds} / ${k.totalBeds}` : "—"}
            icon={BedDouble}
            loading={!k}
          />
        )}
        <StatCard label="Active doctors" value={k?.activeDoctors ?? 0} icon={Stethoscope} loading={!k} />
      </div>
      {overview.isError && <p className="mt-2 text-sm text-danger">The figures couldn&apos;t be loaded. They refresh every minute.</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Reveal index={0}>
          <Panel title={platform ? "Appointments, last 14 days" : "Appointments, last 7 days"} href={platform ? undefined : ROUTES.staffAppointments}>
            <PanelBody query={week} empty="No appointments in this period." isEmpty={(t) => t.days.every((d) => d.total === 0)}>
              {(trend) => <AppointmentsChart trend={trend} />}
            </PanelBody>
          </Panel>
        </Reveal>
        <Reveal index={1}>
          <Panel title="Revenue, last 30 days" href={platform ? undefined : ROUTES.paymentList} linkLabel="Payments">
            <PanelBody query={revenue} empty="No billing activity in this period." isEmpty={(r) => r.totals.invoiced === "0.00" && r.totals.collected === "0.00"}>
              {(trend) => (
                <>
                  <p className="mb-2 text-sm text-muted">
                    {formatMoney(trend.totals.collected, trend.currency)} collected · {formatMoney(trend.outstanding, trend.currency)} outstanding
                    on {trend.outstandingInvoices} bill{trend.outstandingInvoices === 1 ? "" : "s"}
                  </p>
                  <RevenueChart trend={trend} />
                </>
              )}
            </PanelBody>
          </Panel>
        </Reveal>
        {!platform && (
          <Reveal index={2}>
            <Panel title="Department occupancy" href={ROUTES.beds} linkLabel="Bed board">
              <PanelBody query={occupancy} empty="No wards are set up." isEmpty={(o) => o.departments.length === 0}>
                {(data) => <OccupancyBoard data={data} compact />}
              </PanelBody>
            </Panel>
          </Reveal>
        )}
        {!platform && (
          <Reveal index={3}>
            <Panel title="Low stock" href={ROUTES.inventory} linkLabel="Inventory">
              <PanelBody query={lowStock} empty="Every medicine is above its reorder level." isEmpty={(l) => l.data.length === 0}>
                {(list) => (
                  <ul>
                    {list.data.slice(0, 6).map((m) => (
                      <PanelRow
                        key={m.id}
                        primary={m.name}
                        secondary={`Reorder at ${m.reorderLevel} ${m.unit}`}
                        trailing={
                          <span className="text-sm font-medium text-warning tabular-nums">
                            {m.availableQuantity} left
                          </span>
                        }
                      />
                    ))}
                  </ul>
                )}
              </PanelBody>
            </Panel>
          </Reveal>
        )}
        <Reveal index={4} className={platform ? "lg:col-span-2" : "lg:col-span-2"}>
          <Panel title="Recent activity" href={ROUTES.auditLog} linkLabel="Audit log">
            <PanelBody query={activity} empty="No recorded activity yet." isEmpty={(a) => a.data.length === 0}>
              {(list) => (
                <ul>
                  {list.data.slice(0, 8).map((row) => (
                    <PanelRow
                      key={row.id}
                      primary={`${row.action.toLowerCase()} ${row.entityType}`}
                      secondary={row.actor ? `${row.actor.firstName} ${row.actor.lastName} · ${row.actor.role.replace(/_/g, " ").toLowerCase()}` : "System"}
                      trailing={<span className="shrink-0 text-xs text-subtle">{formatDateTime(row.createdAt, timeZone)}</span>}
                    />
                  ))}
                </ul>
              )}
            </PanelBody>
          </Panel>
        </Reveal>
      </div>
    </>
  );
}
