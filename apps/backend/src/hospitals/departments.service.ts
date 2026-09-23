import { HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ApiErrorCode, UserRole } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { AppException } from "../common/errors/app-exception";
import { PaginatedResult } from "../common/pagination/paginated-result";
import type { PaginationQueryDto } from "../common/pagination/pagination-query.dto";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import type { CreateDepartmentDto } from "./dto/create-department.dto";
import type { UpdateDepartmentDto } from "./dto/update-department.dto";

/** FR-HOSP-002. `Department` IS tenant-scoped (Layer 1 auto-injects hospitalId
 * from TenantContext), but every query here still passes hospitalId
 * explicitly — required for a SUPER_ADMIN's @BypassTenantScope() calls,
 * where Layer 1 injection is skipped, and defense-in-depth for everyone else. */
@Injectable()
export class DepartmentsService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  private assertHospitalScope(caller: AuthenticatedUser, hospitalId: string): void {
    if (caller.role === UserRole.SUPER_ADMIN) return;
    if (caller.hospitalId !== hospitalId) {
      throw new NotFoundException("Hospital not found.");
    }
  }

  async create(hospitalId: string, dto: CreateDepartmentDto, caller: AuthenticatedUser) {
    this.assertHospitalScope(caller, hospitalId);
    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      const existing = await this.prisma.department.findUnique({
        where: { hospitalId_name: { hospitalId, name: dto.name } },
      });
      if (existing) {
        throw new AppException(
          ApiErrorCode.VALIDATION_ERROR,
          "A department with this name already exists at this hospital.",
          HttpStatus.BAD_REQUEST,
        );
      }
      return this.prisma.department.create({ data: { hospitalId, ...dto } });
    });
  }

  async findAll(hospitalId: string, pagination: PaginationQueryDto, caller: AuthenticatedUser) {
    this.assertHospitalScope(caller, hospitalId);
    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      const [data, total] = await Promise.all([
        this.prisma.department.findMany({
          where: { hospitalId },
          skip: pagination.skip,
          take: pagination.limit,
          orderBy: { name: "asc" },
        }),
        this.prisma.department.count({ where: { hospitalId } }),
      ]);
      return PaginatedResult.of(data, total, pagination.page, pagination.limit);
    });
  }

  async update(
    hospitalId: string,
    departmentId: string,
    dto: UpdateDepartmentDto,
    caller: AuthenticatedUser,
  ) {
    this.assertHospitalScope(caller, hospitalId);
    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      const department = await this.prisma.department.findUnique({ where: { id: departmentId } });
      if (!department || department.hospitalId !== hospitalId) {
        throw new NotFoundException("Department not found.");
      }
      return this.prisma.department.update({ where: { id: departmentId }, data: dto });
    });
  }

  async remove(hospitalId: string, departmentId: string, caller: AuthenticatedUser) {
    this.assertHospitalScope(caller, hospitalId);
    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      const department = await this.prisma.department.findUnique({ where: { id: departmentId } });
      if (!department || department.hospitalId !== hospitalId) {
        throw new NotFoundException("Department not found.");
      }

      const [doctorCount, roomCount, staffCount] = await Promise.all([
        this.prisma.doctorProfile.count({ where: { departmentId } }),
        this.prisma.room.count({ where: { departmentId } }),
        this.prisma.staffProfile.count({ where: { departmentId } }),
      ]);
      if (doctorCount + roomCount + staffCount > 0) {
        throw new AppException(
          ApiErrorCode.VALIDATION_ERROR,
          "Cannot delete a department that still has doctors, staff, or rooms assigned to it.",
          HttpStatus.BAD_REQUEST,
        );
      }

      await this.prisma.department.delete({ where: { id: departmentId } });
    });
  }
}
