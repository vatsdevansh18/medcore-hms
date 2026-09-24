import { HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ApiErrorCode, NotificationType, PrescriptionStatus, UserRole } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { AppException } from "../common/errors/app-exception";
import { S3Service } from "../common/storage/s3.service";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { PrescriptionPdfQueueService } from "../queue/prescription-pdf-queue.service";
import { NotificationsService } from "../notifications/notifications.service";
import type { CreatePrescriptionDto } from "./dto/create-prescription.dto";
import type { FindPrescriptionsQueryDto } from "./dto/find-prescriptions-query.dto";
import { PaginatedResult } from "../common/pagination/paginated-result";
import { DOCTOR_NAME_SELECT, toPrescriptionView } from "./prescription-view";

const PRESCRIPTION_INCLUDE = {
  items: { include: { medicine: true } },
  doctor: DOCTOR_NAME_SELECT,
} as const;

/** docs/07-RBAC-MATRIX.md §3.5 "View prescription" row's NUR annotation
 * ("for admin note") is simplified to full own-hospital read access, same
 * kind of documented simplification as Phase 4/6's other 🟡-scoped roles. */
const VIEW_ROLES: UserRole[] = [UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.PATIENT];

@Injectable()
export class PrescriptionsService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly s3: S3Service,
    private readonly pdfQueue: PrescriptionPdfQueueService,
    private readonly notifications: NotificationsService,
  ) {}

  private async requireHospitalId(caller: AuthenticatedUser): Promise<string> {
    if (!caller.hospitalId) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "A hospital-scoped account is required for prescription access.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return caller.hospitalId;
  }

  async create(dto: CreatePrescriptionDto, caller: AuthenticatedUser) {
    const hospitalId = await this.requireHospitalId(caller);

    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      const medicalRecord = await this.prisma.medicalRecord.findUnique({
        where: { id: dto.medicalRecordId },
        include: { doctor: true },
      });
      if (!medicalRecord) throw new NotFoundException("Medical record not found.");
      if (medicalRecord.doctor.userId !== caller.sub) {
        // FR-RX-001 "issued by the encounter's doctor" — mirrors Phase 6's
        // not-found-not-forbidden pattern for an adjacent doctor.
        throw new NotFoundException("Medical record not found.");
      }

      const medicineIds = [...new Set(dto.items.map((item) => item.medicineId))];
      const medicines = await this.prisma.medicine.findMany({ where: { id: { in: medicineIds } } });
      if (medicines.length !== medicineIds.length) {
        throw new AppException(
          ApiErrorCode.VALIDATION_ERROR,
          "One or more medicines were not found in your hospital's inventory.",
          HttpStatus.BAD_REQUEST,
        );
      }

      let supersededSignature: string | null = null;
      if (dto.supersedesId) {
        const superseded = await this.prisma.prescription.findUnique({
          where: { id: dto.supersedesId },
        });
        if (!superseded || superseded.patientId !== medicalRecord.patientId) {
          throw new AppException(
            ApiErrorCode.VALIDATION_ERROR,
            "supersedesId does not reference a prescription for this patient.",
            HttpStatus.BAD_REQUEST,
          );
        }
        if (superseded.status !== PrescriptionStatus.ISSUED) {
          throw new AppException(
            ApiErrorCode.VALIDATION_ERROR,
            `Cannot correct a prescription that is already ${superseded.status}.`,
            HttpStatus.CONFLICT,
          );
        }
        const alreadySuperseded = await this.prisma.prescription.findFirst({
          where: { supersedesId: superseded.id },
        });
        if (alreadySuperseded) {
          throw new AppException(
            ApiErrorCode.VALIDATION_ERROR,
            "This prescription has already been superseded by a correction.",
            HttpStatus.CONFLICT,
          );
        }
        supersededSignature = superseded.signatureImageUrl;
      }

      // A doctor's stored signature can change over time — snapshot it onto
      // the prescription at issue time so a historical PDF always reflects
      // the signature that was actually current when it was signed. A
      // correction keeps the superseded prescription's own snapshot rather
      // than re-reading the doctor's current one, for the same reason.
      const doctorProfile = await this.prisma.doctorProfile.findUnique({
        where: { id: medicalRecord.doctorId },
      });
      const signatureImageUrl = supersededSignature ?? doctorProfile?.signatureImageUrl ?? null;

      // Creating the correction and cancelling the prescription it
      // supersedes must commit together or not at all — a partial write
      // here would leave two simultaneously-ISSUED prescriptions for the
      // same correction, defeating FR-RX-003's immutability guarantee.
      const created = await this.prisma.$transaction(async (tx) => {
        const prescription = await tx.prescription.create({
          data: {
            hospitalId,
            medicalRecordId: medicalRecord.id,
            doctorId: medicalRecord.doctorId,
            patientId: medicalRecord.patientId,
            signatureImageUrl,
            supersedesId: dto.supersedesId,
            items: {
              create: dto.items.map((item) => ({
                medicineId: item.medicineId,
                dosage: item.dosage,
                frequency: item.frequency,
                durationDays: item.durationDays,
                specialInstructions: item.specialInstructions,
                quantityPrescribed: item.quantityPrescribed,
              })),
            },
          },
          include: PRESCRIPTION_INCLUDE,
        });

        if (dto.supersedesId) {
          await tx.prescription.update({
            where: { id: dto.supersedesId },
            data: { status: PrescriptionStatus.CANCELLED },
          });
        }

        // Brief §7.8 "Prescription ready at pharmacy" (SMS + In-app). An
        // issued prescription is immediately dispensable at this hospital's
        // pharmacy, so issue is the "ready" moment (docs/11-DECISIONS.md
        // D-032). No medicine names in the text (SEC-NOTIF-003).
        const patient = await tx.patientProfile.findUnique({
          where: { id: medicalRecord.patientId },
          select: { userId: true },
        });
        await this.notifications.record(tx, {
          type: NotificationType.PRESCRIPTION_READY,
          hospitalId,
          recipientUserIds: [patient?.userId],
          title: "Prescription ready at the pharmacy",
          body: "Your prescription has been sent to the hospital pharmacy and is ready to collect.",
          relatedEntityType: "Prescription",
          relatedEntityId: prescription.id,
          dedupeKey: `${NotificationType.PRESCRIPTION_READY}:${prescription.id}`,
        });

        return prescription;
      });

      this.notifications.publish();
      await this.pdfQueue.enqueue(created.id);
      return toPrescriptionView(created);
    });
  }

  private async getForView(id: string, caller: AuthenticatedUser) {
    if (caller.role === UserRole.PATIENT) {
      if (!caller.hospitalId) throw new NotFoundException("Prescription not found.");
      const prescription = await TenantContext.run(
        { hospitalId: caller.hospitalId, userId: caller.sub, bypassTenancy: false },
        () => this.prisma.prescription.findUnique({ where: { id }, include: PRESCRIPTION_INCLUDE }),
      );
      if (!prescription) throw new NotFoundException("Prescription not found.");
      const patient = await TenantContext.run(
        { hospitalId: caller.hospitalId, userId: caller.sub, bypassTenancy: false },
        () => this.prisma.patientProfile.findUnique({ where: { userId: caller.sub } }),
      );
      if (!patient || prescription.patientId !== patient.id) {
        throw new NotFoundException("Prescription not found.");
      }
      return prescription;
    }

    const hospitalId = await this.requireHospitalId(caller);
    const prescription = await TenantContext.run(
      { hospitalId, userId: caller.sub, bypassTenancy: false },
      () => this.prisma.prescription.findUnique({ where: { id }, include: PRESCRIPTION_INCLUDE }),
    );
    if (!prescription) throw new NotFoundException("Prescription not found.");
    return prescription;
  }

  async findOne(id: string, caller: AuthenticatedUser) {
    if (!VIEW_ROLES.includes(caller.role)) throw new NotFoundException("Prescription not found.");
    return toPrescriptionView(await this.getForView(id, caller));
  }

  /** FR-PORTAL-001: the calling patient's own prescriptions, newest first.
   * Patient-only for now; staff work queues are Phase 13 (D-035). */
  async findMine(query: FindPrescriptionsQueryDto, caller: AuthenticatedUser) {
    if (caller.role !== UserRole.PATIENT || !caller.hospitalId) {
      return PaginatedResult.of([], 0, query.page, query.limit);
    }
    return TenantContext.run({ hospitalId: caller.hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      const patient = await this.prisma.patientProfile.findUnique({ where: { userId: caller.sub } });
      if (!patient) return PaginatedResult.of([], 0, query.page, query.limit);
      const where = { patientId: patient.id, ...(query.status ? { status: query.status } : {}) };
      const [data, total] = await Promise.all([
        this.prisma.prescription.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: query.skip,
          take: query.limit,
          include: PRESCRIPTION_INCLUDE,
        }),
        this.prisma.prescription.count({ where }),
      ]);
      return PaginatedResult.of(data.map(toPrescriptionView), total, query.page, query.limit);
    });
  }

  async getPdfDownloadUrl(id: string, caller: AuthenticatedUser) {
    // docs/07-RBAC-MATRIX.md §3.5 "Download prescription PDF" — narrower
    // than "View prescription": Doctor and Patient only, no Nurse/Pharmacist.
    if (caller.role !== UserRole.DOCTOR && caller.role !== UserRole.PATIENT) {
      throw new NotFoundException("Prescription not found.");
    }
    const prescription = await this.getForView(id, caller);
    if (!prescription.pdfUrl) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "The prescription PDF is still being generated. Please try again shortly.",
        HttpStatus.CONFLICT,
      );
    }
    const downloadUrl = await this.s3.getDownloadUrl(prescription.pdfUrl);
    return { downloadUrl };
  }
}
