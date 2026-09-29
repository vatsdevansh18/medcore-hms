"use client";

import { Suspense, use, useEffect, useRef, useState } from "react";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, CreditCard, Info, Loader2, Smartphone } from "lucide-react";
import { InvoiceStatus, PaymentProvider, PaymentStatus, type InvoiceView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ErrorState, FormError, ListSkeleton } from "@/components/shared/states";
import { DownloadButton } from "@/components/shared/download-button";
import { FullPageLoader } from "@/components/modules/full-page-loader";
import { paymentReceipt, useInvoice, useStartCheckout } from "@/services/portal";
import { useHospital } from "@/hooks/use-hospital";
import { useAuthStore } from "@/store/auth-store";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { openRazorpayCheckout } from "@/lib/razorpay";
import { errorCode } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/constants";

const PAYABLE: string[] = [InvoiceStatus.FINALIZED, InvoiceStatus.PARTIALLY_PAID];
/** How long to keep checking after returning from a checkout. */
const CONFIRM_WINDOW_MS = 90_000;

const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash at counter",
  STRIPE: "Card",
  RAZORPAY: "UPI / Netbanking",
};

function PayDialog({ invoice, open, onOpenChange }: { invoice: InvoiceView; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const hospital = useHospital();
  const user = useAuthStore((s) => s.user);
  const checkout = useStartCheckout(invoice.id);
  const [provider, setProvider] = useState<PaymentProvider>(PaymentProvider.STRIPE);
  const [scriptError, setScriptError] = useState<unknown>(null);

  async function pay() {
    setScriptError(null);
    try {
      const session = await checkout.mutateAsync(provider);
      if (session.provider === PaymentProvider.STRIPE && session.checkoutUrl) {
        window.location.assign(session.checkoutUrl);
        return;
      }
      if (session.provider === PaymentProvider.RAZORPAY && session.keyId) {
        await openRazorpayCheckout({
          key: session.keyId,
          order_id: session.reference,
          amount: session.amount,
          currency: session.currency,
          name: hospital.name || "MedCore HMS",
          description: `Bill ${invoice.id.slice(0, 8)}`,
          prefill: { name: user ? `${user.firstName} ${user.lastName}` : undefined, email: user?.email },
          theme: { color: "#0A2A5E" },
          handler: () => router.replace(`${ROUTES.invoice(invoice.id)}?checkout=processing`),
          modal: { ondismiss: () => router.replace(`${ROUTES.invoice(invoice.id)}?checkout=cancelled`) },
        });
        onOpenChange(false);
      }
    } catch (error) {
      if (!(error instanceof Error) || errorCode(error)) return; // API errors show below.
      setScriptError(error);
    }
  }

  const options = [
    { value: PaymentProvider.STRIPE, label: "Card", hint: "Visa, Mastercard, RuPay (Stripe)", icon: CreditCard },
    { value: PaymentProvider.RAZORPAY, label: "UPI / Netbanking", hint: "Razorpay", icon: Smartphone },
  ];

  const returnFocus = useReturnFocus(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={returnFocus}>
        <DialogTitle>Pay {formatMoney(invoice.balanceDue, invoice.currency)}</DialogTitle>
        <DialogDescription>
          You&apos;ll finish paying on the provider&apos;s secure page. We confirm the payment with them directly, which
          can take a few seconds.
        </DialogDescription>
        <fieldset className="mt-4 flex flex-col gap-2">
          <legend className="sr-only">Payment method</legend>
          {options.map((o) => (
            <label
              key={o.value}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-md border p-3",
                provider === o.value ? "border-primary bg-primary-surface" : "border-border-strong",
              )}
            >
              <input
                type="radio"
                name="provider"
                value={o.value}
                checked={provider === o.value}
                onChange={() => setProvider(o.value)}
                className="accent-[var(--primary)]"
              />
              <o.icon className="size-4 text-muted" aria-hidden="true" />
              <span>
                <span className="block font-medium">{o.label}</span>
                <span className="block text-xs text-subtle">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {(checkout.error || scriptError) ? (
          <div className="mt-4 flex flex-col gap-2">
            <FormError error={checkout.error ?? scriptError} />
            {errorCode(checkout.error) === "PAYMENT_PROVIDER_UNAVAILABLE" && (
              <p className="text-sm text-muted">You can also pay at the hospital&apos;s billing counter.</p>
            )}
          </div>
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button onClick={() => void pay()} loading={checkout.isPending}>
            Continue to payment
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceDetail({ id }: { id: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const { timezone } = useHospital();
  const checkoutState = params.get("checkout");
  const [confirming, setConfirming] = useState(checkoutState === "processing");
  const [payOpen, setPayOpen] = useState(false);
  const invoice = useInvoice(id, confirming ? 3_000 : false);
  const startedAt = useRef(Date.now());

  // After a checkout, poll until the webhook has settled the payment (or
  // give up after a while: it's still applied later, and we notify).
  const settled = invoice.data?.status === InvoiceStatus.PAID;
  useEffect(() => {
    if (!confirming) return;
    if (settled) {
      setConfirming(false);
      return;
    }
    const timer = setTimeout(() => setConfirming(false), Math.max(0, CONFIRM_WINDOW_MS - (Date.now() - startedAt.current)));
    return () => clearTimeout(timer);
  }, [confirming, settled]);

  const back = { href: ROUTES.invoices, label: "Bills & payments" };
  if (invoice.isPending) {
    return (
      <>
        <PageHeader title="Bill" back={back} />
        <ListSkeleton rows={2} />
      </>
    );
  }
  if (invoice.isError) {
    return (
      <>
        <PageHeader title="Bill" back={back} />
        <ErrorState error={invoice.error} onRetry={() => void invoice.refetch()} />
      </>
    );
  }

  const inv = invoice.data;
  const payable = PAYABLE.includes(inv.status) && Number(inv.balanceDue) > 0;
  const dismissBanner = () => router.replace(ROUTES.invoice(inv.id));

  return (
    <>
      <PageHeader
        title={`Bill · ${formatMoney(inv.total, inv.currency)}`}
        description={`Issued ${formatDate(inv.finalizedAt ?? inv.createdAt, timezone)}`}
        back={back}
        actions={payable && !confirming ? <Button onClick={() => setPayOpen(true)}>Pay {formatMoney(inv.balanceDue, inv.currency)}</Button> : undefined}
      />

      {checkoutState === "processing" && (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-md bg-info-surface px-3 py-3 text-sm text-info">
          {settled ? (
            <>
              <CheckCircle2 className="mt-0.5 size-4 text-success" aria-hidden="true" />
              <span className="flex-1 text-success">Payment received. Thank you. Your receipt is below.</span>
            </>
          ) : confirming ? (
            <>
              <Loader2 className="mt-0.5 size-4 animate-spin" aria-hidden="true" />
              <span className="flex-1">Confirming your payment with the provider…</span>
            </>
          ) : (
            <>
              <Info className="mt-0.5 size-4" aria-hidden="true" />
              <span className="flex-1">
                Your payment is still being confirmed. It will appear here shortly, and you&apos;ll get a notification.
              </span>
            </>
          )}
          {!confirming && (
            <button onClick={dismissBanner} className="text-xs underline">
              Dismiss
            </button>
          )}
        </div>
      )}
      {checkoutState === "cancelled" && (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-md bg-surface-muted px-3 py-3 text-sm text-muted">
          <Info className="mt-0.5 size-4" aria-hidden="true" />
          <span className="flex-1">Payment cancelled. You haven&apos;t been charged.</span>
          <button onClick={dismissBanner} className="text-xs underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
            <StatusBadge status={inv.status} />
          </CardHeader>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-left text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">Description</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">Qty</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">Price</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.items.map((item) => (
                    <tr key={item.id} className="border-t border-border">
                      <td className="px-4 py-2">{item.description}</td>
                      <td className="px-4 py-2 text-right">{item.quantity}</td>
                      <td className="px-4 py-2 text-right">{formatMoney(item.unitPrice, inv.currency)}</td>
                      <td className="px-4 py-2 text-right">{formatMoney(item.lineTotal, inv.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardBody>
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">Total</dt>
                  <dd className="font-medium">{formatMoney(inv.total, inv.currency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Paid</dt>
                  <dd>{formatMoney(inv.amountPaid, inv.currency)}</dd>
                </div>
                <div className="flex justify-between border-t border-border pt-2 text-base">
                  <dt className="font-medium">Balance due</dt>
                  <dd className="font-semibold">{formatMoney(inv.balanceDue, inv.currency)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payments</CardTitle>
            </CardHeader>
            <CardBody>
              {inv.payments.length === 0 ? (
                <p className="text-sm text-muted">No payments yet.</p>
              ) : (
                <ul className="flex flex-col gap-3 text-sm">
                  {inv.payments.map((p) => (
                    <li key={p.id} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{formatMoney(p.amount, p.currency)}</span>
                        <StatusBadge status={p.status} kind="payment" />
                      </div>
                      <span className="text-muted">
                        {METHOD_LABEL[p.method] ?? p.method} · {formatDateTime(p.createdAt, timezone)}
                      </span>
                      {p.status === PaymentStatus.SUCCEEDED && (
                        <DownloadButton label="Receipt" fetchUrl={() => paymentReceipt(p.id)} className="self-start" />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
      <PayDialog invoice={inv} open={payOpen} onOpenChange={setPayOpen} />
    </>
  );
}

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<FullPageLoader />}>
      <InvoiceDetail id={id} />
    </Suspense>
  );
}
