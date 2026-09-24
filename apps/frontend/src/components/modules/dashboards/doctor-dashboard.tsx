"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { LabOrderItemStatus } from "@medcore/types";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/shared/status-badge";
import { Panel, PanelRow, Reveal } from "@/components/shared/panel";
import { MonthCalendar } from "@/components/modules/charts/month-calendar";
import { searchHref } from "@/components/modules/global-search";
import { useAppointmentTrend, useLabQueue, usePrescriptionQueue, useStaffAppointments } from "@/services/staff";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { useAuthStore } from "@/store/auth-store";
import { formatDate, formatTime, personName } from "@/lib/format";
import { monthRange } from "@/lib/chart-data";
import { ROUTES } from "@/constants";
import { DashboardHeader, PanelBody, todayIn } from "./common";

const OPEN_LAB = [LabOrderItemStatus.ORDERED, LabOrderItemStatus.SAMPLE_COLLECTED, LabOrderItemStatus.IN_PROGRESS, LabOrderItemStatus.RESULT_UPLOADED];

/** Doctor (brief "Doctor Dashboard"): today's timeline, patient lookup,
 * lab results pending approval, a month calendar, recent prescriptions. */
export function DoctorDashboard() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const timeZone = useWorkspaceTimeZone();
  const today = todayIn(timeZone);
  const month = monthRange(today.key);
  const [lookup, setLookup] = useState("");

  const timeline = useStaffAppointments({ dateFrom: today.from, dateTo: today.to, sortOrder: "asc" }, 1);
  const pendingLab = useLabQueue({ status: OPEN_LAB }, 1);
  const calendar = useAppointmentTrend({ from: month.from, to: month.to });
  const recentRx = usePrescriptionQueue({}, 1);

  return (
    <>
      <DashboardHeader title={`Good day, Dr. ${user?.lastName ?? ""}`} subtitle={formatDate(new Date().toISOString(), timeZone)} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Reveal index={0} className="lg:col-span-2">
          <Panel title="Today's appointments" href={ROUTES.staffAppointments} linkLabel="Full schedule">
            <PanelBody query={timeline} empty="No appointments today." isEmpty={(t) => t.data.length === 0} rows={5}>
              {(list) => (
                <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
                  {list.data.map((a) => (
                    <li key={a.id} className="relative">
                      <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-primary" aria-hidden="true" />
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="w-20 text-sm font-medium tabular-nums">{formatTime(a.scheduledStart, timeZone)}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">{personName(a.patient.user)}</span>
                        <StatusBadge status={a.status} />
                      </div>
                      {a.reasonForVisit && <p className="ml-20 pl-3 text-xs text-muted">{a.reasonForVisit}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </PanelBody>
          </Panel>
        </Reveal>
        <Reveal index={1}>
          <Panel title="Patient lookup">
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                if (lookup.trim().length >= 2) router.push(searchHref(lookup.trim(), "patients"));
              }}
              className="flex gap-2"
            >
              <Input
                value={lookup}
                onChange={(e) => setLookup(e.target.value)}
                placeholder="Name, email, or phone"
                aria-label="Find a patient"
              />
              <button type="submit" className="rounded-md border border-border-strong px-3 text-muted hover:text-foreground" aria-label="Search patients">
                <Search className="size-4" aria-hidden="true" />
              </button>
            </form>
            <div className="mt-4">
              <PanelBody query={calendar} empty="" rows={4}>
                {(trend) => (
                  <MonthCalendar
                    year={month.year}
                    month={month.month}
                    today={today.key}
                    counts={new Map(trend.days.map((d) => [d.date, d.total]))}
                  />
                )}
              </PanelBody>
            </div>
          </Panel>
        </Reveal>
        <Reveal index={2}>
          <Panel title="Lab results pending" href={ROUTES.labQueue} linkLabel="My lab orders">
            <PanelBody query={pendingLab} empty="Nothing waiting on the lab." isEmpty={(l) => l.data.length === 0}>
              {(list) => (
                <ul>
                  {list.data.slice(0, 6).map((o) => (
                    <PanelRow
                      key={o.id}
                      primary={personName(o.patient)}
                      secondary={o.items.map((i) => i.labTest.name).join(", ")}
                      trailing={<StatusBadge status={o.items[0]?.status ?? "ORDERED"} kind="lab" />}
                    />
                  ))}
                </ul>
              )}
            </PanelBody>
          </Panel>
        </Reveal>
        <Reveal index={3} className="lg:col-span-2">
          <Panel title="Recent prescriptions" href={ROUTES.rxQueue} linkLabel="All my prescriptions">
            <PanelBody query={recentRx} empty="You haven't written any prescriptions yet." isEmpty={(l) => l.data.length === 0}>
              {(list) => (
                <ul>
                  {list.data.slice(0, 6).map((p) => (
                    <PanelRow
                      key={p.id}
                      primary={personName(p.patient)}
                      secondary={`${formatDate(p.createdAt, timeZone)} · ${p.items.map((i) => i.medicine.name).join(", ")}`}
                      trailing={<StatusBadge status={p.status} kind="staff-rx" />}
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
