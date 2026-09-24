import { Inject, Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { SAFE_USER_SELECT } from "../common/prisma/safe-user-select";
import { S3Service } from "../common/storage/s3.service";
import { PdfRendererService } from "../common/pdf/pdf-renderer.service";
import { renderPrescriptionHtml } from "../prescriptions/prescription-pdf-template";
import { PRESCRIPTION_PDF_QUEUE, type PrescriptionPdfJobData } from "./queue.constants";

const PRESCRIPTION_INCLUDE = {
  doctor: { include: { user: { select: SAFE_USER_SELECT } } },
  patient: { include: { user: { select: SAFE_USER_SELECT } } },
  items: { include: { medicine: true } },
} as const;

/** FR-RX-003, docs/03-ARCHITECTURE.md §12 `pdf-generate` job. Runs in-process
 * (same pattern as `AppointmentReminderProcessor`) — no per-request caller,
 * so it reads across hospitals via `TenantContext.bypass()`. */
@Processor(PRESCRIPTION_PDF_QUEUE)
export class PrescriptionPdfProcessor extends WorkerHost {
  private readonly logger = new Logger(PrescriptionPdfProcessor.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly s3: S3Service,
    private readonly pdf: PdfRendererService,
  ) {
    super();
  }

  async process(job: Job<PrescriptionPdfJobData>): Promise<void> {
    const { prescriptionId } = job.data;

    const prescription = await TenantContext.bypass(() =>
      this.prisma.prescription.findUnique({
        where: { id: prescriptionId },
        include: PRESCRIPTION_INCLUDE,
      }),
    );
    if (!prescription) {
      this.logger.warn(`PDF job for prescription ${prescriptionId} — prescription no longer exists, skipping.`);
      return;
    }

    const hospital = await TenantContext.bypass(() =>
      this.prisma.hospital.findUnique({ where: { id: prescription.hospitalId } }),
    );

    const signatureUrl = prescription.signatureImageUrl
      ? await this.s3.getInternalDownloadUrl(prescription.signatureImageUrl)
      : null;

    const html = renderPrescriptionHtml({
      prescriptionId: prescription.id,
      hospitalName: hospital?.name ?? "MedCore HMS",
      doctorName: `${prescription.doctor.user?.firstName ?? ""} ${prescription.doctor.user?.lastName ?? ""}`.trim(),
      doctorSpecialization: prescription.doctor.specialization,
      doctorLicenseNumber: prescription.doctor.licenseNumber,
      patientName: `${prescription.patient.user?.firstName ?? ""} ${prescription.patient.user?.lastName ?? ""}`.trim() || "Patient",
      patientDob: prescription.patient.dob ? prescription.patient.dob.toISOString().slice(0, 10) : null,
      patientGender: prescription.patient.gender,
      createdAt: prescription.createdAt.toISOString().slice(0, 10),
      items: prescription.items.map((item) => ({
        medicineName: item.medicine.name,
        dosage: item.dosage,
        frequency: item.frequency,
        durationDays: item.durationDays,
        specialInstructions: item.specialInstructions,
        quantityPrescribed: item.quantityPrescribed,
      })),
      signatureUrl,
      supersedesId: prescription.supersedesId,
    });

    const pdfBuffer = await this.pdf.render(html);

    const storageKey = this.s3.buildKey(
      prescription.hospitalId,
      `prescriptions/${prescription.id}`,
      `prescription-${prescription.id}.pdf`,
    );
    await this.s3.putObject(storageKey, pdfBuffer, "application/pdf");

    await TenantContext.bypass(() =>
      this.prisma.prescription.update({ where: { id: prescription.id }, data: { pdfUrl: storageKey } }),
    );
  }
}
