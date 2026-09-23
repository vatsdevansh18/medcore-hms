import { randomBytes } from "node:crypto";
import { HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcrypt";
import { ApiErrorCode, UserRole, UserStatus } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { AppException } from "../common/errors/app-exception";
import { PasswordResetService } from "../auth/services/password-reset.service";
import { SAFE_USER_SELECT } from "../common/prisma/safe-user-select";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import type { CreateStaffDto } from "./dto/create-staff.dto";

/**
 * FR-HOSP-002 — staff provisioning. Admin-created accounts are pre-verified
 * (the admin is a trusted actor vouching for a workplace email within their
 * own hospital — unlike public self-registration, OTP-based email
 * verification adds no real security value here) and given a random,
 * never-disclosed password. Immediately after creation we trigger the same
 * PasswordResetService flow Phase 3 already built for "forgot password," so
 * the new staff member sets their own real password via the emailed link —
 * reusing existing, tested infrastructure rather than inventing an "invite"
 * mechanism.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly config: ConfigService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  async createStaff(dto: CreateStaffDto, caller: AuthenticatedUser) {
    if (!caller.hospitalId) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "A Super Admin must operate within a specific hospital to provision staff.",
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

      if (dto.departmentId) {
        const department = await this.prisma.department.findUnique({
          where: { id: dto.departmentId },
        });
        if (!department || department.hospitalId !== hospitalId) {
          throw new AppException(
            ApiErrorCode.VALIDATION_ERROR,
            "departmentId does not belong to your hospital.",
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      const existingCode = await this.prisma.staffProfile.findUnique({
        where: { hospitalId_employeeCode: { hospitalId, employeeCode: dto.employeeCode } },
      });
      if (existingCode) {
        throw new AppException(
          ApiErrorCode.VALIDATION_ERROR,
          "This employee code is already in use at this hospital.",
          HttpStatus.BAD_REQUEST,
        );
      }

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
          role: dto.role,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
        select: SAFE_USER_SELECT,
      });
      await this.prisma.staffProfile.create({
        data: {
          userId: user.id,
          hospitalId,
          departmentId: dto.departmentId,
          employeeCode: dto.employeeCode,
        },
      });

      await this.passwordResetService.requestReset(user.email);

      return user;
    });
  }

  async findOne(id: string, caller: AuthenticatedUser) {
    if (caller.sub !== id) {
      // Viewing someone else's profile: docs/07-RBAC-MATRIX.md §3.2 grants
      // HOSPITAL_ADMIN full own-hospital visibility and DOCTOR "own hospital,
      // own dept" — simplified here to "own hospital" for every staff-facing
      // role (documented scope simplification, docs/phase-reviews/PHASE-4-REVIEW.md).
      const staffFacingRoles: UserRole[] = [
        UserRole.HOSPITAL_ADMIN,
        UserRole.DOCTOR,
        UserRole.NURSE,
        UserRole.RECEPTIONIST,
      ];
      if (!caller.hospitalId || !staffFacingRoles.includes(caller.role)) {
        throw new NotFoundException("User not found.");
      }
    }

    // findUnique (not findUniqueOrThrow): a cross-tenant id is auto-filtered
    // to null by the tenant-scoping extension, not a Prisma-level throw —
    // findUniqueOrThrow would surface that as an unhandled P2025 (a 500),
    // not the clean 404 a cross-tenant lookup should return (SEC-TENANT-004).
    const user = await TenantContext.runForCaller(
      { hospitalId: caller.hospitalId, sub: caller.sub },
      () => this.prisma.user.findUnique({ where: { id }, select: SAFE_USER_SELECT }),
    );
    if (!user) throw new NotFoundException("User not found.");
    return user;
  }
}
