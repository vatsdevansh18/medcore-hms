import { randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import {
  AppointmentStatus,
  AppointmentType,
  HospitalStatus,
  InvoiceStatus,
  LabOrderItemStatus,
  LabResultFlag,
  MedicineForm,
  PaymentStatus,
  PrescriptionFrequency,
  UserRole,
  UserStatus,
} from "@medcore/types";
import { AppModule } from "../src/app.module";
import { PRISMA_CLIENT } from "../src/prisma/prisma.module";
import type { ExtendedPrismaClient } from "../src/prisma/prisma-client.factory";
import { TenantContext } from "../src/common/tenancy/tenant-context";
import { configureApp } from "../src/common/bootstrap/configure-app";
import { AppointmentReminderQueueService } from "../src/queue/appointment-reminder-queue.service";
import { purgeBilling } from "./helpers/billing-cleanup";

/**
 * Phase 12 — Patient Portal (FR-PORTAL-001..003). Covers the patient-scoped
 * list endpoints (prescriptions, lab orders, invoices), policy-gated
 * self-service rescheduling (D-035), payment receipts, the public hospital
 * directory, `/auth/me` additions, storage-key/contact minimisation in
 * responses (D-036), and hospital-timezone slot generation (D-037). Every
 * patient-scoped read is also tried as another patient, another hospital,
 * and a staff role.
 */
describe("Patient Portal (e2e)", () => {
  let app: INestApplication;
  let prisma: ExtendedPrismaClient;
  let reminderQueue: AppointmentReminderQueueService;
  const suffix = randomUUID().slice(0, 8);
  const PASSWORD = "Passw0rd!";
  // Asia/Kolkata is UTC+05:30 with no DST: 09:00 local is 03:30Z.
  const TIMEZONE = "Asia/Kolkata";

  let hospitalId: string;
  let otherHospitalId: string;
  let pendingHospitalId: string;
  let deptId: string;
  let doctorProfileId: string;
  let doctorUserId: string;
  let patientProfileId: string;
  let otherPatientProfileId: string;
  let medicineId: string;
  let labTestId: string;

  const createdUserIds: string[] = [];
  const createdHospitalIds: string[] = [];
  const createdAppointmentIds: string[] = [];

  let adminToken: string;
  let doctorToken: string;
  let receptionistToken: string;
  let patientToken: string;
  let otherPatientToken: string;
  let otherHospitalPatientToken: string;
  let otherReceptionistToken: string;

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function scoped<T>(hId: string, fn: () => Promise<T>): Promise<T> {
    return TenantContext.run({ hospitalId: hId, userId: null, bypassTenancy: false }, fn);
  }

  async function createUser(hId: string, role: UserRole, email: string) {
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    return scoped(hId, async () => {
      const user = await prisma.user.create({
        data: {
          hospitalId: hId,
          email,
          passwordHash,
          firstName: "Portal",
          lastName: role,
          phone: "+919800000000",
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
    const res = await api().post("/api/auth/login").send({ email, password: PASSWORD }).expect(200);
    return res.body.data.accessToken as string;
  }

  /** Calendar date `days` from today (UTC), as YYYY-MM-DD. */
  function dateKey(days: number): string {
    return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  }

  /** The UTC instant of `hhmm` IST on local date `key`. */
  function ist(key: string, hhmm: string): string {
    return new Date(`${key}T${hhmm}:00.000+05:30`).toISOString();
  }

  function addMinutes(iso: string, minutes: number): string {
    return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
  }

  function book(token: string, start: string, reasonForVisit = "Checkup") {
    return api()
      .post("/api/appointments")
      .set(auth(token))
      .send({ doctorId: doctorProfileId, scheduledStart: start, scheduledEnd: addMinutes(start, 30), reasonForVisit });
  }

  function reschedule(id: string, start: string, token = patientToken) {
    return api()
      .patch(`/api/appointments/${id}/reschedule`)
      .set(auth(token))
      .send({ scheduledStart: start, scheduledEnd: addMinutes(start, 30) });
  }

  async function bookOk(token: string, start: string): Promise<string> {
    const res = await book(token, start).expect(201);
    createdAppointmentIds.push(res.body.data.id);
    return res.body.data.id as string;
  }

  async function slotsOn(key: string, token = patientToken): Promise<string[]> {
    const res = await api()
      .get(`/api/doctors/${doctorProfileId}/availability`)
      .query({ dateFrom: key, dateTo: key })
      .set(auth(token))
      .expect(200);
    const day = res.body.data.find((d: { date: string }) => d.date === key);
    return (day?.slots ?? []).map((s: { start: string }) => s.start);
  }

  async function setPolicy(allowed: boolean, cutoffHours = 24) {
    await api()
      .patch(`/api/hospitals/${hospitalId}`)
      .set(auth(adminToken))
      .send({ patientRescheduleAllowed: allowed, patientRescheduleCutoffHours: cutoffHours })
      .expect(200);
  }

  /** An IN_PROGRESS appointment + encounter via the API (charges the fee). */
  let visitOffsetDays = 0;
  async function encounterFor(patientId: string) {
    visitOffsetDays += 1;
    const start = new Date(Date.now() - visitOffsetDays * 86_400_000);
    const appt = await scoped(hospitalId, () =>
      prisma.appointment.create({
        data: {
          hospitalId,
          patientId,
          doctorId: doctorProfileId,
          departmentId: deptId,
          scheduledStart: start,
          scheduledEnd: new Date(start.getTime() + 1_800_000),
          status: AppointmentStatus.IN_PROGRESS,
          createdBy: "system-test",
        },
      }),
    );
    createdAppointmentIds.push(appt.id);
    const res = await api()
      .post("/api/medical-records")
      .set(auth(doctorToken))
      .send({ appointmentId: appt.id, chiefComplaint: "Cough" })
      .expect(201);
    return { appointmentId: appt.id, medicalRecordId: res.body.data.id as string };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PRISMA_CLIENT);
    reminderQueue = app.get(AppointmentReminderQueueService);

    const mkHospital = (label: string, status: HospitalStatus = HospitalStatus.ACTIVE) =>
      TenantContext.bypass(() =>
        prisma.hospital.create({
          data: {
            name: `Portal ${label} ${suffix}`,
            slug: `portal-${label}-${suffix}`,
            status,
            timezone: TIMEZONE,
            contactEmail: `portal-${label}-${suffix}@test.medcore.test`,
          },
        }),
      );
    hospitalId = (await mkHospital("a")).id;
    otherHospitalId = (await mkHospital("b")).id;
    pendingHospitalId = (await mkHospital("pending", HospitalStatus.PENDING_VERIFICATION)).id;
    createdHospitalIds.push(hospitalId, otherHospitalId, pendingHospitalId);

    deptId = (await scoped(hospitalId, () => prisma.department.create({ data: { hospitalId, name: "General" } }))).id;

    const admin = await createUser(hospitalId, UserRole.HOSPITAL_ADMIN, `p-admin-${suffix}@test.medcore.test`);
    const doctor = await createUser(hospitalId, UserRole.DOCTOR, `p-doctor-${suffix}@test.medcore.test`);
    const receptionist = await createUser(hospitalId, UserRole.RECEPTIONIST, `p-rec-${suffix}@test.medcore.test`);
    const patient = await createUser(hospitalId, UserRole.PATIENT, `p-patient-${suffix}@test.medcore.test`);
    const otherPatient = await createUser(hospitalId, UserRole.PATIENT, `p-patient2-${suffix}@test.medcore.test`);
    const otherHospitalPatient = await createUser(otherHospitalId, UserRole.PATIENT, `p-other-pat-${suffix}@test.medcore.test`);
    const otherReceptionist = await createUser(otherHospitalId, UserRole.RECEPTIONIST, `p-other-rec-${suffix}@test.medcore.test`);
    doctorUserId = doctor.id;

    doctorProfileId = (
      await scoped(hospitalId, () =>
        prisma.doctorProfile.create({
          data: {
            userId: doctor.id,
            hospitalId,
            departmentId: deptId,
            specialization: "General Medicine",
            licenseNumber: `LIC-P-${suffix}`,
            consultationFee: 400,
            signatureImageUrl: `hospitals/${hospitalId}/doctors/signature.png`,
          },
        }),
      )
    ).id;
    // Every day of the week, 09:00-11:00 IST, 30-minute slots.
    await scoped(hospitalId, () =>
      prisma.doctorAvailability.createMany({
        data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          doctorId: doctorProfileId,
          dayOfWeek,
          startTime: "09:00",
          endTime: "11:00",
          slotDurationMinutes: 30,
        })),
      }),
    );
    patientProfileId = (await scoped(hospitalId, () => prisma.patientProfile.create({ data: { userId: patient.id, hospitalId } }))).id;
    otherPatientProfileId = (
      await scoped(hospitalId, () => prisma.patientProfile.create({ data: { userId: otherPatient.id, hospitalId } }))
    ).id;
    await scoped(otherHospitalId, () =>
      prisma.patientProfile.create({ data: { userId: otherHospitalPatient.id, hospitalId: otherHospitalId } }),
    );
    medicineId = (
      await scoped(hospitalId, () =>
        prisma.medicine.create({ data: { hospitalId, name: `Amoxicillin ${suffix}`, form: MedicineForm.CAPSULE, unit: "capsule" } }),
      )
    ).id;
    labTestId = (
      await scoped(hospitalId, () =>
        prisma.labTest.create({ data: { hospitalId, name: `Haemoglobin ${suffix}`, code: `HB-${suffix}`, price: 150 } }),
      )
    ).id;

    adminToken = await login(admin.email);
    doctorToken = await login(doctor.email);
    receptionistToken = await login(receptionist.email);
    patientToken = await login(patient.email);
    otherPatientToken = await login(otherPatient.email);
    otherHospitalPatientToken = await login(otherHospitalPatient.email);
    otherReceptionistToken = await login(otherReceptionist.email);
  });

  afterAll(async () => {
    await Promise.all(createdAppointmentIds.map((id) => reminderQueue.cancelReminders(id).catch(() => undefined)));
    await purgeBilling(prisma, createdHospitalIds);
    await TenantContext.bypass(async () => {
      const where = { hospitalId: { in: createdHospitalIds } };
      await prisma.notification.deleteMany({ where });
      await prisma.prescriptionItem.deleteMany({ where: { prescription: where } });
      await prisma.prescription.deleteMany({ where });
      await prisma.medicine.deleteMany({ where });
      await prisma.labResult.deleteMany({ where: { labOrderItem: { labOrder: where } } });
      await prisma.labOrderItem.deleteMany({ where: { labOrder: where } });
      await prisma.labOrder.deleteMany({ where });
      await prisma.labTest.deleteMany({ where });
      await prisma.attachment.deleteMany({ where });
      await prisma.medicalRecord.deleteMany({ where });
      await prisma.appointment.deleteMany({ where });
      await prisma.doctorAvailability.deleteMany({ where: { doctor: where } });
      await prisma.doctorProfile.deleteMany({ where });
      await prisma.patientProfile.deleteMany({ where });
      await prisma.refreshTokenSession.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma.department.deleteMany({ where });
      await prisma.auditLog.deleteMany({ where });
      await prisma.hospital.deleteMany({ where: { id: { in: createdHospitalIds } } });
    });
    await app.close();
  });

  describe("public hospital directory", () => {
    it("lists ACTIVE hospitals without authentication, names and cities only", async () => {
      const res = await api().get("/api/hospitals/directory").expect(200);
      const ids = res.body.data.map((h: { id: string }) => h.id);
      expect(ids).toContain(hospitalId);
      expect(ids).not.toContain(pendingHospitalId);
      const entry = res.body.data.find((h: { id: string }) => h.id === hospitalId);
      expect(Object.keys(entry).sort()).toEqual(["city", "id", "name", "slug"]);
    });
  });

  describe("/auth/me", () => {
    it("gives a patient their own PatientProfile id and the hospital's timezone and reschedule policy", async () => {
      const res = await api().get("/api/auth/me").set(auth(patientToken)).expect(200);
      expect(res.body.data.patientProfileId).toBe(patientProfileId);
      expect(res.body.data.hospital).toEqual({
        id: hospitalId,
        name: `Portal a ${suffix}`,
        timezone: TIMEZONE,
        patientRescheduleAllowed: true,
        patientRescheduleCutoffHours: 24,
      });
      expect(res.body.data.passwordHash).toBeUndefined();
    });

    it("has no patientProfileId for staff", async () => {
      const res = await api().get("/api/auth/me").set(auth(doctorToken)).expect(200);
      expect(res.body.data.patientProfileId).toBeNull();
    });
  });

  describe("hospital-timezone scheduling (D-037)", () => {
    it("generates slots at the doctor's local wall-clock times, keyed by the local date", async () => {
      const key = dateKey(20);
      const slots = await slotsOn(key);
      expect(slots[0]).toBe(ist(key, "09:00"));
      expect(slots[0]).toBe(`${key}T03:30:00.000Z`);
      expect(slots).toHaveLength(4);
    });

    it("books the local 09:00 slot and rejects the old UTC reading of 09:00 (409)", async () => {
      const key = dateKey(21);
      await book(patientToken, `${key}T09:00:00.000Z`).expect(409);
      const id = await bookOk(patientToken, ist(key, "09:00"));
      expect(await slotsOn(key)).not.toContain(ist(key, "09:00"));
      // Clean up so the slot tests below aren't affected.
      await api()
        .patch(`/api/appointments/${id}/status`)
        .set(auth(patientToken))
        .send({ status: AppointmentStatus.CANCELLED, cancelledReason: "test" })
        .expect(200);
    });
  });

  describe("doctor directory minimisation (D-036)", () => {
    it("shows a patient the doctor's name but no contact details or signature storage key", async () => {
      const res = await api().get(`/api/doctors/${doctorProfileId}`).set(auth(patientToken)).expect(200);
      expect(res.body.data.user.firstName).toBe("Portal");
      expect(res.body.data.user.email).toBeUndefined();
      expect(res.body.data.user.phone).toBeUndefined();
      expect(res.body.data.signatureImageUrl).toBeUndefined();
      expect(res.body.data.hasSignature).toBe(true);
      const list = await api().get("/api/doctors").set(auth(patientToken)).expect(200);
      expect(JSON.stringify(list.body.data)).not.toContain("signature.png");
      expect(JSON.stringify(list.body.data)).not.toContain(`p-doctor-${suffix}`);
    });

    it("still gives staff the doctor's contact details, but never the storage key", async () => {
      const res = await api().get(`/api/doctors/${doctorProfileId}`).set(auth(adminToken)).expect(200);
      expect(res.body.data.user.email).toBe(`p-doctor-${suffix}@test.medcore.test`);
      expect(res.body.data.signatureImageUrl).toBeUndefined();
    });

    it("never puts the doctor's contact details in an appointment a patient reads", async () => {
      const id = await bookOk(patientToken, ist(dateKey(22), "10:30"));
      const res = await api().get(`/api/appointments/${id}`).set(auth(patientToken)).expect(200);
      expect(res.body.data.doctor.user).toEqual({ id: doctorUserId, firstName: "Portal", lastName: UserRole.DOCTOR });
      expect(res.body.data.doctor.signatureImageUrl).toBeUndefined();
    });
  });

  describe("self-service reschedule (FR-PORTAL-002, D-035)", () => {
    it("moves a PENDING appointment to another open slot, freeing the old one", async () => {
      const key = dateKey(25);
      const id = await bookOk(patientToken, ist(key, "09:00"));
      const res = await reschedule(id, ist(key, "10:00")).expect(200);
      expect(res.body.data.id).toBe(id);
      expect(res.body.data.status).toBe(AppointmentStatus.PENDING);
      expect(res.body.data.scheduledStart).toBe(ist(key, "10:00"));
      const slots = await slotsOn(key);
      expect(slots).toContain(ist(key, "09:00"));
      expect(slots).not.toContain(ist(key, "10:00"));
    });

    it("sends a CONFIRMED appointment back to PENDING and removes its reminders", async () => {
      const key = dateKey(26);
      const id = await bookOk(patientToken, ist(key, "09:00"));
      await api()
        .patch(`/api/appointments/${id}/status`)
        .set(auth(receptionistToken))
        .send({ status: AppointmentStatus.CONFIRMED })
        .expect(200);
      expect(await reminderQueue.hasReminderJob(id, "24h")).toBe(true);
      const res = await reschedule(id, ist(key, "09:30")).expect(200);
      expect(res.body.data.status).toBe(AppointmentStatus.PENDING);
      expect(await reminderQueue.hasReminderJob(id, "24h")).toBe(false);
      expect(await reminderQueue.hasReminderJob(id, "1h")).toBe(false);
    });

    it("refuses when the hospital's policy doesn't allow it (422), and allows it again once enabled", async () => {
      const key = dateKey(27);
      const id = await bookOk(patientToken, ist(key, "09:00"));
      await setPolicy(false);
      try {
        const res = await reschedule(id, ist(key, "09:30")).expect(422);
        expect(res.body.error.code).toBe("RESCHEDULE_NOT_ALLOWED");
      } finally {
        await setPolicy(true);
      }
      await reschedule(id, ist(key, "09:30")).expect(200);
    });

    it("refuses inside the cutoff window (422)", async () => {
      const key = dateKey(28);
      const id = await bookOk(patientToken, ist(key, "09:00"));
      // 28 days ahead is inside a 30-day (720h) cutoff.
      await setPolicy(true, 720);
      try {
        const res = await reschedule(id, ist(key, "09:30")).expect(422);
        expect(res.body.error.code).toBe("RESCHEDULE_NOT_ALLOWED");
        expect(res.body.error.details.cutoffHours).toBe(720);
      } finally {
        await setPolicy(true, 24);
      }
    });

    it("rejects a time that isn't an open slot, or one another patient holds (409)", async () => {
      const key = dateKey(29);
      const id = await bookOk(patientToken, ist(key, "09:00"));
      await bookOk(otherPatientToken, ist(key, "10:00"));
      await reschedule(id, ist(key, "09:10")).expect(409);
      await reschedule(id, ist(key, "10:00")).expect(409);
      await reschedule(id, ist(key, "13:00")).expect(409);
      // Its own current slot isn't "open" either.
      await reschedule(id, ist(key, "09:00")).expect(409);
    });

    it("hides another patient's appointment and another hospital's (404) and refuses staff (403)", async () => {
      const key = dateKey(30);
      const id = await bookOk(patientToken, ist(key, "09:00"));
      await reschedule(id, ist(key, "09:30"), otherPatientToken).expect(404);
      await reschedule(id, ist(key, "09:30"), otherHospitalPatientToken).expect(404);
      await reschedule(id, ist(key, "09:30"), receptionistToken).expect(403);
      await reschedule(id, ist(key, "09:30"), doctorToken).expect(403);
      const row = await TenantContext.bypass(() => prisma.appointment.findUniqueOrThrow({ where: { id } }));
      expect(row.scheduledStart.toISOString()).toBe(ist(key, "09:00"));
    });

    it("refuses a CANCELLED appointment (409) and an emergency one (422)", async () => {
      const key = dateKey(31);
      const id = await bookOk(patientToken, ist(key, "09:00"));
      await api()
        .patch(`/api/appointments/${id}/status`)
        .set(auth(patientToken))
        .send({ status: AppointmentStatus.CANCELLED, cancelledReason: "changed plans" })
        .expect(200);
      await reschedule(id, ist(key, "09:30")).expect(409);

      const emergency = await scoped(hospitalId, () =>
        prisma.appointment.create({
          data: {
            hospitalId,
            patientId: patientProfileId,
            doctorId: doctorProfileId,
            departmentId: deptId,
            scheduledStart: new Date(ist(dateKey(32), "08:00")),
            scheduledEnd: new Date(ist(dateKey(32), "08:30")),
            status: AppointmentStatus.CONFIRMED,
            type: AppointmentType.EMERGENCY,
            createdBy: "system-test",
          },
        }),
      );
      createdAppointmentIds.push(emergency.id);
      const res = await reschedule(emergency.id, ist(dateKey(32), "09:00")).expect(422);
      expect(res.body.error.code).toBe("RESCHEDULE_NOT_ALLOWED");
    });

    it("applies exactly one of two concurrent reschedules of the same appointment", async () => {
      const key = dateKey(33);
      const id = await bookOk(patientToken, ist(key, "09:00"));
      const results = await Promise.all([reschedule(id, ist(key, "09:30")), reschedule(id, ist(key, "10:00"))]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409]);
      const row = await TenantContext.bypass(() => prisma.appointment.findUniqueOrThrow({ where: { id } }));
      const winner = results.find((r) => r.status === 200)!;
      expect(row.scheduledStart.toISOString()).toBe(winner.body.data.scheduledStart);
    });

    it("gives exactly one of two patients racing for the same new slot", async () => {
      const key = dateKey(34);
      const mine = await bookOk(patientToken, ist(key, "09:00"));
      const theirs = await bookOk(otherPatientToken, ist(key, "09:30"));
      const results = await Promise.all([
        reschedule(mine, ist(key, "10:30"), patientToken),
        reschedule(theirs, ist(key, "10:30"), otherPatientToken),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });

    it("validates the hospital policy fields (400) and lets only the hospital's own admin change them", async () => {
      await api()
        .patch(`/api/hospitals/${hospitalId}`)
        .set(auth(adminToken))
        .send({ patientRescheduleCutoffHours: -1 })
        .expect(400);
      await api()
        .patch(`/api/hospitals/${hospitalId}`)
        .set(auth(adminToken))
        .send({ patientRescheduleAllowed: "yes" })
        .expect(400);
      await api()
        .patch(`/api/hospitals/${hospitalId}`)
        .set(auth(patientToken))
        .send({ patientRescheduleAllowed: false })
        .expect(403);
    });
  });

  describe("appointment list ordering", () => {
    it("lists soonest first with sortOrder=asc (upcoming view), newest first by default, and rejects other values", async () => {
      const starts = (res: request.Response) =>
        res.body.data.map((a: { scheduledStart: string }) => new Date(a.scheduledStart).getTime());
      const asc = starts(await api().get("/api/appointments?sortOrder=asc&limit=100").set(auth(patientToken)).expect(200));
      const desc = starts(await api().get("/api/appointments?limit=100").set(auth(patientToken)).expect(200));
      expect(asc.length).toBeGreaterThan(2);
      expect(asc).toEqual([...asc].sort((a: number, b: number) => a - b));
      expect(desc).toEqual([...asc].reverse());
      await api().get("/api/appointments?sortOrder=sideways").set(auth(patientToken)).expect(400);
    });
  });

  describe("prescriptions (FR-PORTAL-001)", () => {
    let prescriptionId: string;

    beforeAll(async () => {
      const { medicalRecordId } = await encounterFor(patientProfileId);
      const res = await api()
        .post("/api/prescriptions")
        .set(auth(doctorToken))
        .send({
          medicalRecordId,
          items: [
            {
              medicineId,
              dosage: "500 mg",
              frequency: PrescriptionFrequency.TDS,
              durationDays: 5,
              quantityPrescribed: 15,
            },
          ],
        })
        .expect(201);
      prescriptionId = res.body.data.id;
      expect(res.body.data.pdfUrl).toBeUndefined();
      expect(res.body.data.signatureImageUrl).toBeUndefined();
      await encounterFor(otherPatientProfileId);
    });

    it("lists only the patient's own prescriptions, with no storage keys", async () => {
      const mine = await api().get("/api/prescriptions").set(auth(patientToken)).expect(200);
      expect(mine.body.data.map((p: { id: string }) => p.id)).toEqual([prescriptionId]);
      const row = mine.body.data[0];
      expect(row.items[0].medicine.name).toBe(`Amoxicillin ${suffix}`);
      expect(row.doctor.user).toEqual({ id: doctorUserId, firstName: "Portal", lastName: UserRole.DOCTOR });
      expect(typeof row.pdfReady).toBe("boolean");
      expect(row.pdfUrl).toBeUndefined();
      expect(row.signatureImageUrl).toBeUndefined();
      expect(mine.body.meta.total).toBe(1);

      const theirs = await api().get("/api/prescriptions").set(auth(otherPatientToken)).expect(200);
      expect(theirs.body.data.map((p: { id: string }) => p.id)).not.toContain(prescriptionId);
      const elsewhere = await api().get("/api/prescriptions").set(auth(otherHospitalPatientToken)).expect(200);
      expect(elsewhere.body.data).toEqual([]);
    });

    it("rejects an invalid status filter (400) and staff callers (403)", async () => {
      await api().get("/api/prescriptions?status=NOPE").set(auth(patientToken)).expect(400);
      await api().get("/api/prescriptions").set(auth(doctorToken)).expect(403);
      await api().get("/api/prescriptions").set(auth(receptionistToken)).expect(403);
    });

    it("strips storage keys from the single-prescription read too, for every role", async () => {
      for (const token of [patientToken, doctorToken]) {
        const res = await api().get(`/api/prescriptions/${prescriptionId}`).set(auth(token)).expect(200);
        expect(res.body.data.pdfUrl).toBeUndefined();
        expect(res.body.data.signatureImageUrl).toBeUndefined();
        expect(JSON.stringify(res.body.data)).not.toContain("signature.png");
      }
      await api().get(`/api/prescriptions/${prescriptionId}`).set(auth(otherPatientToken)).expect(404);
    });
  });

  describe("lab reports (FR-PORTAL-001, D-021)", () => {
    let orderId: string;
    let approvedItemId: string;
    let pendingItemId: string;

    beforeAll(async () => {
      const { medicalRecordId } = await encounterFor(patientProfileId);
      const res = await api()
        .post("/api/lab-orders")
        .set(auth(doctorToken))
        .send({ medicalRecordId, items: [{ labTestId }, { labTestId }] })
        .expect(201);
      orderId = res.body.data.id;
      [approvedItemId, pendingItemId] = res.body.data.items.map((i: { id: string }) => i.id);
      const values = [{ parameter: "Haemoglobin", value: 13.2, unit: "g/dL", flag: LabResultFlag.NORMAL }];
      await TenantContext.bypass(async () => {
        await prisma.labOrderItem.update({ where: { id: approvedItemId }, data: { status: LabOrderItemStatus.APPROVED } });
        await prisma.labResult.create({
          data: {
            labOrderItemId: approvedItemId,
            structuredValues: values,
            enteredBy: doctorUserId,
            approvedBy: doctorUserId,
            approvedAt: new Date(),
          },
        });
        await prisma.labOrderItem.update({ where: { id: pendingItemId }, data: { status: LabOrderItemStatus.RESULT_UPLOADED } });
        await prisma.labResult.create({
          data: { labOrderItemId: pendingItemId, structuredValues: values, enteredBy: doctorUserId },
        });
      });
    });

    it("lists the patient's own orders as summaries with no results in them", async () => {
      const res = await api().get("/api/lab-orders").set(auth(patientToken)).expect(200);
      const order = res.body.data.find((o: { id: string }) => o.id === orderId);
      expect(order.items).toHaveLength(2);
      expect(order.items[0].labTest.name).toBe(`Haemoglobin ${suffix}`);
      expect(order.items[0].result).toBeUndefined();
      expect(order.doctor.user.email).toBeUndefined();

      const theirs = await api().get("/api/lab-orders").set(auth(otherPatientToken)).expect(200);
      expect(theirs.body.data.map((o: { id: string }) => o.id)).not.toContain(orderId);
      await api().get("/api/lab-orders").set(auth(doctorToken)).expect(403);
    });

    it("shows a result only once APPROVED, and hides the order from other patients (404)", async () => {
      const res = await api().get(`/api/lab-orders/${orderId}`).set(auth(patientToken)).expect(200);
      const byId = new Map(res.body.data.items.map((i: { id: string }) => [i.id, i]));
      const approved = byId.get(approvedItemId) as { result: { structuredValues: { value: number }[] } };
      const pending = byId.get(pendingItemId) as { result: unknown };
      expect(approved.result.structuredValues[0].value).toBe(13.2);
      expect(pending.result).toBeNull();
      await api().get(`/api/lab-orders/${orderId}`).set(auth(otherPatientToken)).expect(404);
      await api().get(`/api/lab-orders/${orderId}`).set(auth(otherHospitalPatientToken)).expect(404);
    });
  });

  describe("invoices and receipts (FR-PORTAL-001/003)", () => {
    let draftId: string;
    let finalizedId: string;
    let paymentId: string;

    beforeAll(async () => {
      const draftVisit = await encounterFor(patientProfileId);
      const finalVisit = await encounterFor(patientProfileId);
      const invoiceOf = async (appointmentId: string) =>
        (await TenantContext.bypass(() => prisma.invoice.findFirstOrThrow({ where: { appointmentId } }))).id;
      draftId = await invoiceOf(draftVisit.appointmentId);
      finalizedId = await invoiceOf(finalVisit.appointmentId);
      await api().patch(`/api/invoices/${finalizedId}/finalize`).set(auth(receptionistToken)).expect(200);
      await api()
        .post(`/api/invoices/${finalizedId}/cash-payment`)
        .set(auth(receptionistToken))
        .send({ amount: 100 })
        .expect(201);
      paymentId = (
        await TenantContext.bypass(() => prisma.payment.findFirstOrThrow({ where: { invoiceId: finalizedId } }))
      ).id;
    });

    it("lists the patient's own invoices, never DRAFTs, and a patientId filter can't widen it", async () => {
      const res = await api().get("/api/invoices").set(auth(patientToken)).expect(200);
      const ids = res.body.data.map((i: { id: string }) => i.id);
      expect(ids).toContain(finalizedId);
      expect(ids).not.toContain(draftId);
      expect(res.body.data.every((i: { status: string }) => i.status !== InvoiceStatus.DRAFT)).toBe(true);

      const drafts = await api().get(`/api/invoices?status=${InvoiceStatus.DRAFT}`).set(auth(patientToken)).expect(200);
      expect(drafts.body.data).toEqual([]);
      const widened = await api()
        .get(`/api/invoices?patientId=${otherPatientProfileId}`)
        .set(auth(patientToken))
        .expect(200);
      expect(widened.body.data.map((i: { id: string }) => i.id)).toContain(finalizedId);
      const theirs = await api().get("/api/invoices").set(auth(otherPatientToken)).expect(200);
      expect(theirs.body.data.map((i: { id: string }) => i.id)).not.toContain(finalizedId);
    });

    it("hides a DRAFT invoice from its own patient (404) but shows the finalized one with its payment", async () => {
      await api().get(`/api/invoices/${draftId}`).set(auth(patientToken)).expect(404);
      const res = await api().get(`/api/invoices/${finalizedId}`).set(auth(patientToken)).expect(200);
      expect(res.body.data.status).toBe(InvoiceStatus.PARTIALLY_PAID);
      expect(res.body.data.payments[0].id).toBe(paymentId);
      // Staff still see the draft.
      await api().get(`/api/invoices/${draftId}`).set(auth(receptionistToken)).expect(200);
    });

    it("renders a receipt PDF once, caches it, and returns a working pre-signed link", async () => {
      const first = await api().get(`/api/payments/${paymentId}/receipt`).set(auth(patientToken)).expect(200);
      const pdf = await fetch(first.body.data.downloadUrl);
      expect(pdf.ok).toBe(true);
      expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");

      const row = await TenantContext.bypass(() => prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }));
      expect(row.receiptUrl).toContain(`receipts/${paymentId}`);
      expect(JSON.stringify(first.body.data)).not.toContain('"receiptUrl"');

      await api().get(`/api/payments/${paymentId}/receipt`).set(auth(receptionistToken)).expect(200);
      const again = await TenantContext.bypass(() => prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }));
      expect(again.receiptUrl).toBe(row.receiptUrl);
    }, 60_000);

    it("refuses another patient or hospital (404), non-billing staff (403), and an unpaid payment (409)", async () => {
      await api().get(`/api/payments/${paymentId}/receipt`).set(auth(otherPatientToken)).expect(404);
      await api().get(`/api/payments/${paymentId}/receipt`).set(auth(otherHospitalPatientToken)).expect(404);
      await api().get(`/api/payments/${paymentId}/receipt`).set(auth(otherReceptionistToken)).expect(404);
      await api().get(`/api/payments/${paymentId}/receipt`).set(auth(doctorToken)).expect(403);
      await api().get(`/api/payments/${randomUUID()}/receipt`).set(auth(patientToken)).expect(404);

      const pending = await scoped(hospitalId, () =>
        prisma.payment.create({
          data: { hospitalId, invoiceId: finalizedId, method: "STRIPE", amount: 10, status: PaymentStatus.PENDING },
        }),
      );
      const res = await api().get(`/api/payments/${pending.id}/receipt`).set(auth(patientToken)).expect(409);
      expect(res.body.error.message).toMatch(/succeeded/);
    });
  });

  describe("EMR storage keys (D-036)", () => {
    it("never returns an attachment's storage key, on upload or on read", async () => {
      const { medicalRecordId } = await encounterFor(patientProfileId);
      const upload = await api()
        .post(`/api/medical-records/${medicalRecordId}/attachments`)
        .set(auth(doctorToken))
        .send({ fileName: "xray.png", mimeType: "image/png", sizeBytes: 1024 })
        .expect(201);
      expect(upload.body.data.attachment.storageKey).toBeUndefined();
      expect(upload.body.data.uploadUrl).toBeTruthy();

      const list = await api().get(`/api/medical-records/${patientProfileId}`).set(auth(patientToken)).expect(200);
      const record = list.body.data.find((r: { id: string }) => r.id === medicalRecordId);
      expect(record.attachments[0].fileName).toBe("xray.png");
      expect(record.attachments[0].storageKey).toBeUndefined();
      await api().get(`/api/medical-records/${patientProfileId}`).set(auth(otherPatientToken)).expect(404);
    });
  });
});
