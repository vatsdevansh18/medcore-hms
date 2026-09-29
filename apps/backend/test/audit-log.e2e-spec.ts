import { randomUUID } from "node:crypto";
import { HospitalStatus, UserRole, UserStatus } from "@medcore/types";
import { createPrismaClient, type ExtendedPrismaClient } from "../src/prisma/prisma-client.factory";
import { TenantContext } from "../src/common/tenancy/tenant-context";

/**
 * Proves the audit-log extension (docs/03-ARCHITECTURE.md §4,
 * docs/09-SECURITY.md SEC-AUDIT-001) actually writes AuditLog rows with the
 * right actor/hospital scoping and before/after data for create/update/
 * delete on an audited model, and that it never audits itself (no infinite
 * recursion writing AuditLog rows about AuditLog writes).
 */
describe("Audit log extension (e2e)", () => {
  let prisma: ExtendedPrismaClient;
  let hospitalId: string;
  let actingUserId: string;

  beforeAll(async () => {
    prisma = createPrismaClient(process.env.DATABASE_URL!);
    await prisma.$connect();

    const suffix = randomUUID().slice(0, 8);
    const hospital = await TenantContext.bypass(() =>
      prisma.hospital.create({
        data: {
          name: `Audit Test Hospital ${suffix}`,
          slug: `audit-test-${suffix}`,
          status: HospitalStatus.ACTIVE,
          contactEmail: `audit-${suffix}@test.medcore.test`,
        },
      }),
    );
    hospitalId = hospital.id;

    // AuditLog.actorUserId has a real FK to User — the acting user must be a
    // genuine row, not a synthetic id, or the audit write itself fails.
    const actingUser = await TenantContext.run(
      { hospitalId, userId: null, bypassTenancy: false },
      () =>
        prisma.user.create({
          data: {
            hospitalId,
            email: `actor-${suffix}@test.medcore.test`,
            passwordHash: "x",
            firstName: "Test",
            lastName: "User",
            role: UserRole.HOSPITAL_ADMIN,
            status: UserStatus.ACTIVE,
          },
        }),
    );
    actingUserId = actingUser.id;
  });

  afterAll(async () => {
    await TenantContext.bypass(async () => {
      await prisma.department.deleteMany({ where: { hospitalId } });
      await prisma.user.deleteMany({ where: { hospitalId } });
      // Deleted last: the deleteMany calls above are themselves audited
      // models, so they create fresh AuditLog rows referencing this
      // hospitalId that must be cleared before the hospital itself can go.
      await prisma.auditLog.deleteMany({ where: { hospitalId } });
      await prisma.hospital.delete({ where: { id: hospitalId } });
    });
    await prisma.$disconnect();
  });

  it("writes an AuditLog row with afterData on create, attributed to the acting user", async () => {
    const department = await TenantContext.run(
      { hospitalId, userId: actingUserId, bypassTenancy: false },
      () => prisma.department.create({ data: { hospitalId, name: "Cardiology Audit Test" } }),
    );

    const entries = await TenantContext.bypass(() =>
      prisma.auditLog.findMany({
        where: { entityType: "Department", entityId: department.id },
      }),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "CREATE",
      hospitalId,
      actorUserId: actingUserId,
    });
    expect((entries[0]!.afterData as { name?: string } | null)?.name).toBe("Cardiology Audit Test");
    expect(entries[0]!.beforeData).toBeNull();
  });

  it("writes beforeData and afterData on update", async () => {
    const department = await TenantContext.run(
      { hospitalId, userId: actingUserId, bypassTenancy: false },
      () => prisma.department.create({ data: { hospitalId, name: "Radiology Audit Test" } }),
    );

    await TenantContext.run({ hospitalId, userId: actingUserId, bypassTenancy: false }, () =>
      prisma.department.update({
        where: { id: department.id },
        data: { name: "Radiology (Renamed)" },
      }),
    );

    const updateEntry = await TenantContext.bypass(() =>
      prisma.auditLog.findFirst({
        where: { entityType: "Department", entityId: department.id, action: "UPDATE" },
      }),
    );

    expect(updateEntry).not.toBeNull();
    expect((updateEntry!.beforeData as { name?: string } | null)?.name).toBe(
      "Radiology Audit Test",
    );
    expect((updateEntry!.afterData as { name?: string } | null)?.name).toBe("Radiology (Renamed)");
  });

  // KNOWN LIMITATION (docs/phase-reviews/PHASE-9-REVIEW.md Technical Debt,
  // investigated but not fixed in Phase 15 — see docs/11-DECISIONS.md D-044):
  // the audit-log extension writes through the root Prisma client, not the
  // interactive-transaction client, so its AuditLog row survives a rollback
  // of the transaction that produced it. `test.failing` documents this as an
  // active tripwire — this test must start FAILING (proving the bug is
  // fixed) before anyone removes `.failing`; if it ever starts passing
  // un-flagged, the suite fails loudly rather than silently losing coverage.
  test.failing(
    "rolls back its AuditLog row with the transaction that wrote it",
    async () => {
      const deptName = "Rollback Audit Test";
      let createdId: string | undefined;

      await expect(
        prisma.$transaction((tx) =>
          TenantContext.run({ hospitalId, userId: actingUserId, bypassTenancy: false }, async () => {
            const department = await tx.department.create({ data: { hospitalId, name: deptName } });
            createdId = department.id;
            throw new Error("force rollback after the audited write");
          }),
        ),
      ).rejects.toThrow("force rollback");

      expect(createdId).toBeDefined();

      const department = await TenantContext.bypass(() =>
        prisma.department.findUnique({ where: { id: createdId! } }),
      );
      expect(department).toBeNull(); // sanity check: the transaction really rolled back

      const auditEntries = await TenantContext.bypass(() =>
        prisma.auditLog.findMany({ where: { entityType: "Department", entityId: createdId! } }),
      );
      expect(auditEntries).toHaveLength(0);
    },
  );

  it("does not recursively audit its own AuditLog writes", async () => {
    const before = await TenantContext.bypass(() =>
      prisma.auditLog.count({ where: { hospitalId } }),
    );

    await TenantContext.run({ hospitalId, userId: actingUserId, bypassTenancy: false }, () =>
      prisma.department.create({ data: { hospitalId, name: "Recursion Check Dept" } }),
    );

    const after = await TenantContext.bypass(() =>
      prisma.auditLog.count({ where: { hospitalId } }),
    );

    // Exactly one new AuditLog row for the Department create — not two
    // (which would indicate the audit write about the audit write was
    // itself audited).
    expect(after - before).toBe(1);
  });

  it("never audits reads (findMany does not create AuditLog rows)", async () => {
    const before = await TenantContext.bypass(() =>
      prisma.auditLog.count({ where: { hospitalId } }),
    );

    await TenantContext.run({ hospitalId, userId: actingUserId, bypassTenancy: false }, () =>
      prisma.department.findMany({ where: { hospitalId } }),
    );

    const after = await TenantContext.bypass(() =>
      prisma.auditLog.count({ where: { hospitalId } }),
    );
    expect(after).toBe(before);
  });
});
