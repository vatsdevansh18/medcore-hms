"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarCheck, Clock, FileText, FlaskConical, IndianRupee, PackageX, Pill, Receipt, Search } from "lucide-react";
import { AppointmentStatus, InvoiceStatus, LabOrderItemStatus, PaymentStatus, PrescriptionStatus } from "@medcore/types";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Panel, PanelRow, Reveal } from "@/components/shared/panel";
import { OccupancyBoard } from "@/components/modules/charts/occupancy-board";
import { RevenueChart } from "@/components/modules/charts/revenue-chart";
import { searchHref } from "@/components/modules/global-search";
import {
  useExpiring,
  useInvoiceQueue,
  useLabQueue,
  useLowStock,
  useOccupancy,
  usePaymentList,
  usePrescriptionQueue,
  useRevenueTrend,
  useStaffAppointments,
} from "@/services/staff";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { addDays, doctorName, formatCalendarDate, formatDate, formatDateTime, formatMoney, formatTime, personName } from "@/lib/format";
import { ROUTES } from "@/constants";
import { DashboardHeader, PanelBody, RangePicker, todayIn } from "./common";

/** Receptionist (§5): today's schedule across all doctors, what still
 * needs confirming, and draft bills to finish. */
export function ReceptionistDashboard() {
  const timeZone = useWorkspaceTimeZone();
  const today = todayIn(timeZone);
  const schedule = useStaffAppointments({ dateFrom: today.from, dateTo: today.to, sortOrder: "asc" }, 1);
  const pending = useStaffAppointments({ dateFrom: today.from, status: [AppointmentStatus.PENDING], sortOrder: "asc" }, 1);
  const drafts = useInvoiceQueue({ status: [InvoiceStatus.DRAFT] }, 1);

  return (
    <>
      <DashboardHeader title="Front desk" subtitle={formatDate(new Date().toISOString(), timeZone)} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Appointments today" value={schedule.data?.meta.total ?? 0} icon={CalendarCheck} loading={schedule.isPending} />
        <StatCard label="Awaiting confirmation" value={pending.data?.meta.total ?? 0} icon={Clock} loading={pending.isPending} hint="From today onward" />
        <StatCard label="Draft bills" value={drafts.data?.meta.total ?? 0} icon={FileText} loading={drafts.isPending} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Reveal index={0} className="lg:col-span-2">
          <Panel title="Today's schedule" href={ROUTES.staffAppointments} linkLabel="Full schedule">
            <PanelBody query={schedule} empty="No appointments today." isEmpty={(s) => s.data.length === 0} rows={6}>
              {(list) => (
                <ul>
                  {list.data.map((a) => (
                    <PanelRow
                      key={a.id}
                      primary={`${formatTime(a.scheduledStart, timeZone)} · ${personName(a.patient.user)}`}
                      secondary={`${doctorName(a.doctor.user)} · ${a.doctor.specialization}`}
                      trailing={<StatusBadge status={a.status} />}
                    />
                  ))}
                </ul>
              )}
            </PanelBody>
          </Panel>
        </Reveal>
        <div className="flex flex-col gap-4">
          <Reveal index={1}>
            <Panel title="Awaiting confirmation" href={`${ROUTES.staffAppointments}?status=PENDING`}>
              <PanelBody query={pending} empty="Nothing waiting." isEmpty={(s) => s.data.length === 0}>
                {(list) => (
                  <ul>
                    {list.data.slice(0, 5).map((a) => (
                      <PanelRow
                        key={a.id}
                        primary={personName(a.patient.user)}
                        secondary={`${formatDateTime(a.scheduledStart, timeZone)} · ${doctorName(a.doctor.user)}`}
                      />
                    ))}
                  </ul>
                )}
              </PanelBody>
            </Panel>
          </Reveal>
          <Reveal index={2}>
            <Panel title="Draft bills" href={`${ROUTES.invoiceQueue}?status=DRAFT`}>
              <PanelBody query={drafts} empty="No draft bills." isEmpty={(d) => d.data.length === 0}>
                {(list) => (
                  <ul>
                    {list.data.slice(0, 5).map((inv) => (
                      <PanelRow
                        key={inv.id}
                        primary={personName(inv.patient)}
                        secondary={formatDate(inv.createdAt, timeZone)}
                        trailing={<span className="text-sm tabular-nums">{formatMoney(inv.total, inv.currency)}</span>}
                      />
                    ))}
                  </ul>
                )}
              </PanelBody>
            </Panel>
          </Reveal>
        </div>
      </div>
    </>
  );
}

/** Nurse (§5): the ward bed board and today's patients in clinic. The
 * medication administration checklist needs inpatient medication records,
 * which are outside the project's scope (docs/11-DECISIONS.md D-007). */
export function NurseDashboard() {
  const timeZone = useWorkspaceTimeZone();
  const today = todayIn(timeZone);
  const occupancy = useOccupancy();
  const inClinic = useStaffAppointments(
    { dateFrom: today.from, dateTo: today.to, status: [AppointmentStatus.IN_PROGRESS, AppointmentStatus.CONFIRMED], sortOrder: "asc" },
    1,
  );
  return (
    <>
      <DashboardHeader title="Ward & clinic" subtitle={formatDate(new Date().toISOString(), timeZone)} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Reveal index={0} className="lg:col-span-2">
          <Panel title="Bed board" href={ROUTES.beds} linkLabel="Full board">
            <PanelBody query={occupancy} empty="No wards are set up." isEmpty={(o) => o.departments.length === 0} rows={5}>
              {(data) => <OccupancyBoard data={data} />}
            </PanelBody>
          </Panel>
        </Reveal>
        <Reveal index={1}>
          <Panel title="Patients in clinic today" href={ROUTES.staffAppointments}>
            <PanelBody query={inClinic} empty="No confirmed patients today." isEmpty={(s) => s.data.length === 0} rows={5}>
              {(list) => (
                <ul>
                  {list.data.map((a) => (
                    <PanelRow
                      key={a.id}
                      primary={`${formatTime(a.scheduledStart, timeZone)} · ${personName(a.patient.user)}`}
                      secondary={a.status === AppointmentStatus.IN_PROGRESS ? "With the doctor now: vitals due" : doctorName(a.doctor.user)}
                      trailing={<StatusBadge status={a.status} />}
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

const LAB_STAGES = [
  { status: LabOrderItemStatus.ORDERED, label: "To collect" },
  { status: LabOrderItemStatus.SAMPLE_COLLECTED, label: "Collected" },
  { status: LabOrderItemStatus.IN_PROGRESS, label: "Testing" },
  { status: LabOrderItemStatus.RESULT_UPLOADED, label: "Awaiting approval" },
] as const;

/** Lab Technician (§5): orders by status, urgent first. */
export function LabDashboard() {
  const timeZone = useWorkspaceTimeZone();
  const counts = [
    useLabQueue({ status: [LAB_STAGES[0].status] }, 1),
    useLabQueue({ status: [LAB_STAGES[1].status] }, 1),
    useLabQueue({ status: [LAB_STAGES[2].status] }, 1),
    useLabQueue({ status: [LAB_STAGES[3].status] }, 1),
  ];
  const queue = useLabQueue({ status: LAB_STAGES.map((s) => s.status) }, 1);
  return (
    <>
      <DashboardHeader title="Laboratory queue" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {LAB_STAGES.map((stage, i) => (
          <StatCard key={stage.status} label={stage.label} value={counts[i].data?.meta.total ?? 0} icon={FlaskConical} loading={counts[i].isPending} />
        ))}
      </div>
      <div className="mt-4">
        <Reveal index={0}>
          <Panel title="Open orders (urgent first)" href={ROUTES.labQueue} linkLabel="Full queue">
            <PanelBody query={queue} empty="The queue is empty." isEmpty={(q) => q.data.length === 0} rows={6}>
              {(list) => (
                <ul>
                  {list.data.slice(0, 10).map((o) => (
                    <PanelRow
                      key={o.id}
                      primary={
                        <>
                          {o.priority === "URGENT" && (
                            <span className="mr-2 inline-flex items-center gap-1 text-xs font-semibold text-danger">
                              <AlertTriangle className="size-3.5" aria-hidden="true" /> Urgent
                            </span>
                          )}
                          {personName(o.patient)}
                        </>
                      }
                      secondary={`${o.items.map((i) => i.labTest.name).join(", ")} · ordered ${formatDateTime(o.createdAt, timeZone)} by ${doctorName(o.doctor.user)}`}
                      trailing={<StatusBadge status={o.items[0]?.status ?? "ORDERED"} kind="lab" />}
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

/** Pharmacist (§5): prescriptions to dispense, low stock, expiring soon,
 * and a medicine lookup. */
export function PharmacistDashboard() {
  const router = useRouter();
  const timeZone = useWorkspaceTimeZone();
  const [lookup, setLookup] = useState("");
  const toDispense = usePrescriptionQueue({ status: [PrescriptionStatus.ISSUED, PrescriptionStatus.PARTIALLY_DISPENSED] }, 1);
  const lowStock = useLowStock(1);
  const expiring = useExpiring(30, 1);
  return (
    <>
      <DashboardHeader title="Pharmacy" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="To dispense" value={toDispense.data?.meta.total ?? 0} icon={Pill} loading={toDispense.isPending} />
        <StatCard label="Low stock" value={lowStock.data?.meta.total ?? 0} icon={PackageX} loading={lowStock.isPending} />
        <StatCard label="Expiring in 30 days" value={expiring.data?.meta.total ?? 0} icon={AlertTriangle} loading={expiring.isPending} hint="Batches" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Reveal index={0} className="lg:col-span-2">
          <Panel title="Prescriptions to dispense" href={ROUTES.rxQueue} linkLabel="Full queue">
            <PanelBody query={toDispense} empty="Nothing waiting to be dispensed." isEmpty={(q) => q.data.length === 0} rows={6}>
              {(list) => (
                <ul>
                  {list.data.slice(0, 8).map((p) => (
                    <PanelRow
                      key={p.id}
                      primary={personName(p.patient)}
                      secondary={`${formatDateTime(p.createdAt, timeZone)} · ${p.items.map((i) => i.medicine.name).join(", ")}`}
                      trailing={<StatusBadge status={p.status} kind="staff-rx" />}
                    />
                  ))}
                </ul>
              )}
            </PanelBody>
          </Panel>
        </Reveal>
        <div className="flex flex-col gap-4">
          <Reveal index={1}>
            <Panel title="Medicine lookup">
              <form
                role="search"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (lookup.trim().length >= 2) router.push(searchHref(lookup.trim(), "medicines"));
                }}
                className="flex gap-2"
              >
                <Input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="Brand or generic name" aria-label="Find a medicine" />
                <button type="submit" className="rounded-md border border-border-strong px-3 text-muted hover:text-foreground" aria-label="Search medicines">
                  <Search className="size-4" aria-hidden="true" />
                </button>
              </form>
            </Panel>
          </Reveal>
          <Reveal index={2}>
            <Panel title="Low stock" href={ROUTES.inventory}>
              <PanelBody query={lowStock} empty="Everything is above its reorder level." isEmpty={(l) => l.data.length === 0}>
                {(list) => (
                  <ul>
                    {list.data.slice(0, 5).map((m) => (
                      <PanelRow key={m.id} primary={m.name} trailing={<span className="text-sm text-warning tabular-nums">{m.availableQuantity} / {m.reorderLevel}</span>} />
                    ))}
                  </ul>
                )}
              </PanelBody>
            </Panel>
          </Reveal>
          <Reveal index={3}>
            <Panel title="Expiring soon" href={`${ROUTES.inventory}#expiring`}>
              <PanelBody query={expiring} empty="No batches expire in the next 30 days." isEmpty={(l) => l.data.length === 0}>
                {(list) => (
                  <ul>
                    {list.data.slice(0, 5).map((b) => (
                      <PanelRow
                        key={b.id}
                        primary={b.medicine.name}
                        secondary={`Batch ${b.batchNumber} · ${b.quantityOnHand} ${b.medicine.unit}`}
                        trailing={<span className="text-xs text-danger">{formatCalendarDate(b.expiryDate)}</span>}
                      />
                    ))}
                  </ul>
                )}
              </PanelBody>
            </Panel>
          </Reveal>
        </div>
      </div>
    </>
  );
}

/** Accountant (§5): collections, outstanding bills, and the payments that
 * need reconciling. */
export function AccountantDashboard() {
  const timeZone = useWorkspaceTimeZone();
  const today = todayIn(timeZone).key;
  const [days, setDays] = useState(30);
  const revenue = useRevenueTrend({ from: addDays(today, -(days - 1)), to: today });
  const outstanding = useInvoiceQueue({ status: [InvoiceStatus.FINALIZED, InvoiceStatus.PARTIALLY_PAID] }, 1);
  const toReconcile = usePaymentList({ status: [PaymentStatus.PENDING, PaymentStatus.FAILED] }, 1);
  const r = revenue.data;
  return (
    <>
      <DashboardHeader title="Finance" actions={<RangePicker value={days} onChange={setDays} />} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={`Collected, last ${days} days`} value={r ? formatMoney(r.totals.collected, r.currency) : "—"} icon={IndianRupee} loading={!r} />
        <StatCard label={`Invoiced, last ${days} days`} value={r ? formatMoney(r.totals.invoiced, r.currency) : "—"} icon={Receipt} loading={!r} />
        <StatCard
          label="Outstanding now"
          value={r ? formatMoney(r.outstanding, r.currency) : "—"}
          hint={r ? `${r.outstandingInvoices} unpaid or part-paid bill${r.outstandingInvoices === 1 ? "" : "s"}` : undefined}
          icon={AlertTriangle}
          loading={!r}
        />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Reveal index={0} className="lg:col-span-3">
          <Panel title="Collections and invoicing">
            <PanelBody query={revenue} empty="No billing activity in this period." isEmpty={(t) => t.totals.invoiced === "0.00" && t.totals.collected === "0.00"} rows={6}>
              {(trend) => <RevenueChart trend={trend} height={280} />}
            </PanelBody>
          </Panel>
        </Reveal>
        <Reveal index={1} className="lg:col-span-2">
          <Panel title="Outstanding bills" href={`${ROUTES.invoiceQueue}?status=FINALIZED,PARTIALLY_PAID`}>
            <PanelBody query={outstanding} empty="No outstanding bills." isEmpty={(q) => q.data.length === 0}>
              {(list) => (
                <ul>
                  {list.data.slice(0, 8).map((inv) => (
                    <PanelRow
                      key={inv.id}
                      primary={personName(inv.patient)}
                      secondary={`Finalized ${formatDate(inv.finalizedAt, timeZone)}`}
                      trailing={
                        <span className="flex items-center gap-2">
                          <span className="text-sm tabular-nums">{formatMoney(inv.total, inv.currency)}</span>
                          <StatusBadge status={inv.status} />
                        </span>
                      }
                    />
                  ))}
                </ul>
              )}
            </PanelBody>
          </Panel>
        </Reveal>
        <Reveal index={2}>
          <Panel title="To reconcile" href={`${ROUTES.paymentList}?status=PENDING,FAILED`}>
            <PanelBody query={toReconcile} empty="No pending or failed payments." isEmpty={(q) => q.data.length === 0}>
              {(list) => (
                <ul>
                  {list.data.slice(0, 6).map((p) => (
                    <PanelRow
                      key={p.id}
                      primary={`${formatMoney(p.amount, p.currency)} · ${p.method.toLowerCase()}`}
                      secondary={`${personName(p.patient)} · ${formatDateTime(p.createdAt, timeZone)}`}
                      trailing={<StatusBadge status={p.status} kind="payment" />}
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
