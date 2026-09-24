import { randomBytes } from "node:crypto";
import { HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcrypt";
import { ApiErrorCode, UserRole, UserStatus } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { AppException } from "../common/errors/app-exception";
import { PaginatedResult } from "../common/pagination/paginated-result";
import type { PaginationQueryDto } from "../common/pagination/pagination-query.dto";
import { SAFE_USER_SELECT } from "../common/prisma/safe-user-select";
import { PasswordResetService } from "../auth/services/password-reset.service";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import type { RegisterPatientDto } from "./dto/register-patient.dto";

/** docs/07-RBAC-MATRIX.md §3.2. "Context only" visibility for LAB_TECHNICIAN/
 * PHARMACIST/ACCOUNTANT (scoped to a specific lab order/dispense/invoice
 * they're handling) is simplified here to plain own-hospital read access —
 * documented scope simplification, docs/phase-reviews/PHASE-4-REVIEW.md;
 * the true contextual restriction is naturally enforced once Phases 8-10
 * gate access through the specific lab order/prescription/invoice instead. */
const DIRECTORY_ROLES: UserRole[] = [
  UserRole.HOSPITAL_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.RECEPTIONIST,
  UserRole.LAB_TECHNICIAN,
  UserRole.PHARMACIST,
  UserRole.ACCOUNTANT,
];

/** "View patient directory (list/search)", docs/07-RBAC-MATRIX.md §3.2:
 * Lab Technician and Pharmacist have no directory access (⛔); they reach a
 * patient only through the order or prescription in front of them. Phase 4
 * allowed them the list as a stopgap until those flows existed; they do now,
 * and global search (Phase 13) follows the matrix, so the list does too
 * (docs/11-DECISIONS.md D-040). Single-profile reads keep DIRECTORY_ROLES. */
const DIRECTORY_LIST_ROLES: UserRole[] = [
  UserRole.HOSPITAL_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.RECEPTIONIST,
  UserRole.ACCOUNTANT,
];

@Injectable()
export class PatientsService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly config: ConfigService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  async register(dto: RegisterPatientDto, caller: AuthenticatedUser) {
    if (!caller.hospitalId) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "A Super Admin must operate within a specific hospital to register patients.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const hospitalId = caller.hospitalId;

    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (existing) {
        throw new AppException(
          ApiErrorCode.VALIDATION_ERROR,
          "An account with this email already exists.",
          HttpStatus.BAD_REQUEST,
        );
      }

      const address = dto.address ? await this.prisma.address.create({ data: dto.address }) : null;

      const cost = this.config.get<number>("BCRYPT_COST_FACTOR", 12);
      const unusablePasswordHash = await bcrypt.hash(randomBytes(32).toString("hex"), cost);

      const user = await this.prisma.user.create({
        data: {
          hospitalId,
          email: dto.email,
          phone: dto.phone,
          firstName: dto.firstName,
          lastName: dto.lastName,
          passwordHash: unusablePasswordHash,
          role: UserRole.PATIENT,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });

      const patientProfile = await this.prisma.patientProfile.create({
        data: {
          userId: user.id,
          hospitalId,
          dob: dto.dob ? new Date(dto.dob) : undefined,
          gender: dto.gender,
          bloodGroup: dto.bloodGroup,
          emergencyContactName: dto.emergencyContactName,
          emergencyContactPhone: dto.emergencyContactPhone,
          addressId: address?.id,
        },
        include: { user: { select: SAFE_USER_SELECT } },
      });

      await this.passwordResetService.requestReset(user.email);

      return patientProfile;
    });
  }

  async findAll(pagination: PaginationQueryDto, caller: AuthenticatedUser, search?: string) {
    if (!caller.hospitalId || !DIRECTORY_LIST_ROLES.includes(caller.role)) {
      return PaginatedResult.of([], 0, pagination.page, pagination.limit);
    }
    const hospitalId = caller.hospitalId;

    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      const where = {
        hospitalId,
        deletedAt: null,
        ...(search
          ? {
              user: {
                OR: [
                  { firstName: { contains: search, mode: "insensitive" as const } },
                  { lastName: { contains: search, mode: "insensitive" as const } },
                  { email: { contains: search, mode: "insensitive" as const } },
                ],
              },
            }
          : {}),
      };
      const [data, total] = await Promise.all([
        this.prisma.patientProfile.findMany({
          where,
          skip: pagination.skip,
          take: pagination.limit,
          orderBy: { createdAt: "desc" },
          include: { user: { select: SAFE_USER_SELECT } },
        }),
        this.prisma.patientProfile.count({ where }),
      ]);
      return PaginatedResult.of(data, total, pagination.page, pagination.limit);
    });
  }

  async findOne(id: string, caller: AuthenticatedUser) {
    if (caller.role === UserRole.PATIENT) {
      const own = await TenantContext.run(
        { hospitalId: caller.hospitalId, userId: caller.sub, bypassTenancy: false },
        () =>
          this.prisma.patientProfile.findUnique({
            where: { id },
            include: { user: { select: SAFE_USER_SELECT } },
          }),
      );
      if (!own || own.userId !== caller.sub) throw new NotFoundException("Patient not found.");
      return own;
    }

    if (!caller.hospitalId || !DIRECTORY_ROLES.includes(caller.role)) {
      throw new NotFoundException("Patient not found.");
    }

    const patient = await TenantContext.run(
      { hospitalId: caller.hospitalId, userId: caller.sub, bypassTenancy: false },
      () =>
        this.prisma.patientProfile.findUnique({
          where: { id },
          include: { user: { select: SAFE_USER_SELECT } },
        }),
    );
    if (!patient) throw new NotFoundException("Patient not found.");
    return patient;
  }
}
