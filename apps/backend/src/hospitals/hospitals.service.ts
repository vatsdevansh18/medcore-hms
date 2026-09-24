import { HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ApiErrorCode, HospitalStatus, UserRole } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { AppException } from "../common/errors/app-exception";
import { PaginatedResult } from "../common/pagination/paginated-result";
import type { PaginationQueryDto } from "../common/pagination/pagination-query.dto";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import type { CreateHospitalDto } from "./dto/create-hospital.dto";
import type { UpdateHospitalDto } from "./dto/update-hospital.dto";

/**
 * `Hospital` is deliberately NOT in TENANT_SCOPED_MODELS (docs/03-ARCHITECTURE.md
 * §5 — it IS the tenant, not a tenant-owned record), so the automatic Layer 1
 * Prisma extension never scopes queries against it. Every method here does
 * the Layer 2 service-level re-verification explicitly: a non-SUPER_ADMIN
 * caller may only ever see/touch their own hospitalId, checked against the
 * JWT claim, never a client-supplied value (SEC-AUTHZ-003). A mismatch
 * returns 404, not 403, per SEC-TENANT-004.
 */
@Injectable()
export class HospitalsService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  private assertCanAccess(caller: AuthenticatedUser, hospitalId: string): void {
    if (caller.role === UserRole.SUPER_ADMIN) return;
    if (caller.hospitalId !== hospitalId) {
      throw new NotFoundException("Hospital not found.");
    }
  }

  async create(dto: CreateHospitalDto) {
    return TenantContext.bypass(async () => {
      const existingSlug = await this.prisma.hospital.findUnique({ where: { slug: dto.slug } });
      if (existingSlug) {
        throw new AppException(
          ApiErrorCode.VALIDATION_ERROR,
          "A hospital with this slug already exists.",
          HttpStatus.BAD_REQUEST,
        );
      }

      const address = dto.address ? await this.prisma.address.create({ data: dto.address }) : null;

      return this.prisma.hospital.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          status: HospitalStatus.PENDING_VERIFICATION,
          contactEmail: dto.contactEmail,
          contactPhone: dto.contactPhone,
          timezone: dto.timezone,
          addressId: address?.id,
        },
      });
    });
  }

  async verify(id: string) {
    return TenantContext.bypass(async () => {
      const hospital = await this.prisma.hospital.findUnique({ where: { id } });
      if (!hospital) throw new NotFoundException("Hospital not found.");
      return this.prisma.hospital.update({
        where: { id },
        data: { status: HospitalStatus.ACTIVE },
      });
    });
  }

  async findAll(pagination: PaginationQueryDto) {
    return TenantContext.bypass(async () => {
      const [data, total] = await Promise.all([
        this.prisma.hospital.findMany({
          skip: pagination.skip,
          take: pagination.limit,
          orderBy: { createdAt: "desc" },
        }),
        this.prisma.hospital.count(),
      ]);
      return PaginatedResult.of(data, total, pagination.page, pagination.limit);
    });
  }

  /** ACTIVE hospitals only (a pending or suspended one can't take
   * registrations), with no contact, status, or settings fields. */
  async directory() {
    const hospitals = await TenantContext.bypass(() =>
      this.prisma.hospital.findMany({
        where: { status: HospitalStatus.ACTIVE },
        orderBy: { name: "asc" },
        take: 200,
        select: { id: true, name: true, slug: true, address: { select: { city: true } } },
      }),
    );
    return hospitals.map((h) => ({ id: h.id, name: h.name, slug: h.slug, city: h.address?.city ?? null }));
  }

  async findOne(id: string, caller: AuthenticatedUser) {
    this.assertCanAccess(caller, id);
    const hospital = await TenantContext.bypass(() =>
      this.prisma.hospital.findUnique({ where: { id } }),
    );
    if (!hospital) throw new NotFoundException("Hospital not found.");
    return hospital;
  }

  async update(id: string, dto: UpdateHospitalDto, caller: AuthenticatedUser) {
    this.assertCanAccess(caller, id);
    return TenantContext.bypass(async () => {
      const hospital = await this.prisma.hospital.findUnique({ where: { id } });
      if (!hospital) throw new NotFoundException("Hospital not found.");
      return this.prisma.hospital.update({ where: { id }, data: dto });
    });
  }
}
