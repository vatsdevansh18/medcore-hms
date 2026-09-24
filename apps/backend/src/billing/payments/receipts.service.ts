import { HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ApiErrorCode, PaymentStatus, UserRole } from "@medcore/types";
import { PRISMA_CLIENT } from "../../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../../prisma/prisma-client.factory";
import { TenantContext } from "../../common/tenancy/tenant-context";
import { AppException } from "../../common/errors/app-exception";
import { S3Service } from "../../common/storage/s3.service";
import { PdfRendererService } from "../../common/pdf/pdf-renderer.service";
import type { AuthenticatedUser } from "../../auth/interfaces/authenticated-user.interface";
import { formatHospitalTime } from "../../notifications/notification-format";
import { renderReceiptHtml } from "./receipt-pdf-template";

/** Who may download a receipt: the paying patient, and the staff who can
 * view the invoice (docs/07-RBAC-MATRIX.md §3.8 "View invoice"). */
export const RECEIPT_ROLES: UserRole[] = [
  UserRole.PATIENT,
  UserRole.RECEPTIONIST,
  UserRole.ACCOUNTANT,
  UserRole.HOSPITAL_ADMIN,
];

/**
 * Payment receipt PDFs (brief §7.7, deferred from Phase 10 by D-030). A
 * receipt is rendered the first time it's requested and cached in S3; its
 * storage key is kept on `Payment.receiptUrl` and never returned. Only a
 * SUCCEEDED payment has a receipt. Rendering on demand, rather than in a job
 * at settlement time, means there's no lost-job case where a paid invoice
 * never gets a receipt (docs/11-DECISIONS.md D-036).
 */
@Injectable()
export class ReceiptsService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly s3: S3Service,
    private readonly pdf: PdfRendererService,
  ) {}

  async getReceiptUrl(paymentId: string, caller: AuthenticatedUser): Promise<{ downloadUrl: string }> {
    if (!RECEIPT_ROLES.includes(caller.role) || !caller.hospitalId) {
      throw new NotFoundException("Payment not found.");
    }
    const hospitalId = caller.hospitalId;
    const scope = { hospitalId, userId: caller.sub, bypassTenancy: false };

    const payment = await TenantContext.run(scope, () =>
      this.prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
          invoice: {
            include: {
              items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
              patient: { select: { userId: true, user: { select: { firstName: true, lastName: true } } } },
            },
          },
        },
      }),
    );
    if (!payment) throw new NotFoundException("Payment not found.");
    // A patient only ever reaches their own payments; another patient's is
    // indistinguishable from a missing one.
    if (caller.role === UserRole.PATIENT && payment.invoice.patient.userId !== caller.sub) {
      throw new NotFoundException("Payment not found.");
    }
    if (payment.status !== PaymentStatus.SUCCEEDED) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "A receipt is only available once the payment has succeeded.",
        HttpStatus.CONFLICT,
      );
    }

    let key = payment.receiptUrl;
    if (!key) {
      const hospital = await TenantContext.run(scope, () =>
        this.prisma.hospital.findUniqueOrThrow({
          where: { id: hospitalId },
          select: { name: true, contactEmail: true, timezone: true },
        }),
      );
      const patientUser = payment.invoice.patient.user;
      const html = renderReceiptHtml({
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
        hospitalName: hospital.name,
        hospitalContactEmail: hospital.contactEmail,
        patientName: patientUser ? `${patientUser.firstName} ${patientUser.lastName}` : "Patient",
        method: payment.method,
        amount: payment.amount.toFixed(2),
        currency: payment.currency,
        paidAt: formatHospitalTime(payment.createdAt, hospital.timezone),
        invoiceTotal: payment.invoice.total.toFixed(2),
        lines: payment.invoice.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toFixed(2),
          lineTotal: item.lineTotal.toFixed(2),
        })),
      });
      const buffer = await this.pdf.render(html);
      // Deterministic key: two concurrent first requests write the same object.
      key = this.s3.buildKey(hospitalId, `receipts/${payment.id}`, `receipt-${payment.id}.pdf`);
      await this.s3.putObject(key, buffer, "application/pdf");
      await TenantContext.run(scope, () =>
        this.prisma.payment.updateMany({ where: { id: payment.id, receiptUrl: null }, data: { receiptUrl: key } }),
      );
    }
    return { downloadUrl: await this.s3.getDownloadUrl(key) };
  }
}
