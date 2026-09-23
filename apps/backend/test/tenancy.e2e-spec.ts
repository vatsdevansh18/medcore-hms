import { randomUUID } from "node:crypto";
import { HospitalStatus, UserRole, UserStatus } from "@medcore/types";
import { createPrismaClient, type ExtendedPrismaClient } from "../src/prisma/prisma-client.factory";
import { TenantContext } from "../src/common/tenancy/tenant-context";

/**
 * Proves the tenant-scoping extension (docs/03-ARCHITECTURE.md §5 Layer 1)
 * actually isolates hospitals from each other, and fails closed when no
 * context is active — ahead of Phase 3 wiring TenantScopeGuard to real
 * requests. This is exactly the "cross-tenant access attempt fails"
 * mandatory scenario from docs/10-TESTING-STRATEGY.md §3, exercised at the
 * data-access layer Phase 2 owns; the API-level (404) version of the same
 * guarantee is added once real endpoints exist.
 */
describe("Tenant scoping (e2e)", () => {
  let prisma: ExtendedPrismaClient;
  let hospitalAId: string;
  let hospitalBId: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    prisma = createPrismaClient(process.env.DATABASE_URL!);
    await prisma.$connect();

    const suffix = randomUUID().slice(0, 8);
    const hospitalA = await TenantContext.bypass(() =>
      prisma.hospital.create({
        data: {
          name: `Tenancy Test Hospital A ${suffix}`,
          slug: `tenancy-test-a-${suffix}`,
          status: HospitalStatus.ACTIVE,
          contactEmail: `a-${suffix}@test.medcore.test`,
        },
      }),
    );
    const hospitalB = await TenantContext.bypass(() =>
      prisma.hospital.create({
        data: {
          name: `Tenancy Test Hospital B ${suffix}`,
          slug: `tenancy-test-b-${suffix}`,
          status: HospitalStatus.ACTIVE,
          contactEmail: `b-${suffix}@test.medcore.test`,
        },
      }),
    );
    hospitalAId = hospitalA.id;
    hospitalBId = hospitalB.id;

    await TenantContext.run(
      { hospitalId: hospitalAId, userId: null, bypassTenancy: false },
      async () => {
        const user = await prisma.user.create({
          data: {
            email: `patient-a-${suffix}@test.medcore.test`,
            passwordHash: "x",
            role: UserRole.PATIENT,
            status: UserStatus.ACTIVE,
          },
        });
        createdUserIds.push(user.id);
      },
    );
    await TenantContext.run(
      { hospitalId: hospitalBId, userId: null, bypassTenancy: false },
      async () => {
        const user = await prisma.user.create({
          data: {
            email: `patient-b-${suffix}@test.medcore.test`,
            passwordHash: "x",
            role: UserRole.PATIENT,
            status: UserStatus.ACTIVE,
          },
        });
        createdUserIds.push(user.id);
      },
    );
  });

  afterAll(async () => {
    await TenantContext.bypass(async () => {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      // Deleted last: the deleteMany above is an audited model and creates a
      // fresh AuditLog row referencing these hospitalIds as it runs.
      await prisma.auditLog.deleteMany({
        where: { hospitalId: { in: [hospitalAId, hospitalBId] } },
      });
      await prisma.hospital.deleteMany({ where: { id: { in: [hospitalAId, hospitalBId] } } });
    });
    await prisma.$disconnect();
  });

  it("scopes findMany to only the active TenantContext's hospital", async () => {
    const usersInA = await TenantContext.run(
      { hospitalId: hospitalAId, userId: null, bypassTenancy: false },
      () => prisma.user.findMany({ where: { id: { in: createdUserIds } } }),
    );
    expect(usersInA).toHaveLength(1);
    expect(usersInA[0]!.hospitalId).toBe(hospitalAId);
  });

  it("a hospital A context cannot read a hospital B user by id (cross-tenant read returns null)", async () => {
    const [, userBId] = createdUserIds;
    const result = await TenantContext.run(
      { hospitalId: hospitalAId, userId: null, bypassTenancy: false },
      () => prisma.user.findUnique({ where: { id: userBId! } }),
    );
    expect(result).toBeNull();
  });

  it("create always uses the context's hospitalId, ignoring any caller-supplied value", async () => {
    const created = await TenantContext.run(
      { hospitalId: hospitalAId, userId: null, bypassTenancy: false },
      () =>
        prisma.user.create({
          data: {
            // Deliberately wrong hospitalId — the extension must override it.
            hospitalId: hospitalBId,
            email: `spoof-attempt-${randomUUID()}@test.medcore.test`,
            passwordHash: "x",
            role: UserRole.PATIENT,
            status: UserStatus.ACTIVE,
          } as never,
        }),
    );
    createdUserIds.push(created.id);
    expect(created.hospitalId).toBe(hospitalAId);
  });

  it("fails closed: a tenant-scoped query with no active TenantContext throws rather than running unscoped", async () => {
    await expect(prisma.user.findMany({ where: { id: { in: createdUserIds } } })).rejects.toThrow(
      /No TenantContext is active/,
    );
  });

  it("fails closed: bypassTenancy=false with a null hospitalId throws rather than running unscoped", async () => {
    await expect(
      TenantContext.run({ hospitalId: null, userId: null, bypassTenancy: false }, () =>
        prisma.user.findMany({}),
      ),
    ).rejects.toThrow(/attempted with no hospitalId/);
  });

  it("TenantContext.bypass() can read across hospitals (Super Admin path)", async () => {
    const all = await TenantContext.bypass(() =>
      prisma.user.findMany({ where: { id: { in: createdUserIds } } }),
    );
    expect(all.length).toBeGreaterThanOrEqual(2);
    const hospitalIds = new Set(all.map((u) => u.hospitalId));
    expect(hospitalIds.has(hospitalAId)).toBe(true);
    expect(hospitalIds.has(hospitalBId)).toBe(true);
  });
});
