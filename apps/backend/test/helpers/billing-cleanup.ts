import type { ExtendedPrismaClient } from "../../src/prisma/prisma-client.factory";
import { TenantContext } from "../../src/common/tenancy/tenant-context";

/**
 * Removes every invoice (and its payments/items) for the given test
 * hospitals. Call it before deleting appointments in an e2e spec's teardown.
 * Since Phase 10, encounters, lab orders, and dispensing create invoices
 * automatically, and `Invoice.appointmentId` is a RESTRICT foreign key.
 *
 * Two database guards (migration `20260924120000_billing_integrity`) shape
 * this. Line items of a non-DRAFT invoice are immutable, so invoices are
 * reopened to DRAFT first. The deferred subtotal check runs at commit, so
 * items and their invoice are deleted in the same transaction (a committed
 * invoice whose items are gone would fail it).
 */
export async function purgeBilling(prisma: ExtendedPrismaClient, hospitalIds: string[]): Promise<void> {
  const where = { hospitalId: { in: hospitalIds } };
  await TenantContext.bypass(async () => {
    await prisma.payment.deleteMany({ where });
    await prisma.$transaction([
      prisma.invoice.updateMany({ where, data: { status: "DRAFT" } }),
      prisma.invoiceItem.deleteMany({ where: { invoice: where } }),
      prisma.invoice.deleteMany({ where }),
    ]);
  });
}
