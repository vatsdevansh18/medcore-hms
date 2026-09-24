"use client";

import { use, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Banknote, FileCheck2, Plus } from "lucide-react";
import { InvoiceStatus, UserRole, type InvoiceItemView, type PaymentView, type StaffInvoiceView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { DataTable, type Column } from "@/components/shared/data-table";
import { RowLink } from "@/components/shared/detail-list";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormField } from "@/components/shared/form-field";
import { ErrorState, FormError } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { DownloadButton } from "@/components/shared/download-button";
import { toast } from "@/components/shared/toaster";
import { RoleGate } from "@/components/modules/role-gate";
import { fetchReceiptUrl, useAddInvoiceItem, useCashPayment, useFinalizeInvoice, useStaffInvoice } from "@/services/workflows";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { useAuthStore } from "@/store/auth-store";
import { formatDateTime, formatMoney, personName } from "@/lib/format";
import { cashSchema, invoiceItemSchema, type CashValues, type InvoiceItemValues } from "@/lib/staff-validation";
import { ROUTES } from "@/constants";

const SOURCE_LABEL: Record<string, string> = {
  CONSULTATION: "Consultation",
  LAB: "Lab",
  PHARMACY: "Pharmacy",
  ROOM: "Room",
  OTHER: "Other",
};

const PAYMENT_LABEL: Record<string, string> = { CASH: "Cash", STRIPE: "Card (Stripe)", RAZORPAY: "Razorpay" };

const OPEN_FOR_PAYMENT: string[] = [InvoiceStatus.FINALIZED, InvoiceStatus.PARTIALLY_PAID];

/** Manual lines (FR-BILL-001/002). On a DRAFT any line; once finalised only
 * a credit (negative price), which can't take the total below what's paid. */
function AddLine({ invoice, onDone }: { invoice: StaffInvoiceView; onDone: () => void }) {
  const add = useAddInvoiceItem(invoice.id);
  const draft = invoice.status === InvoiceStatus.DRAFT;
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<InvoiceItemValues>({
    resolver: zodResolver(invoiceItemSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: { sourceType: "OTHER", description: "", quantity: "1", unitPrice: draft ? "" : "-" },
  });
  const onSubmit = handleSubmit(async (v) => {
    try {
      await add.mutateAsync({ sourceType: v.sourceType, description: v.description, quantity: Number(v.quantity), unitPrice: Number(v.unitPrice) });
      toast.success(Number(v.unitPrice) < 0 ? "Credit added." : "Line added.");
      onDone();
    } catch {
      // Shown below.
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
      {!draft && <p className="mb-2 text-sm text-muted">This bill is finalised: only a credit (a negative price) can be added.</p>}
      <div className="grid gap-x-3 sm:grid-cols-[8rem_1fr_6rem_8rem]">
        <FormField label="Type" error={errors.sourceType?.message}>
          <Select {...register("sourceType")}>
            <option value="OTHER">Other</option>
            <option value="ROOM">Room</option>
          </Select>
        </FormField>
        <FormField label="Description" error={errors.description?.message}>
          <Input {...register("description")} />
        </FormField>
        <FormField label="Qty" error={errors.quantity?.message}>
          <Input inputMode="numeric" {...register("quantity")} />
        </FormField>
        <FormField label="Unit price" error={errors.unitPrice?.message} hint="Negative for a credit.">
          <Input inputMode="decimal" {...register("unitPrice")} />
        </FormField>
      </div>
      <FormError error={add.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={add.isPending}>
          Add line
        </Button>
      </div>
    </form>
  );
}

/** Cash at the desk (FR-BILL-004/006): at most the balance, then a receipt. */
function CashPayment({ invoice }: { invoice: StaffInvoiceView }) {
  const balance = Number(invoice.balanceDue);
  const pay = useCashPayment(invoice.id);
  const [amount, setAmount] = useState<number | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CashValues>({
    resolver: zodResolver(cashSchema(balance)),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: { amount: invoice.balanceDue },
  });

  async function record() {
    if (amount === null) return;
    try {
      const { invoice: updated } = await pay.mutateAsync(amount);
      setAmount(null);
      reset({ amount: updated.balanceDue });
      toast.success(`${formatMoney(amount, invoice.currency)} received in cash.`);
    } catch {
      // Shown in the dialog.
    }
  }

  return (
    <Panel title="Take a cash payment">
      <form
        onSubmit={handleSubmit((v) => {
          pay.reset();
          setAmount(Number(v.amount));
        })}
        noValidate
        className="flex flex-col gap-1"
      >
        <FormField label={`Amount (${invoice.currency})`} error={errors.amount?.message} hint={`Balance due ${formatMoney(balance, invoice.currency)}.`}>
          <Input inputMode="decimal" {...register("amount")} />
        </FormField>
        <div className="flex justify-end">
          <Button type="submit">
            <Banknote aria-hidden="true" /> Record cash
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={amount !== null}
        onOpenChange={(open) => !open && setAmount(null)}
        title="Record this cash payment?"
        consequence={`${formatMoney(amount ?? 0, invoice.currency)} is recorded as received in cash, a receipt is issued, and the patient is notified.`}
        confirmLabel="Record payment"
        pending={pay.isPending}
        error={pay.error}
        onConfirm={() => void record()}
      />
    </Panel>
  );
}

function Finalize({ invoice }: { invoice: StaffInvoiceView }) {
  const finalize = useFinalizeInvoice(invoice.id);
  const [open, setOpen] = useState(false);
  async function run() {
    try {
      await finalize.mutateAsync();
      setOpen(false);
      toast.success("Bill finalised. The patient can now see and pay it.");
    } catch {
      // Shown in the dialog.
    }
  }
  return (
    <>
      <Button
        onClick={() => {
          finalize.reset();
          setOpen(true);
        }}
        disabled={invoice.items.length === 0}
      >
        <FileCheck2 aria-hidden="true" /> Finalise bill
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Finalise this bill?"
        consequence={`The total of ${formatMoney(invoice.total, invoice.currency)} is locked and shown to the patient for payment. Later corrections can only be credits.`}
        confirmLabel="Finalise"
        pending={finalize.isPending}
        error={finalize.error}
        onConfirm={() => void run()}
      />
    </>
  );
}

function InvoiceDetail({ id }: { id: string }) {
  const role = useAuthStore((s) => s.user?.role);
  const timeZone = useWorkspaceTimeZone();
  const invoice = useStaffInvoice(id);
  const [adding, setAdding] = useState(false);
  if (invoice.isPending) return <Skeleton className="h-64" />;
  if (invoice.isError) return <ErrorState error={invoice.error} onRetry={() => void invoice.refetch()} />;
  const inv = invoice.data;
  const desk = role === UserRole.RECEPTIONIST || role === UserRole.ACCOUNTANT;
  const draft = inv.status === InvoiceStatus.DRAFT;
  const canAddLine = desk && (draft || OPEN_FOR_PAYMENT.includes(inv.status));

  const lineColumns: Column<InvoiceItemView>[] = [
    { key: "type", header: "Type", cell: (i) => SOURCE_LABEL[i.sourceType] ?? i.sourceType },
    { key: "desc", header: "Description", cell: (i) => i.description },
    { key: "qty", header: "Qty", align: "right", cell: (i) => i.quantity },
    { key: "price", header: "Unit price", align: "right", cell: (i) => formatMoney(i.unitPrice, inv.currency), hideOnMobile: true },
    { key: "total", header: "Amount", align: "right", cell: (i) => formatMoney(i.lineTotal, inv.currency) },
  ];
  const paymentColumns: Column<PaymentView>[] = [
    { key: "when", header: "When", cell: (p) => formatDateTime(p.createdAt, timeZone) },
    { key: "method", header: "Method", cell: (p) => PAYMENT_LABEL[p.method] ?? p.method },
    { key: "amount", header: "Amount", align: "right", cell: (p) => formatMoney(p.amount, p.currency) },
    { key: "status", header: "Status", cell: (p) => <StatusBadge status={p.status} kind="payment" /> },
    {
      key: "receipt",
      header: "Receipt",
      cell: (p) => (p.status === "SUCCEEDED" ? <DownloadButton label="Receipt" fetchUrl={() => fetchReceiptUrl(p.id)} /> : "—"),
    },
  ];

  return (
    <>
      <PageHeader
        title={`Bill · ${personName(inv.patient)}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={inv.status} />
            <span>Opened {formatDateTime(inv.createdAt, timeZone)}</span>
            {role !== UserRole.ACCOUNTANT && (
              <RowLink href={ROUTES.staffAppointment(inv.appointmentId)}>View visit</RowLink>
            )}
          </span>
        }
        back={{ href: ROUTES.invoiceQueue, label: "Bills" }}
        actions={desk && draft ? <Finalize invoice={inv} /> : undefined}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <Panel
            title="Lines"
            actions={
              canAddLine &&
              !adding && (
                <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
                  <Plus aria-hidden="true" /> {draft ? "Add line" : "Add credit"}
                </Button>
              )
            }
          >
            <DataTable
              caption="Invoice lines"
              columns={lineColumns}
              rows={inv.items}
              rowKey={(i) => i.id}
              loading={false}
              empty={{ title: "No lines yet", description: "Consultation, lab, and pharmacy charges appear here automatically." }}
              density="compact"
            />
            {adding && <AddLine invoice={inv} onDone={() => setAdding(false)} />}
          </Panel>
          <Panel title="Payments">
            <DataTable
              caption="Payments"
              columns={paymentColumns}
              rows={inv.payments}
              rowKey={(p) => p.id}
              loading={false}
              empty={{ title: "No payments yet" }}
              density="compact"
            />
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Summary">
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted">Subtotal</dt>
              <dd className="text-right tabular-nums">{formatMoney(inv.subtotal, inv.currency)}</dd>
              <dt className="text-muted">Total</dt>
              <dd className="text-right font-semibold tabular-nums">{formatMoney(inv.total, inv.currency)}</dd>
              <dt className="text-muted">Paid</dt>
              <dd className="text-right tabular-nums">{formatMoney(inv.amountPaid, inv.currency)}</dd>
              <dt className="text-muted">Balance due</dt>
              <dd className="text-right font-semibold tabular-nums">{formatMoney(inv.balanceDue, inv.currency)}</dd>
            </dl>
            {draft && <p className="mt-3 text-xs text-muted">The patient can&apos;t see this bill until it&apos;s finalised.</p>}
          </Panel>
          {desk && OPEN_FOR_PAYMENT.includes(inv.status) && Number(inv.balanceDue) > 0 && <CashPayment invoice={inv} />}
        </div>
      </div>
    </>
  );
}

export default function StaffInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RoleGate route="/dashboard/invoices/:id">
      <InvoiceDetail id={id} />
    </RoleGate>
  );
}
