import { HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ApiErrorCode, UserRole } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { AppException } from "../common/errors/app-exception";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import type { CreateAllergyDto } from "./dto/create-allergy.dto";
import type { CreateVaccinationDto } from "./dto/create-vaccination.dto";
import type { CreateFamilyHistoryDto } from "./dto/create-family-history.dto";

/** FR-EMR-005 — allergies/vaccinations/family-history are patient-level,
 * not encounter-level, so every route here keys off `PatientProfile.id`
 * directly rather than a medical record. */
/** NFR-PERF-003: these patient-level lists return a plain array (the portal
 * and the encounter screen show them whole), so each is capped rather than
 * paginated. A real patient's allergies, vaccinations, or family history
 * stay far below this; the newest are kept if a record ever exceeds it
 * (Phase 14, docs/11-DECISIONS.md D-043). */
export const CLINICAL_LIST_CAP = 200;

@Injectable()
export class PatientClinicalService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

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

  /** DOCTOR/NURSE: patient must be in the caller's own hospital. PATIENT:
   * must be the caller's own profile. Both fail closed to 404. */
  private async authorizePatient(
    patientId: string,
    caller: AuthenticatedUser,
    { forWrite }: { forWrite: boolean },
  ): Promise<void> {
    if (caller.role === UserRole.PATIENT) {
      if (forWrite) throw new NotFoundException("Patient not found.");
      if (!caller.hospitalId) throw new NotFoundException("Patient not found.");
      const own = await TenantContext.run(
        { hospitalId: caller.hospitalId, userId: caller.sub, bypassTenancy: false },
        () => this.prisma.patientProfile.findUnique({ where: { userId: caller.sub } }),
      );
      if (!own || own.id !== patientId) throw new NotFoundException("Patient not found.");
      return;
    }

    const hospitalId = await this.requireHospitalId(caller);
    const patient = await TenantContext.run(
      { hospitalId, userId: caller.sub, bypassTenancy: false },
      () => this.prisma.patientProfile.findUnique({ where: { id: patientId } }),
    );
    if (!patient) throw new NotFoundException("Patient not found.");
  }

  async createAllergy(patientId: string, dto: CreateAllergyDto, caller: AuthenticatedUser) {
    await this.authorizePatient(patientId, caller, { forWrite: true });
    const hospitalId = await this.requireHospitalId(caller);
    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, () =>
      this.prisma.allergy.create({ data: { patientId, ...dto } }),
    );
  }

  async findAllergies(patientId: string, caller: AuthenticatedUser) {
    await this.authorizePatient(patientId, caller, { forWrite: false });
    return TenantContext.runForCaller(caller, () =>
      this.prisma.allergy.findMany({ where: { patientId }, orderBy: { recordedAt: "desc" }, take: CLINICAL_LIST_CAP }),
    );
  }

  async createVaccination(patientId: string, dto: CreateVaccinationDto, caller: AuthenticatedUser) {
    await this.authorizePatient(patientId, caller, { forWrite: true });
    const hospitalId = await this.requireHospitalId(caller);
    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, () =>
      this.prisma.vaccinationRecord.create({
        data: {
          patientId,
          vaccineName: dto.vaccineName,
          doseNumber: dto.doseNumber,
          dateAdministered: new Date(dto.dateAdministered),
          batchNumber: dto.batchNumber,
          nextDueDate: dto.nextDueDate ? new Date(dto.nextDueDate) : undefined,
        },
      }),
    );
  }

  async findVaccinations(patientId: string, caller: AuthenticatedUser) {
    await this.authorizePatient(patientId, caller, { forWrite: false });
    return TenantContext.runForCaller(caller, () =>
      this.prisma.vaccinationRecord.findMany({
        where: { patientId },
        orderBy: { dateAdministered: "desc" },
        take: CLINICAL_LIST_CAP,
      }),
    );
  }

  async createFamilyHistory(patientId: string, dto: CreateFamilyHistoryDto, caller: AuthenticatedUser) {
    await this.authorizePatient(patientId, caller, { forWrite: true });
    const hospitalId = await this.requireHospitalId(caller);
    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, () =>
      this.prisma.familyHistoryFlag.create({ data: { patientId, ...dto } }),
    );
  }

  async findFamilyHistory(patientId: string, caller: AuthenticatedUser) {
    await this.authorizePatient(patientId, caller, { forWrite: false });
    return TenantContext.runForCaller(caller, () =>
      this.prisma.familyHistoryFlag.findMany({ where: { patientId }, orderBy: { id: "asc" }, take: CLINICAL_LIST_CAP }),
    );
  }
}
