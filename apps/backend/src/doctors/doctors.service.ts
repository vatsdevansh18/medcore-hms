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
import { S3Service } from "../common/storage/s3.service";
import { PasswordResetService } from "../auth/services/password-reset.service";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import type { CreateDoctorDto } from "./dto/create-doctor.dto";
import type { UploadSignatureDto } from "./dto/upload-signature.dto";
import { validateSignatureUpload } from "./signature-validation";

/**
 * A doctor profile as returned to a client (docs/11-DECISIONS.md D-036).
 * `signatureImageUrl` is an S3 storage key, replaced by `hasSignature`. A
 * PATIENT reading the directory to book gets the doctor's name only, not
 * their email or phone: patients reach the hospital, not staff directly.
 */
function toDoctorView<T extends { signatureImageUrl: string | null; user: { email: string; phone: string | null } }>(
  row: T,
  callerRole: UserRole,
) {
  const { signatureImageUrl, user, ...rest } = row;
  const { email: _email, phone: _phone, ...publicUser } = user;
  return {
    ...rest,
    hasSignature: signatureImageUrl !== null,
    user: callerRole === UserRole.PATIENT ? publicUser : user,
  };
}

@Injectable()
export class DoctorsService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly config: ConfigService,
    private readonly passwordResetService: PasswordResetService,
    private readonly s3: S3Service,
  ) {}

  /** FR-HOSP-003 — creates the User (role=DOCTOR) and DoctorProfile atomically. */
  async create(dto: CreateDoctorDto, caller: AuthenticatedUser) {
    if (!caller.hospitalId) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "A Super Admin must operate within a specific hospital to provision doctors.",
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
          role: UserRole.DOCTOR,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });

      const doctorProfile = await this.prisma.doctorProfile.create({
        data: {
          userId: user.id,
          hospitalId,
          departmentId: dto.departmentId,
          specialization: dto.specialization,
          licenseNumber: dto.licenseNumber,
          qualification: dto.qualification,
          yearsOfExperience: dto.yearsOfExperience,
          consultationFee: dto.consultationFee,
        },
        include: { user: { select: SAFE_USER_SELECT }, department: true },
      });

      await this.passwordResetService.requestReset(user.email);

      return toDoctorView(doctorProfile, caller.role);
    });
  }

  async findAll(
    pagination: PaginationQueryDto,
    caller: AuthenticatedUser,
    specialization?: string,
  ) {
    if (!caller.hospitalId) {
      // Super Admin has no single hospital to scope a doctor directory to.
      return PaginatedResult.of([], 0, pagination.page, pagination.limit);
    }
    const hospitalId = caller.hospitalId;

    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      const where = {
        hospitalId,
        deletedAt: null,
        ...(specialization
          ? { specialization: { contains: specialization, mode: "insensitive" as const } }
          : {}),
      };
      const [data, total] = await Promise.all([
        this.prisma.doctorProfile.findMany({
          where,
          skip: pagination.skip,
          take: pagination.limit,
          orderBy: { createdAt: "desc" },
          include: { user: { select: SAFE_USER_SELECT }, department: true },
        }),
        this.prisma.doctorProfile.count({ where }),
      ]);
      return PaginatedResult.of(
        data.map((row) => toDoctorView(row, caller.role)),
        total,
        pagination.page,
        pagination.limit,
      );
    });
  }

  async findOne(id: string, caller: AuthenticatedUser) {
    if (!caller.hospitalId) throw new NotFoundException("Doctor not found.");
    const doctor = await TenantContext.run(
      { hospitalId: caller.hospitalId, userId: caller.sub, bypassTenancy: false },
      () =>
        this.prisma.doctorProfile.findUnique({
          where: { id },
          include: { user: { select: SAFE_USER_SELECT }, department: true },
        }),
    );
    if (!doctor) throw new NotFoundException("Doctor not found.");
    return toDoctorView(doctor, caller.role);
  }

  /** FR-RX-003 — lets a doctor upload the signature image later overlaid on
   * their prescription PDFs. Self only, mirroring `AvailabilityService`'s
   * "self" scoping (docs/07-RBAC-MATRIX.md §3.3 note, same principle
   * applies to a doctor's own profile assets). */
  async uploadSignature(id: string, dto: UploadSignatureDto, caller: AuthenticatedUser) {
    if (!caller.hospitalId) throw new NotFoundException("Doctor not found.");
    const hospitalId = caller.hospitalId;

    const doctor = await TenantContext.run(
      { hospitalId, userId: caller.sub, bypassTenancy: false },
      () => this.prisma.doctorProfile.findUnique({ where: { id } }),
    );
    if (!doctor) throw new NotFoundException("Doctor not found.");
    if (caller.role !== UserRole.DOCTOR || doctor.userId !== caller.sub) {
      throw new NotFoundException("Doctor not found.");
    }

    validateSignatureUpload(dto.fileName, dto.mimeType, dto.sizeBytes);
    const storageKey = this.s3.buildKey(hospitalId, `doctors/${doctor.id}/signature`, dto.fileName);

    await TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, () =>
      this.prisma.doctorProfile.update({
        where: { id: doctor.id },
        data: { signatureImageUrl: storageKey },
      }),
    );

    const uploadUrl = await this.s3.getUploadUrl(storageKey, dto.mimeType);
    return { uploadUrl };
  }
}
