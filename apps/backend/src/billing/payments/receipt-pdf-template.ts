import { escapeHtml } from "../../common/pdf/pdf-renderer.service";

export interface ReceiptLine {
  description: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface ReceiptPdfData {
  paymentId: string;
  invoiceId: string;
  hospitalName: string;
  hospitalContactEmail: string;
  patientName: string;
  method: string;
  amount: string;
  currency: string;
  paidAt: string;
  invoiceTotal: string;
  lines: ReceiptLine[];
}

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash at counter",
  STRIPE: "Card (Stripe)",
  RAZORPAY: "UPI / Netbanking (Razorpay)",
};

/** A payment receipt (brief §7.7 "Payment confirmation triggers a receipt").
 * Inline-styled, no external resources. The payment id is the receipt
 * number, matching the Phase 10 receipt reference (D-030). */
export function renderReceiptHtml(data: ReceiptPdfData): string {
  const e = escapeHtml;
  const rows = data.lines
    .map(
      (line) => `<tr>
        <td>${e(line.description)}</td>
        <td class="num">${line.quantity}</td>
        <td class="num">${e(line.unitPrice)}</td>
        <td class="num">${e(line.lineTotal)}</td>
      </tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Receipt ${e(data.paymentId)}</title>
<style>
  body { font-family: Helvetica, Arial, sans-serif; color: #1f2937; font-size: 12px; margin: 32px; }
  h1 { font-size: 20px; margin: 0; color: #0a2a5e; }
  .muted { color: #6b7280; }
  .head { display: flex; justify-content: space-between; border-bottom: 2px solid #0a2a5e; padding-bottom: 12px; }
  .paid { font-size: 14px; font-weight: 600; color: #1b7f4c; border: 1px solid #1b7f4c; padding: 4px 10px; border-radius: 4px; }
  dl { display: grid; grid-template-columns: 160px 1fr; gap: 6px 12px; margin: 20px 0; }
  dt { color: #6b7280; } dd { margin: 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid #e5e7eb; }
  th { color: #6b7280; font-weight: 500; }
  .num { text-align: right; }
  .total { font-size: 16px; font-weight: 600; margin-top: 16px; text-align: right; }
  footer { margin-top: 32px; font-size: 10px; }
</style></head>
<body>
  <div class="head">
    <div><h1>${e(data.hospitalName)}</h1><div class="muted">${e(data.hospitalContactEmail)}</div></div>
    <div><div class="paid">PAYMENT RECEIVED</div></div>
  </div>
  <dl>
    <dt>Receipt number</dt><dd>${e(data.paymentId)}</dd>
    <dt>Invoice</dt><dd>${e(data.invoiceId)}</dd>
    <dt>Received from</dt><dd>${e(data.patientName)}</dd>
    <dt>Date</dt><dd>${e(data.paidAt)}</dd>
    <dt>Payment method</dt><dd>${e(METHOD_LABELS[data.method] ?? data.method)}</dd>
  </dl>
  <table>
    <thead><tr><th>Invoice item</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="muted" style="text-align:right">Invoice total: ${e(data.currency)} ${e(data.invoiceTotal)}</p>
  <div class="total">Amount received: ${e(data.currency)} ${e(data.amount)}</div>
  <footer class="muted">This receipt was generated electronically by MedCore HMS and is valid without a signature.</footer>
</body></html>`;
}
