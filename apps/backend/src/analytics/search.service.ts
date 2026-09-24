import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ApiErrorCode,
  SearchScope,
  UserRole,
  type GlobalSearchView,
  type SearchDoctorHit,
  type SearchMedicineHit,
  type SearchPatientHit,
} from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { AppException } from "../common/errors/app-exception";
import { PaginatedResult } from "../common/pagination/paginated-result";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import type { SearchQueryDto } from "./dto/search-query.dto";

/** Which scopes each role may search, from docs/07-RBAC-MATRIX.md: the
 * patient directory (§3.2), doctors (any hospital staff, §3.3 booking), and
 * medicine inventory (§3.7). Patients have no global search, and neither does
 * the Super Admin: there's no hospital to search in, and a platform-wide
 * search is out of scope (D-040), so they get 403, not an empty result. */
const SCOPES_BY_ROLE: Partial<Record<UserRole, SearchScope[]>> = {
  [UserRole.HOSPITAL_ADMIN]: [SearchScope.PATIENTS, SearchScope.DOCTORS, SearchScope.MEDICINES],
  [UserRole.DOCTOR]: [SearchScope.PATIENTS, SearchScope.DOCTORS, SearchScope.MEDICINES],
  [UserRole.NURSE]: [SearchScope.PATIENTS, SearchScope.DOCTORS],
  [UserRole.RECEPTIONIST]: [SearchScope.PATIENTS, SearchScope.DOCTORS],
  [UserRole.ACCOUNTANT]: [SearchScope.PATIENTS, SearchScope.DOCTORS],
  [UserRole.LAB_TECHNICIAN]: [SearchScope.DOCTORS],
  [UserRole.PHARMACIST]: [SearchScope.DOCTORS, SearchScope.MEDICINES],
};

export const SEARCH_ROLES = Object.keys(SCOPES_BY_ROLE) as UserRole[];

const GROUPED_LIMIT = 5;

/** Every whitespace-separated term must match at least one field. */
function allTerms<W>(query: string, fieldsFor: (term: string) => W[]): { AND: { OR: W[] }[] } {
  const terms = query.split(/\s+/).filter(Boolean).slice(0, 5);
  return { AND: terms.map((term) => ({ OR: fieldsFor(term) })) };
}

const contains = (term: string) => ({ contains: term, mode: "insensitive" as const });

/**
 * FR-SEARCH-001: one search box over patients, doctors, and medicines,
 * always within the caller's own hospital (from the JWT), paginated, with a
 * scope per what the caller's role may see (docs/11-DECISIONS.md D-040).
 */
@Injectable()
export class SearchService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  allowedScopes(caller: AuthenticatedUser): SearchScope[] {
    return caller.hospitalId ? (SCOPES_BY_ROLE[caller.role] ?? []) : [];
  }

  async search(query: SearchQueryDto, caller: AuthenticatedUser) {
    const allowed = this.allowedScopes(caller);
    const q = query.q.trim();
    if (q.length < 2) {
      throw new AppException(ApiErrorCode.VALIDATION_ERROR, "Search needs at least 2 characters.", HttpStatus.BAD_REQUEST);
    }
    if (query.scope && !allowed.includes(query.scope)) {
      throw new AppException(
        ApiErrorCode.FORBIDDEN_ROLE,
        `Your role can't search ${query.scope}.`,
        HttpStatus.FORBIDDEN,
      );
    }
    if (!caller.hospitalId) {
      return { query: q, scopes: [] } satisfies GlobalSearchView;
    }
    const hospitalId = caller.hospitalId;

    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      if (query.scope) {
        const { hits, total } = await this.runScope(query.scope, q, hospitalId, query.skip, query.limit);
        return PaginatedResult.of<SearchPatientHit | SearchDoctorHit | SearchMedicineHit>(hits, total, query.page, query.limit);
      }
      const view: GlobalSearchView = { query: q, scopes: allowed };
      await Promise.all(
        allowed.map(async (scope) => {
          const result = await this.runScope(scope, q, hospitalId, 0, GROUPED_LIMIT);
          if (scope === SearchScope.PATIENTS) view.patients = result as { hits: SearchPatientHit[]; total: number };
          if (scope === SearchScope.DOCTORS) view.doctors = result as { hits: SearchDoctorHit[]; total: number };
          if (scope === SearchScope.MEDICINES) view.medicines = result as { hits: SearchMedicineHit[]; total: number };
        }),
      );
      return view;
    });
  }

  private runScope(
    scope: SearchScope,
    q: string,
    hospitalId: string,
    skip: number,
    take: number,
  ): Promise<{ hits: (SearchPatientHit | SearchDoctorHit | SearchMedicineHit)[]; total: number }> {
    if (scope === SearchScope.PATIENTS) return this.patients(q, hospitalId, skip, take);
    if (scope === SearchScope.DOCTORS) return this.doctors(q, hospitalId, skip, take);
    return this.medicines(q, hospitalId, skip, take);
  }

  private async patients(q: string, hospitalId: string, skip: number, take: number) {
    const where: Prisma.PatientProfileWhereInput = {
      hospitalId,
      deletedAt: null,
      user: allTerms(q, (term) => [
        { firstName: contains(term) },
        { lastName: contains(term) },
        { email: contains(term) },
        { phone: contains(term) },
      ]),
    };
    const [rows, total] = await Promise.all([
      this.prisma.patientProfile.findMany({
        where,
        skip,
        take,
        orderBy: [{ user: { lastName: "asc" } }, { id: "asc" }],
        select: { id: true, dob: true, user: { select: { firstName: true, lastName: true, email: true, phone: true } } },
      }),
      this.prisma.patientProfile.count({ where }),
    ]);
    const hits: SearchPatientHit[] = rows.map((r) => ({
      id: r.id,
      name: r.user ? `${r.user.firstName} ${r.user.lastName}` : "Unnamed patient",
      email: r.user?.email ?? null,
      phone: r.user?.phone ?? null,
      dob: r.dob ? r.dob.toISOString().slice(0, 10) : null,
    }));
    return { hits, total };
  }

  private async doctors(q: string, hospitalId: string, skip: number, take: number) {
    const where: Prisma.DoctorProfileWhereInput = {
      hospitalId,
      deletedAt: null,
      ...allTerms(q, (term) => [
        { user: { firstName: contains(term) } },
        { user: { lastName: contains(term) } },
        { specialization: contains(term) },
        { department: { name: contains(term) } },
      ]),
    };
    const [rows, total] = await Promise.all([
      this.prisma.doctorProfile.findMany({
        where,
        skip,
        take,
        orderBy: [{ user: { lastName: "asc" } }, { id: "asc" }],
        select: {
          id: true,
          specialization: true,
          department: { select: { name: true } },
          user: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.doctorProfile.count({ where }),
    ]);
    const hits: SearchDoctorHit[] = rows.map((r) => ({
      id: r.id,
      name: `Dr. ${r.user.firstName} ${r.user.lastName}`,
      specialization: r.specialization,
      department: r.department.name,
    }));
    return { hits, total };
  }

  private async medicines(q: string, hospitalId: string, skip: number, take: number) {
    const where: Prisma.MedicineWhereInput = {
      hospitalId,
      deletedAt: null,
      ...allTerms(q, (term) => [{ name: contains(term) }, { genericName: contains(term) }]),
    };
    const [rows, total] = await Promise.all([
      this.prisma.medicine.findMany({
        where,
        skip,
        take,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, genericName: true, form: true, unit: true },
      }),
      this.prisma.medicine.count({ where }),
    ]);
    return { hits: rows as SearchMedicineHit[], total };
  }
}
