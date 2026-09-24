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
import { PaginatedResult } from "../common/pagination/paginated-result";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import type { CreateStaffDto } from "./dto/create-staff.dto";
import type { CreateHospitalAdminDto } from "./dto/create-hospital-admin.dto";
import { STAFF_DIRECTORY_ROLES, type FindStaffQueryDto } from "./dto/find-staff-query.dto";

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
    return this.provision(caller.hospitalId, dto, caller.sub);
  }

  /** FR-HOSP-001/002: a Super Admin gives a new hospital its first Hospital
   * Admin (RBAC §3.1 "Create/manage staff accounts": SA any). `POST /users`
   * can't do it, because it provisions into the caller's own hospital and a
   * Super Admin has none. Added in the Phase 13B follow-up (D-042). */
  async createHospitalAdmin(hospitalId: string, dto: CreateHospitalAdminDto, caller: AuthenticatedUser) {
    const hospital = await TenantContext.bypass(() =>
      this.prisma.hospital.findUnique({ where: { id: hospitalId }, select: { id: true } }),
    );
    if (!hospital) throw new NotFoundException("Hospital not found.");
    return this.provision(hospitalId, { ...dto, role: UserRole.HOSPITAL_ADMIN }, caller.sub);
  }

  private async provision(hospitalId: string, dto: CreateStaffDto, actorId: string) {
    return TenantContext.run({ hospitalId, userId: actorId, bypassTenancy: false }, async () => {
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

  /** The caller's own hospital staff directory (Hospital Admin, RBAC §3.2
   * "View any staff profile"). Every term of `search` must match a name or
   * the email. Rows are `SAFE_USER_SELECT` plus the employee code and
   * department; doctors carry their profile id and specialization. */
  async findStaff(query: FindStaffQueryDto, caller: AuthenticatedUser) {
    if (!caller.hospitalId) return PaginatedResult.of([], 0, query.page, query.limit);
    const hospitalId = caller.hospitalId;
    const terms = (query.search ?? "").trim().split(/\s+/).filter(Boolean);
    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      const where = {
        hospitalId,
        deletedAt: null,
        role: query.role ? query.role : { in: [...STAFF_DIRECTORY_ROLES] },
        AND: terms.map((term) => ({
          OR: [
            { firstName: { contains: term, mode: "insensitive" as const } },
            { lastName: { contains: term, mode: "insensitive" as const } },
            { email: { contains: term, mode: "insensitive" as const } },
          ],
        })),
      };
      const [data, total] = await Promise.all([
        this.prisma.user.findMany({
          where,
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
          skip: query.skip,
          take: query.limit,
          select: {
            ...SAFE_USER_SELECT,
            staffProfile: {
              select: { employeeCode: true, department: { select: { id: true, name: true } } },
            },
            doctorProfile: {
              select: { id: true, specialization: true, department: { select: { id: true, name: true } } },
            },
          },
        }),
        this.prisma.user.count({ where }),
      ]);
      return PaginatedResult.of(data, total, query.page, query.limit);
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
