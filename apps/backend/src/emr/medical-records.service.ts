import { HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ApiErrorCode, AppointmentStatus, AttachmentOwnerType, UserRole } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { AppException } from "../common/errors/app-exception";
import { PaginatedResult } from "../common/pagination/paginated-result";
import type { PaginationQueryDto } from "../common/pagination/pagination-query.dto";
import { EncryptionService } from "../common/crypto/encryption.service";
import { S3Service } from "../common/storage/s3.service";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { validateAttachment } from "./attachment-validation";
import type { CreateMedicalRecordDto } from "./dto/create-medical-record.dto";
import type { CreateAddendumDto } from "./dto/create-addendum.dto";
import type { RecordVitalsDto } from "./dto/record-vitals.dto";
import type { CreateAttachmentDto } from "./dto/create-attachment.dto";

const RECORD_INCLUDE = {
  vitals: { orderBy: { recordedAt: "desc" } },
  addenda: { orderBy: { createdAt: "desc" } },
  attachments: { orderBy: { createdAt: "desc" } },
} as const;

type MedicalRecordWithChildren = Prisma.MedicalRecordGetPayload<{ include: typeof RECORD_INCLUDE }>;

@Injectable()
export class MedicalRecordsService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly encryption: EncryptionService,
    private readonly s3: S3Service,
  ) {}

  /** `notesEncrypted`/`noteEncrypted` never leave this service as raw
   * ciphertext bytes — every response is decrypted (for an already
   * authorized caller) or omitted. */
  private toRecordResponse(record: MedicalRecordWithChildren) {
    const { notesEncrypted, addenda, ...rest } = record;
    return {
      ...rest,
      notes: notesEncrypted ? this.encryption.decrypt(notesEncrypted) : null,
      addenda: addenda.map((a) => {
        const { noteEncrypted, ...addendumRest } = a;
        return { ...addendumRest, note: this.encryption.decrypt(noteEncrypted) };
      }),
    };
  }

  private async requireHospitalId(caller: AuthenticatedUser): Promise<string> {
    if (!caller.hospitalId) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "A hospital-scoped account is required for clinical record access.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return caller.hospitalId;
  }

  /** Fetch a record for a DOCTOR/NURSE write action — hospital-scoped only
   * (docs/07-RBAC-MATRIX.md §3.4 gives both "own hospital", not "own
   * encounter", for every action except record *creation*). */
  private async getForClinicalWrite(
    id: string,
    caller: AuthenticatedUser,
  ): Promise<MedicalRecordWithChildren> {
    const hospitalId = await this.requireHospitalId(caller);
    const record = await TenantContext.run(
      { hospitalId, userId: caller.sub, bypassTenancy: false },
      () => this.prisma.medicalRecord.findUnique({ where: { id }, include: RECORD_INCLUDE }),
    );
    if (!record) throw new NotFoundException("Medical record not found.");
    return record;
  }

  /** Fetch a record for a read action — DOCTOR/NURSE (own hospital) or
   * PATIENT (self only). */
  private async getForRead(id: string, caller: AuthenticatedUser): Promise<MedicalRecordWithChildren> {
    if (caller.role === UserRole.PATIENT) {
      if (!caller.hospitalId) throw new NotFoundException("Medical record not found.");
      const record = await TenantContext.run(
        { hospitalId: caller.hospitalId, userId: caller.sub, bypassTenancy: false },
        () => this.prisma.medicalRecord.findUnique({ where: { id }, include: RECORD_INCLUDE }),
      );
      if (!record) throw new NotFoundException("Medical record not found.");
      const patient = await TenantContext.run(
        { hospitalId: caller.hospitalId, userId: caller.sub, bypassTenancy: false },
        () => this.prisma.patientProfile.findUnique({ where: { userId: caller.sub } }),
      );
      if (!patient || record.patientId !== patient.id) {
        throw new NotFoundException("Medical record not found.");
      }
      return record;
    }
    return this.getForClinicalWrite(id, caller);
  }

  async create(dto: CreateMedicalRecordDto, caller: AuthenticatedUser) {
    const hospitalId = await this.requireHospitalId(caller);

    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: dto.appointmentId },
        include: { doctor: true },
      });
      if (!appointment) throw new NotFoundException("Appointment not found.");

      if (appointment.doctor.userId !== caller.sub) {
        // FR-EMR-001 "own encounter" — a different doctor in the same
        // hospital cannot start someone else's encounter. Mirrors the
        // appointments module's not-found-not-forbidden pattern for an
        // adjacent-role/adjacent-owner access attempt.
        throw new NotFoundException("Appointment not found.");
      }
      if (appointment.status !== AppointmentStatus.IN_PROGRESS) {
        throw new AppException(
          ApiErrorCode.VALIDATION_ERROR,
          "A medical record can only be created once the appointment is IN_PROGRESS (encounter start).",
          HttpStatus.BAD_REQUEST,
        );
      }

      const existing = await this.prisma.medicalRecord.findUnique({
        where: { appointmentId: dto.appointmentId },
      });
      if (existing) {
        throw new AppException(
          ApiErrorCode.VALIDATION_ERROR,
          "A medical record already exists for this appointment.",
          HttpStatus.CONFLICT,
        );
      }

      try {
        const created = await this.prisma.medicalRecord.create({
          data: {
            hospitalId,
            appointmentId: appointment.id,
            patientId: appointment.patientId,
            doctorId: appointment.doctorId,
            chiefComplaint: dto.chiefComplaint,
            presentingSymptoms: dto.presentingSymptoms,
            diagnosisNotes: dto.diagnosisNotes,
            confirmedDiagnosisIcd10: dto.confirmedDiagnosisIcd10 ?? [],
            treatmentPlan: dto.treatmentPlan,
            notesEncrypted: dto.notes ? this.encryption.encrypt(dto.notes) : undefined,
          },
          include: RECORD_INCLUDE,
        });
        return this.toRecordResponse(created);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new AppException(
            ApiErrorCode.VALIDATION_ERROR,
            "A medical record already exists for this appointment.",
            HttpStatus.CONFLICT,
          );
        }
        throw err;
      }
    });
  }

  async findByPatient(patientId: string, pagination: PaginationQueryDto, caller: AuthenticatedUser) {
    // docs/10-TESTING-STRATEGY.md §3 mandatory scenario #2 ("a patient
    // cannot view another patient's medical records") expects 403/404, not
    // a silently-empty list — unlike PatientsService.findAll's
    // whole-directory listing, this route is parameterized by a specific
    // patientId, so a mismatch is treated as a single-resource lookup.
    if (caller.role === UserRole.PATIENT) {
      if (!caller.hospitalId) throw new NotFoundException("Patient not found.");
      const own = await TenantContext.run(
        { hospitalId: caller.hospitalId, userId: caller.sub, bypassTenancy: false },
        () => this.prisma.patientProfile.findUnique({ where: { userId: caller.sub } }),
      );
      if (!own || own.id !== patientId) {
        throw new NotFoundException("Patient not found.");
      }
    }

    const hospitalId = await this.requireHospitalId(caller);
    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      const where = { patientId };
      const [data, total] = await Promise.all([
        this.prisma.medicalRecord.findMany({
          where,
          skip: pagination.skip,
          take: pagination.limit,
          orderBy: { createdAt: "desc" },
          include: RECORD_INCLUDE,
        }),
        this.prisma.medicalRecord.count({ where }),
      ]);
      return PaginatedResult.of(
        data.map((r) => this.toRecordResponse(r)),
        total,
        pagination.page,
        pagination.limit,
      );
    });
  }

  async findOne(id: string, caller: AuthenticatedUser) {
    const record = await this.getForRead(id, caller);
    return this.toRecordResponse(record);
  }

  async addAddendum(id: string, dto: CreateAddendumDto, caller: AuthenticatedUser) {
    const record = await this.getForClinicalWrite(id, caller);
    const hospitalId = await this.requireHospitalId(caller);
    const addendum = await TenantContext.run(
      { hospitalId, userId: caller.sub, bypassTenancy: false },
      () =>
        this.prisma.medicalRecordAddendum.create({
          data: {
            medicalRecordId: record.id,
            authorUserId: caller.sub,
            noteEncrypted: this.encryption.encrypt(dto.note),
          },
        }),
    );
    const { noteEncrypted, ...rest } = addendum;
    return { ...rest, note: this.encryption.decrypt(noteEncrypted) };
  }

  async recordVitals(id: string, dto: RecordVitalsDto, caller: AuthenticatedUser) {
    const record = await this.getForClinicalWrite(id, caller);
    const hospitalId = await this.requireHospitalId(caller);

    // FR-EMR-003 — BMI is always server-computed, never client-supplied.
    const bmi =
      dto.heightCm && dto.weightKg
        ? Number((dto.weightKg / (dto.heightCm / 100) ** 2).toFixed(1))
        : undefined;

    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, () =>
      this.prisma.vitals.create({
        data: {
          medicalRecordId: record.id,
          bpSystolic: dto.bpSystolic,
          bpDiastolic: dto.bpDiastolic,
          pulse: dto.pulse,
          temperatureC: dto.temperatureC,
          spo2: dto.spo2,
          heightCm: dto.heightCm,
          weightKg: dto.weightKg,
          bmi,
          recordedBy: caller.sub,
        },
      }),
    );
  }

  async createAttachment(id: string, dto: CreateAttachmentDto, caller: AuthenticatedUser) {
    const record = await this.getForClinicalWrite(id, caller);
    const hospitalId = await this.requireHospitalId(caller);
    validateAttachment(dto.fileName, dto.mimeType, dto.sizeBytes);

    const storageKey = this.s3.buildKey(hospitalId, `medical-records/${record.id}`, dto.fileName);

    const attachment = await TenantContext.run(
      { hospitalId, userId: caller.sub, bypassTenancy: false },
      () =>
        this.prisma.attachment.create({
          data: {
            hospitalId,
            ownerType: AttachmentOwnerType.MEDICAL_RECORD,
            medicalRecordId: record.id,
            fileName: dto.fileName,
            mimeType: dto.mimeType,
            sizeBytes: dto.sizeBytes,
            storageKey,
            uploadedBy: caller.sub,
          },
        }),
    );

    const uploadUrl = await this.s3.getUploadUrl(storageKey, dto.mimeType);
    return { attachment, uploadUrl };
  }

  async getAttachmentDownloadUrl(recordId: string, attachmentId: string, caller: AuthenticatedUser) {
    const record = await this.getForRead(recordId, caller);
    const attachment = record.attachments.find((a) => a.id === attachmentId);
    if (!attachment) throw new NotFoundException("Attachment not found.");
    const downloadUrl = await this.s3.getDownloadUrl(attachment.storageKey);
    return { downloadUrl };
  }
}
