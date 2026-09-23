import { randomUUID } from "node:crypto";
import { HospitalStatus, UserRole, UserStatus } from "@medcore/types";
import { createPrismaClient, type ExtendedPrismaClient } from "../src/prisma/prisma-client.factory";
import { TenantContext } from "../src/common/tenancy/tenant-context";

/**
 * Proves the PostgreSQL EXCLUDE constraints added in the init migration
 * (docs/03-ARCHITECTURE.md §8, docs/11-DECISIONS.md D-005) make
 * double-booking impossible at the database level — the mandatory
 * "booking two appointments in the same slot simultaneously — only one
 * succeeds" scenario (docs/10-TESTING-STRATEGY.md §3), exercised directly
 * against the schema since no AppointmentModule exists until Phase 5. Fires
 * genuinely concurrent inserts (Promise.allSettled, not sequential awaits)
 * to actually exercise the race rather than assume it away.
 */
describe("Appointment overlap exclusion constraints (e2e)", () => {
  let prisma: ExtendedPrismaClient;
  let hospitalId: string;
  let departmentId: string;
  let doctorId: string;
  let patientAId: string;
  let patientBId: string;

  beforeAll(async () => {
    prisma = createPrismaClient(process.env.DATABASE_URL!);
    await prisma.$connect();

    const suffix = randomUUID().slice(0, 8);
    const hospital = await TenantContext.bypass(() =>
      prisma.hospital.create({
        data: {
          name: `Concurrency Test Hospital ${suffix}`,
          slug: `concurrency-test-${suffix}`,
          status: HospitalStatus.ACTIVE,
          contactEmail: `concurrency-${suffix}@test.medcore.test`,
        },
      }),
    );
    hospitalId = hospital.id;

    await TenantContext.run({ hospitalId, userId: null, bypassTenancy: false }, async () => {
      const department = await prisma.department.create({
        data: { hospitalId, name: "Test Department" },
      });
      departmentId = department.id;

      const doctorUser = await prisma.user.create({
        data: {
          hospitalId,
          email: `doctor-${suffix}@test.medcore.test`,
          passwordHash: "x",
          firstName: "Test",
          lastName: "User",
          role: UserRole.DOCTOR,
          status: UserStatus.ACTIVE,
        },
      });
      const doctorProfile = await prisma.doctorProfile.create({
        data: {
          userId: doctorUser.id,
          hospitalId,
          departmentId,
          specialization: "General",
          licenseNumber: `LIC-${suffix}`,
          consultationFee: 500,
        },
      });
      doctorId = doctorProfile.id;

      const patientA = await prisma.patientProfile.create({ data: { hospitalId } });
      const patientB = await prisma.patientProfile.create({ data: { hospitalId } });
      patientAId = patientA.id;
      patientBId = patientB.id;
    });
  });

  afterAll(async () => {
    await TenantContext.bypass(async () => {
      await prisma.appointment.deleteMany({ where: { hospitalId } });
      await prisma.doctorProfile.deleteMany({ where: { hospitalId } });
      await prisma.patientProfile.deleteMany({ where: { hospitalId } });
      await prisma.user.deleteMany({ where: { hospitalId } });
      await prisma.department.deleteMany({ where: { hospitalId } });
      // Deleted last: the deletes above are audited models and create fresh
      // AuditLog rows referencing this hospitalId as they run.
      await prisma.auditLog.deleteMany({ where: { hospitalId } });
      await prisma.hospital.delete({ where: { id: hospitalId } });
    });
    await prisma.$disconnect();
  });

  function bookSlot(
    patientId: string,
    scheduledStart: Date,
    scheduledEnd: Date,
    createdBy: string,
  ) {
    return TenantContext.run({ hospitalId, userId: null, bypassTenancy: false }, () =>
      prisma.appointment.create({
        data: {
          hospitalId,
          patientId,
          doctorId,
          departmentId,
          scheduledStart,
          scheduledEnd,
          createdBy,
        },
      }),
    );
  }

  it("only one of two truly concurrent bookings for the same doctor+slot succeeds", async () => {
    const start = new Date("2027-01-04T09:00:00.000Z");
    const end = new Date("2027-01-04T09:30:00.000Z");

    const results = await Promise.allSettled([
      bookSlot(patientAId, start, end, "test-runner-A"),
      bookSlot(patientBId, start, end, "test-runner-B"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejection = rejected[0] as PromiseRejectedResult;
    expect(String(rejection.reason)).toMatch(/no_doctor_overlap|exclusion/i);

    const rowsForSlot = await TenantContext.bypass(() =>
      prisma.appointment.findMany({
        where: { hospitalId, doctorId, scheduledStart: start, scheduledEnd: end },
      }),
    );
    expect(rowsForSlot).toHaveLength(1);
  });

  it("overlapping (not identical) time ranges for the same doctor are also rejected", async () => {
    const start1 = new Date("2027-01-05T10:00:00.000Z");
    const end1 = new Date("2027-01-05T10:30:00.000Z");
    // Overlaps the first slot by 10 minutes.
    const start2 = new Date("2027-01-05T10:20:00.000Z");
    const end2 = new Date("2027-01-05T10:50:00.000Z");

    await bookSlot(patientAId, start1, end1, "test-runner");
    await expect(bookSlot(patientBId, start2, end2, "test-runner")).rejects.toThrow();
  });

  it("a CANCELLED appointment does not block a new booking for the same slot", async () => {
    const start = new Date("2027-01-06T11:00:00.000Z");
    const end = new Date("2027-01-06T11:30:00.000Z");

    const first = await bookSlot(patientAId, start, end, "test-runner");
    await TenantContext.run({ hospitalId, userId: null, bypassTenancy: false }, () =>
      prisma.appointment.update({ where: { id: first.id }, data: { status: "CANCELLED" } }),
    );

    // Should succeed now that the conflicting row is cancelled.
    await expect(bookSlot(patientBId, start, end, "test-runner")).resolves.toBeDefined();
  });

  it("the same patient cannot hold two overlapping appointments across different doctors", async () => {
    const suffix = randomUUID().slice(0, 8);
    const secondDoctorUser = await TenantContext.run(
      { hospitalId, userId: null, bypassTenancy: false },
      () =>
        prisma.user.create({
          data: {
            hospitalId,
            email: `doctor2-${suffix}@test.medcore.test`,
            passwordHash: "x",
            firstName: "Test",
            lastName: "User",
            role: UserRole.DOCTOR,
            status: UserStatus.ACTIVE,
          },
        }),
    );
    const secondDoctor = await TenantContext.run(
      { hospitalId, userId: null, bypassTenancy: false },
      () =>
        prisma.doctorProfile.create({
          data: {
            userId: secondDoctorUser.id,
            hospitalId,
            departmentId,
            specialization: "General",
            licenseNumber: `LIC2-${suffix}`,
            consultationFee: 500,
          },
        }),
    );

    const start = new Date("2027-01-07T12:00:00.000Z");
    const end = new Date("2027-01-07T12:30:00.000Z");

    await bookSlot(patientAId, start, end, "test-runner");

    await expect(
      TenantContext.run({ hospitalId, userId: null, bypassTenancy: false }, () =>
        prisma.appointment.create({
          data: {
            hospitalId,
            patientId: patientAId,
            doctorId: secondDoctor.id,
            departmentId,
            scheduledStart: start,
            scheduledEnd: end,
            createdBy: "test-runner",
          },
        }),
      ),
    ).rejects.toThrow(/no_patient_overlap|exclusion/i);
  });
});
