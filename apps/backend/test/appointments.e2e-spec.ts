import { randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import { HospitalStatus, UserRole, UserStatus } from "@medcore/types";
import { AppModule } from "../src/app.module";
import { PRISMA_CLIENT } from "../src/prisma/prisma.module";
import type { ExtendedPrismaClient } from "../src/prisma/prisma-client.factory";
import { TenantContext } from "../src/common/tenancy/tenant-context";
import { configureApp } from "../src/common/bootstrap/configure-app";
import { AppointmentReminderQueueService } from "../src/queue/appointment-reminder-queue.service";

/**
 * Phase 5 — appointments & scheduling. Covers the phase's own extra gate
 * criterion (concurrent double-booking, at the real HTTP layer this time —
 * the data-access-layer version already lives in
 * appointment-concurrency.e2e-spec.ts), the status state machine's RBAC
 * restrictions, cross-tenant isolation, emergency bypass, and the BullMQ
 * reminder job lifecycle.
 */
describe("Appointments (e2e)", () => {
  let app: INestApplication;
  let prisma: ExtendedPrismaClient;
  let reminderQueue: AppointmentReminderQueueService;
  const suffix = randomUUID().slice(0, 8);
  const PASSWORD = "Passw0rd!";

  let hospitalId: string;
  let deptId: string;
  let doctorProfileId: string;
  const createdUserIds: string[] = [];
  const createdHospitalIds: string[] = [];
  const createdAppointmentIds: string[] = [];

  let adminToken: string;
  let doctorToken: string;
  let receptionistToken: string;
  let nurseToken: string;
  let patientToken: string;
  let patientProfileId: string;

  // A day far enough in the future that "today" edge cases never interfere,
  // fixed so slot-alignment assertions are deterministic.
  const FUTURE_DATE = "2027-03-04"; // a Thursday
  const FUTURE_DAY_OF_WEEK = 4;

  async function createUser(role: UserRole, email: string) {
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    return TenantContext.run({ hospitalId, userId: null, bypassTenancy: false }, async () => {
      const user = await prisma.user.create({
        data: {
          hospitalId,
          email,
          passwordHash,
          firstName: "Test",
          lastName: "User",
          role,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
      createdUserIds.push(user.id);
      return user;
    });
  }

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PRISMA_CLIENT);
    reminderQueue = app.get(AppointmentReminderQueueService);

    const hospital = await TenantContext.bypass(() =>
      prisma.hospital.create({
        data: {
          name: `Appt Test Hospital ${suffix}`,
          slug: `appt-test-${suffix}`,
          status: HospitalStatus.ACTIVE,
          contactEmail: `appt-${suffix}@test.medcore.test`,
        },
      }),
    );
    hospitalId = hospital.id;
    createdHospitalIds.push(hospitalId);

    const dept = await TenantContext.run(
      { hospitalId, userId: null, bypassTenancy: false },
      () => prisma.department.create({ data: { hospitalId, name: "General" } }),
    );
    deptId = dept.id;

    const adminUser = await createUser(UserRole.HOSPITAL_ADMIN, `admin-${suffix}@test.medcore.test`);
    const doctorUser = await createUser(UserRole.DOCTOR, `doctor-${suffix}@test.medcore.test`);
    const receptionistUser = await createUser(
      UserRole.RECEPTIONIST,
      `receptionist-${suffix}@test.medcore.test`,
    );
    const nurseUser = await createUser(UserRole.NURSE, `nurse-${suffix}@test.medcore.test`);
    const patientUser = await createUser(UserRole.PATIENT, `patient-${suffix}@test.medcore.test`);

    const doctorProfile = await TenantContext.run(
      { hospitalId, userId: null, bypassTenancy: false },
      () =>
        prisma.doctorProfile.create({
          data: {
            userId: doctorUser.id,
            hospitalId,
            departmentId: deptId,
            specialization: "General",
            licenseNumber: `LIC-${suffix}`,
            consultationFee: 100,
          },
        }),
    );
    doctorProfileId = doctorProfile.id;

    const patientProfile = await TenantContext.run(
      { hospitalId, userId: null, bypassTenancy: false },
      () => prisma.patientProfile.create({ data: { userId: patientUser.id, hospitalId } }),
    );
    patientProfileId = patientProfile.id;

    await TenantContext.run({ hospitalId, userId: null, bypassTenancy: false }, () =>
      prisma.doctorAvailability.create({
        data: {
          doctorId: doctorProfileId,
          dayOfWeek: FUTURE_DAY_OF_WEEK,
          startTime: "09:00",
          endTime: "11:00",
          slotDurationMinutes: 30,
        },
      }),
    );

    adminToken = await login(adminUser.email);
    doctorToken = await login(doctorUser.email);
    receptionistToken = await login(receptionistUser.email);
    nurseToken = await login(nurseUser.email);
    patientToken = await login(patientUser.email);
  });

  afterAll(async () => {
    await TenantContext.bypass(async () => {
      await Promise.all(
        createdAppointmentIds.map((id) => reminderQueue.cancelReminders(id).catch(() => undefined)),
      );
      await prisma.notification.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.appointment.deleteMany({ where: { hospitalId } });
      await prisma.doctorAvailabilityException.deleteMany({ where: { doctorId: doctorProfileId } });
      await prisma.doctorAvailability.deleteMany({ where: { doctorId: doctorProfileId } });
      await prisma.doctorProfile.deleteMany({ where: { hospitalId } });
      await prisma.patientProfile.deleteMany({ where: { hospitalId } });
      await prisma.refreshTokenSession.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma.department.deleteMany({ where: { hospitalId } });
      await prisma.auditLog.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.hospital.deleteMany({ where: { id: { in: createdHospitalIds } } });
    });
    await app.close();
  });

  function slot(hour: string) {
    return {
      scheduledStart: `${FUTURE_DATE}T${hour}:00.000Z`,
      scheduledEnd: `${FUTURE_DATE}T${addHalfHour(hour)}:00.000Z`,
    };
  }
  function addHalfHour(hour: string): string {
    const [h, m] = hour.split(":").map(Number);
    const total = h! * 60 + m! + 30;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  describe("availability computation (FR-APPT-001/002)", () => {
    it("computes open slots from the recurring weekly schedule", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/doctors/${doctorProfileId}/availability`)
        .query({ dateFrom: FUTURE_DATE, dateTo: FUTURE_DATE })
        .set("Authorization", `Bearer ${receptionistToken}`)
        .expect(200);
      expect(res.body.data[0].slots).toHaveLength(4); // 09:00-11:00 / 30min
      expect(res.body.data[0].slots[0].start).toBe(`${FUTURE_DATE}T09:00:00.000Z`);
    });

    it("SUPER_ADMIN has no access to doctor availability", async () => {
      const superAdminEmail = `superadmin-appt-${suffix}@test.medcore.test`;
      await TenantContext.bypass(async () => {
        const passwordHash = await bcrypt.hash(PASSWORD, 4);
        const user = await prisma.user.create({
          data: {
            hospitalId: null,
            email: superAdminEmail,
            passwordHash,
            firstName: "Super",
            lastName: "Admin",
            role: UserRole.SUPER_ADMIN,
            status: UserStatus.ACTIVE,
            emailVerifiedAt: new Date(),
          },
        });
        createdUserIds.push(user.id);
      });
      const superAdminToken = await login(superAdminEmail);

      await request(app.getHttpServer())
        .get(`/api/doctors/${doctorProfileId}/availability`)
        .query({ dateFrom: FUTURE_DATE, dateTo: FUTURE_DATE })
        .set("Authorization", `Bearer ${superAdminToken}`)
        .expect(403)
        .expect((res) => expect(res.body.error.code).toBe("FORBIDDEN_ROLE"));
    });

    it("a DOCTOR cannot view a colleague's availability (self only, unlike HA/NUR/REC/PAT's own-hospital access)", async () => {
      const colleagueEmail = `colleague-doc-${suffix}@test.medcore.test`;
      const colleagueUser = await createUser(UserRole.DOCTOR, colleagueEmail);
      await TenantContext.run({ hospitalId, userId: null, bypassTenancy: false }, () =>
        prisma.doctorProfile.create({
          data: {
            userId: colleagueUser.id,
            hospitalId,
            departmentId: deptId,
            specialization: "General",
            licenseNumber: `LIC-COLLEAGUE-${suffix}`,
            consultationFee: 100,
          },
        }),
      );
      const colleagueToken = await login(colleagueEmail);

      await request(app.getHttpServer())
        .get(`/api/doctors/${doctorProfileId}/availability`)
        .query({ dateFrom: FUTURE_DATE, dateTo: FUTURE_DATE })
        .set("Authorization", `Bearer ${colleagueToken}`)
        .expect(404);

      // The doctor can still view their own.
      await request(app.getHttpServer())
        .get(`/api/doctors/${doctorProfileId}/availability`)
        .query({ dateFrom: FUTURE_DATE, dateTo: FUTURE_DATE })
        .set("Authorization", `Bearer ${doctorToken}`)
        .expect(200);
    });

    it("an availability exception blocks the whole date", async () => {
      const blockedDate = "2027-03-11"; // also a Thursday
      await request(app.getHttpServer())
        .post(`/api/doctors/${doctorProfileId}/availability-exceptions`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({ date: blockedDate, isUnavailable: true, reason: "Leave" })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/doctors/${doctorProfileId}/availability`)
        .query({ dateFrom: blockedDate, dateTo: blockedDate })
        .set("Authorization", `Bearer ${receptionistToken}`)
        .expect(200);
      expect(res.body.data[0].slots).toHaveLength(0);
    });
  });

  describe("booking (FR-APPT-002) — mandatory concurrency scenario", () => {
    it("only one of two truly concurrent bookings for the same slot succeeds", async () => {
      const otherPatientUser = await createUser(
        UserRole.PATIENT,
        `patient-b-${suffix}@test.medcore.test`,
      );
      const otherPatientProfile = await TenantContext.run(
        { hospitalId, userId: null, bypassTenancy: false },
        () =>
          prisma.patientProfile.create({
            data: { userId: otherPatientUser.id, hospitalId },
          }),
      );

      const { scheduledStart, scheduledEnd } = slot("09:00");
      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post("/api/appointments")
          .set("Authorization", `Bearer ${patientToken}`)
          .send({ doctorId: doctorProfileId, scheduledStart, scheduledEnd }),
        request(app.getHttpServer())
          .post("/api/appointments")
          .set("Authorization", `Bearer ${receptionistToken}`)
          .send({
            patientId: otherPatientProfile.id,
            doctorId: doctorProfileId,
            scheduledStart,
            scheduledEnd,
          }),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([201, 409]);
      const winner = resA.status === 201 ? resA : resB;
      createdAppointmentIds.push(winner.body.data.id);

      const rows = await TenantContext.bypass(() =>
        prisma.appointment.findMany({
          where: { hospitalId, doctorId: doctorProfileId, scheduledStart: new Date(scheduledStart) },
        }),
      );
      expect(rows).toHaveLength(1);
    });

    it("rejects a fabricated (non-schedule-aligned) time window", async () => {
      await request(app.getHttpServer())
        .post("/api/appointments")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          doctorId: doctorProfileId,
          scheduledStart: `${FUTURE_DATE}T09:07:00.000Z`,
          scheduledEnd: `${FUTURE_DATE}T09:37:00.000Z`,
        })
        .expect(409)
        .expect((res) => expect(res.body.error.code).toBe("SLOT_UNAVAILABLE"));
    });

    it("a NURSE cannot book an appointment", async () => {
      const { scheduledStart, scheduledEnd } = slot("10:00");
      await request(app.getHttpServer())
        .post("/api/appointments")
        .set("Authorization", `Bearer ${nurseToken}`)
        .send({ doctorId: doctorProfileId, scheduledStart, scheduledEnd })
        .expect(403)
        .expect((res) => expect(res.body.error.code).toBe("FORBIDDEN_ROLE"));
    });

    it("a PATIENT cannot book on behalf of another patient", async () => {
      const { scheduledStart, scheduledEnd } = slot("10:00");
      await request(app.getHttpServer())
        .post("/api/appointments")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({ patientId: randomUUID(), doctorId: doctorProfileId, scheduledStart, scheduledEnd })
        .expect(400)
        .expect((res) => expect(res.body.error.code).toBe("VALIDATION_ERROR"));
    });
  });

  describe("status state machine (FR-APPT-005) + reminder scheduling (FR-APPT-007)", () => {
    it("PENDING -> CONFIRMED by RECEPTIONIST schedules BullMQ reminder jobs; CANCELLED removes them", async () => {
      const { scheduledStart, scheduledEnd } = slot("10:00");
      const book = await request(app.getHttpServer())
        .post("/api/appointments")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({ doctorId: doctorProfileId, scheduledStart, scheduledEnd })
        .expect(201);
      const id = book.body.data.id as string;
      createdAppointmentIds.push(id);

      await request(app.getHttpServer())
        .patch(`/api/appointments/${id}/status`)
        .set("Authorization", `Bearer ${receptionistToken}`)
        .send({ status: "CONFIRMED" })
        .expect(200)
        .expect((res) => expect(res.body.data.status).toBe("CONFIRMED"));

      expect(await reminderQueue.hasReminderJob(id, "24h")).toBe(true);
      expect(await reminderQueue.hasReminderJob(id, "1h")).toBe(true);

      await request(app.getHttpServer())
        .patch(`/api/appointments/${id}/status`)
        .set("Authorization", `Bearer ${receptionistToken}`)
        .send({ status: "CANCELLED", cancelledReason: "test" })
        .expect(200);

      expect(await reminderQueue.hasReminderJob(id, "24h")).toBe(false);
      expect(await reminderQueue.hasReminderJob(id, "1h")).toBe(false);
    });

    it("a PATIENT cannot cancel their own CONFIRMED appointment (pending only)", async () => {
      const { scheduledStart, scheduledEnd } = slot("10:30");
      const book = await request(app.getHttpServer())
        .post("/api/appointments")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({ doctorId: doctorProfileId, scheduledStart, scheduledEnd })
        .expect(201);
      const id = book.body.data.id as string;
      createdAppointmentIds.push(id);

      await request(app.getHttpServer())
        .patch(`/api/appointments/${id}/status`)
        .set("Authorization", `Bearer ${receptionistToken}`)
        .send({ status: "CONFIRMED" })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/appointments/${id}/status`)
        .set("Authorization", `Bearer ${patientToken}`)
        .send({ status: "CANCELLED", cancelledReason: "changed my mind" })
        .expect(400)
        .expect((res) => expect(res.body.error.code).toBe("VALIDATION_ERROR"));
    });

    it("a NURSE may only check-in (CONFIRMED -> IN_PROGRESS), nothing else", async () => {
      const { scheduledStart, scheduledEnd } = slot("09:30");
      const book = await request(app.getHttpServer())
        .post("/api/appointments")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({ doctorId: doctorProfileId, scheduledStart, scheduledEnd })
        .expect(201);
      const id = book.body.data.id as string;
      createdAppointmentIds.push(id);

      await request(app.getHttpServer())
        .patch(`/api/appointments/${id}/status`)
        .set("Authorization", `Bearer ${nurseToken}`)
        .send({ status: "CONFIRMED" })
        .expect(400);

      await request(app.getHttpServer())
        .patch(`/api/appointments/${id}/status`)
        .set("Authorization", `Bearer ${receptionistToken}`)
        .send({ status: "CONFIRMED" })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/appointments/${id}/status`)
        .set("Authorization", `Bearer ${nurseToken}`)
        .send({ status: "IN_PROGRESS" })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/appointments/${id}/status`)
        .set("Authorization", `Bearer ${nurseToken}`)
        .send({ status: "COMPLETED" })
        .expect(400);
    });
  });

  describe("emergency appointments (FR-APPT-006)", () => {
    it("bypasses slot checks and is immediately CONFIRMED", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/appointments/emergency")
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({ patientId: patientProfileId, doctorId: doctorProfileId, reasonForVisit: "Emergency" })
        .expect(201);
      expect(res.body.data.status).toBe("CONFIRMED");
      expect(res.body.data.type).toBe("EMERGENCY");
      createdAppointmentIds.push(res.body.data.id);
    });

    it("still respects the no-double-booking constraint for the doctor", async () => {
      await request(app.getHttpServer())
        .post("/api/appointments/emergency")
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({ patientId: patientProfileId, doctorId: doctorProfileId, reasonForVisit: "Another one" })
        .expect(409)
        .expect((res) => expect(res.body.error.code).toBe("SLOT_UNAVAILABLE"));
    });

    it("a RECEPTIONIST cannot book a regular appointment as emergency-only bypass for a NURSE", async () => {
      await request(app.getHttpServer())
        .post("/api/appointments/emergency")
        .set("Authorization", `Bearer ${nurseToken}`)
        .send({ patientId: patientProfileId, doctorId: doctorProfileId })
        .expect(403);
    });
  });

  describe("cross-tenant isolation (SEC-TENANT-004) — mandatory scenario", () => {
    it("a receptionist from another hospital cannot view this doctor's availability or book against them", async () => {
      const otherHospital = await TenantContext.bypass(() =>
        prisma.hospital.create({
          data: {
            name: `Other Hospital ${suffix}`,
            slug: `other-hosp-${suffix}`,
            status: HospitalStatus.ACTIVE,
            contactEmail: `other-${suffix}@test.medcore.test`,
          },
        }),
      );
      createdHospitalIds.push(otherHospital.id);

      const passwordHash = await bcrypt.hash(PASSWORD, 4);
      const otherRecUser = await TenantContext.run(
        { hospitalId: otherHospital.id, userId: null, bypassTenancy: false },
        () =>
          prisma.user.create({
            data: {
              hospitalId: otherHospital.id,
              email: `other-rec-${suffix}@test.medcore.test`,
              passwordHash,
              firstName: "Other",
              lastName: "Rec",
              role: UserRole.RECEPTIONIST,
              status: UserStatus.ACTIVE,
              emailVerifiedAt: new Date(),
            },
          }),
      );
      createdUserIds.push(otherRecUser.id);
      const otherRecToken = await login(otherRecUser.email);

      await request(app.getHttpServer())
        .get(`/api/doctors/${doctorProfileId}/availability`)
        .query({ dateFrom: FUTURE_DATE, dateTo: FUTURE_DATE })
        .set("Authorization", `Bearer ${otherRecToken}`)
        .expect(404);

      const { scheduledStart, scheduledEnd } = slot("09:00");
      await request(app.getHttpServer())
        .post("/api/appointments")
        .set("Authorization", `Bearer ${otherRecToken}`)
        .send({ patientId: randomUUID(), doctorId: doctorProfileId, scheduledStart, scheduledEnd })
        .expect(404);
    });

    it("HOSPITAL_ADMIN listing appointments never leaks passwordHash", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/appointments")
        .query({ page: 1, limit: 50 })
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
    });
  });
});
