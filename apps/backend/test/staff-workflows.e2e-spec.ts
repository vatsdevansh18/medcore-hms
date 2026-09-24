import { randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AppointmentStatus, HospitalStatus, ReferenceRangeGender, UserRole, UserStatus } from "@medcore/types";
import { AppModule } from "../src/app.module";
import { PRISMA_CLIENT } from "../src/prisma/prisma.module";
import type { ExtendedPrismaClient } from "../src/prisma/prisma-client.factory";
import { TenantContext } from "../src/common/tenancy/tenant-context";
import { configureApp } from "../src/common/bootstrap/configure-app";
import { purgeBilling } from "./helpers/billing-cleanup";

/**
 * Phase 13B — the read endpoints the staff workflow screens need
 * (docs/11-DECISIONS.md D-041): the lab test catalog, the Hospital Admin's
 * staff directory, an encounter record by appointment, the per-encounter
 * filters on prescriptions and lab orders, and the doctor's own profile id
 * on /auth/me. Each is checked for role, tenancy, and scope narrowing.
 */
describe("Staff workflow reads (e2e)", () => {
  let app: INestApplication;
  let prisma: ExtendedPrismaClient;
  const suffix = randomUUID().slice(0, 8);
  const PASSWORD = "Passw0rd!";

  let hospitalId: string;
  let otherHospitalId: string;
  let deptId: string;
  let otherDeptId: string;
  let doctorProfileId: string;
  let doctor2ProfileId: string;
  let otherDoctorProfileId: string;
  let patientProfileId: string;
  let patient2ProfileId: string;
  let otherPatientProfileId: string;
  let labTestId: string;
  let medicineId: string;

  const createdUserIds: string[] = [];
  const createdHospitalIds: string[] = [];
  const tokens: Record<string, string> = {};

  async function createUser(hId: string, role: UserRole, email: string, firstName = "Test", lastName = "User") {
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    return TenantContext.run({ hospitalId: hId, userId: null, bypassTenancy: false }, async () => {
      const user = await prisma.user.create({
        data: {
          hospitalId: hId,
          email,
          passwordHash,
          firstName,
          lastName,
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

  function get(path: string, token: string) {
    return request(app.getHttpServer()).get(`/api${path}`).set("Authorization", `Bearer ${token}`);
  }

  let apptOffset = 0;
  async function createAppointment(hId: string, patId: string, docId: string, dId: string, status: AppointmentStatus) {
    apptOffset += 60;
    const start = Date.now() + apptOffset * 60_000;
    return TenantContext.run({ hospitalId: hId, userId: null, bypassTenancy: false }, () =>
      prisma.appointment.create({
        data: {
          hospitalId: hId,
          patientId: patId,
          doctorId: docId,
          departmentId: dId,
          scheduledStart: new Date(start),
          scheduledEnd: new Date(start + 1_800_000),
          status,
          createdBy: "system-test",
        },
      }),
    );
  }

  async function createRecord(hId: string, patId: string, docId: string, dId: string) {
    const appt = await createAppointment(hId, patId, docId, dId, AppointmentStatus.IN_PROGRESS);
    const record = await TenantContext.run({ hospitalId: hId, userId: null, bypassTenancy: false }, () =>
      prisma.medicalRecord.create({
        data: { hospitalId: hId, appointmentId: appt.id, patientId: patId, doctorId: docId, chiefComplaint: "Cough" },
      }),
    );
    return { appt, record };
  }

  async function createPrescription(recordId: string, docId: string, patId: string) {
    return TenantContext.run({ hospitalId, userId: null, bypassTenancy: false }, () =>
      prisma.prescription.create({
        data: {
          hospitalId,
          medicalRecordId: recordId,
          doctorId: docId,
          patientId: patId,
          items: {
            create: [
              { medicineId, dosage: "500 mg", frequency: "BD", durationDays: 5, quantityPrescribed: 10 },
            ],
          },
        },
      }),
    );
  }

  async function createLabOrder(recordId: string, docId: string, patId: string) {
    return TenantContext.run({ hospitalId, userId: null, bypassTenancy: false }, () =>
      prisma.labOrder.create({
        data: {
          hospitalId,
          medicalRecordId: recordId,
          doctorId: docId,
          patientId: patId,
          items: { create: [{ labTestId }] },
        },
      }),
    );
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PRISMA_CLIENT);

    const [hospital, otherHospital] = await TenantContext.bypass(() =>
      Promise.all(
        ["a", "b"].map((tag) =>
          prisma.hospital.create({
            data: {
              name: `Staff Reads ${tag} ${suffix}`,
              slug: `staff-reads-${tag}-${suffix}`,
              status: HospitalStatus.ACTIVE,
              contactEmail: `staff-reads-${tag}-${suffix}@test.medcore.test`,
            },
          }),
        ),
      ),
    );
    hospitalId = hospital.id;
    otherHospitalId = otherHospital.id;
    createdHospitalIds.push(hospitalId, otherHospitalId);

    deptId = (
      await TenantContext.run({ hospitalId, userId: null, bypassTenancy: false }, () =>
        prisma.department.create({ data: { hospitalId, name: "General" } }),
      )
    ).id;
    otherDeptId = (
      await TenantContext.run({ hospitalId: otherHospitalId, userId: null, bypassTenancy: false }, () =>
        prisma.department.create({ data: { hospitalId: otherHospitalId, name: "General" } }),
      )
    ).id;

    const mail = (name: string) => `${name}-${suffix}@test.medcore.test`;
    const admin = await createUser(hospitalId, UserRole.HOSPITAL_ADMIN, mail("admin"), "Ada", "Admin");
    const doctor = await createUser(hospitalId, UserRole.DOCTOR, mail("doctor"), "Dora", "Quill");
    const doctor2 = await createUser(hospitalId, UserRole.DOCTOR, mail("doctor2"), "Derek", "Stone");
    const nurse = await createUser(hospitalId, UserRole.NURSE, mail("nurse"), "Nina", "Vale");
    const receptionist = await createUser(hospitalId, UserRole.RECEPTIONIST, mail("reception"), "Rita", "Desk");
    const lab = await createUser(hospitalId, UserRole.LAB_TECHNICIAN, mail("lab"), "Leo", "Bench");
    const pharmacist = await createUser(hospitalId, UserRole.PHARMACIST, mail("pharm"), "Phil", "Pills");
    const accountant = await createUser(hospitalId, UserRole.ACCOUNTANT, mail("acct"), "Ace", "Ledger");
    const patient = await createUser(hospitalId, UserRole.PATIENT, mail("patient"), "Pat", "Ient");
    const patient2 = await createUser(hospitalId, UserRole.PATIENT, mail("patient2"), "Paula", "Two");
    const otherAdmin = await createUser(otherHospitalId, UserRole.HOSPITAL_ADMIN, mail("other-admin"), "Oscar", "Admin");
    const otherDoctor = await createUser(otherHospitalId, UserRole.DOCTOR, mail("other-doctor"), "Olga", "Quill");
    const otherPatient = await createUser(otherHospitalId, UserRole.PATIENT, mail("other-patient"), "Otto", "Ient");

    const scoped = <T>(hId: string, fn: () => Promise<T>) =>
      TenantContext.run({ hospitalId: hId, userId: null, bypassTenancy: false }, fn);
    const doctorProfile = (userId: string, hId: string, dId: string, lic: string) =>
      scoped(hId, () =>
        prisma.doctorProfile.create({
          data: { userId, hospitalId: hId, departmentId: dId, specialization: "General Medicine", licenseNumber: lic, consultationFee: 100 },
        }),
      );
    doctorProfileId = (await doctorProfile(doctor.id, hospitalId, deptId, `L1-${suffix}`)).id;
    doctor2ProfileId = (await doctorProfile(doctor2.id, hospitalId, deptId, `L2-${suffix}`)).id;
    otherDoctorProfileId = (await doctorProfile(otherDoctor.id, otherHospitalId, otherDeptId, `L3-${suffix}`)).id;
    await scoped(hospitalId, () =>
      prisma.staffProfile.create({ data: { userId: nurse.id, hospitalId, departmentId: deptId, employeeCode: `N-${suffix}` } }),
    );
    patientProfileId = (
      await scoped(hospitalId, () => prisma.patientProfile.create({ data: { userId: patient.id, hospitalId } }))
    ).id;
    patient2ProfileId = (
      await scoped(hospitalId, () => prisma.patientProfile.create({ data: { userId: patient2.id, hospitalId } }))
    ).id;
    otherPatientProfileId = (
      await scoped(otherHospitalId, () =>
        prisma.patientProfile.create({ data: { userId: otherPatient.id, hospitalId: otherHospitalId } }),
      )
    ).id;

    const test = await scoped(hospitalId, () =>
      prisma.labTest.create({ data: { hospitalId, name: `Serum Ferritin ${suffix}`, code: `FER-${suffix}`, price: 450, sampleType: "Blood" } }),
    );
    labTestId = test.id;
    await TenantContext.bypass(() =>
      prisma.labTestReferenceRange.create({
        data: { labTestId, gender: ReferenceRangeGender.ANY, lowValue: 30, highValue: 400, unit: "ng/mL" },
      }),
    );
    await scoped(otherHospitalId, () =>
      prisma.labTest.create({
        data: { hospitalId: otherHospitalId, name: `Serum Ferritin other ${suffix}`, code: `FER-${suffix}`, price: 999 },
      }),
    );
    medicineId = (
      await scoped(hospitalId, () =>
        prisma.medicine.create({ data: { hospitalId, name: `Amoxicillin ${suffix}`, form: "CAPSULE", unit: "capsule" } }),
      )
    ).id;

    const logins: Array<[string, string]> = [
      ["admin", admin.email],
      ["doctor", doctor.email],
      ["doctor2", doctor2.email],
      ["nurse", nurse.email],
      ["receptionist", receptionist.email],
      ["lab", lab.email],
      ["pharmacist", pharmacist.email],
      ["accountant", accountant.email],
      ["patient", patient.email],
      ["patient2", patient2.email],
      ["otherAdmin", otherAdmin.email],
      ["otherDoctor", otherDoctor.email],
    ];
    for (const [key, email] of logins) tokens[key] = await login(email);
  });

  afterAll(async () => {
    await TenantContext.bypass(async () => {
      const inHospitals = { hospitalId: { in: createdHospitalIds } };
      await prisma.notification.deleteMany({ where: inHospitals });
      await prisma.dispenseRecord.deleteMany({ where: { prescriptionItem: { prescription: inHospitals } } });
      await prisma.prescriptionItem.deleteMany({ where: { prescription: inHospitals } });
      await prisma.prescription.deleteMany({ where: inHospitals });
      await prisma.labOrderItem.deleteMany({ where: { labOrder: inHospitals } });
      await prisma.labOrder.deleteMany({ where: inHospitals });
      await prisma.labTestReferenceRange.deleteMany({ where: { labTest: inHospitals } });
      await prisma.labTest.deleteMany({ where: inHospitals });
      await prisma.medicineBatch.deleteMany({ where: inHospitals });
      await prisma.medicine.deleteMany({ where: inHospitals });
      await prisma.medicalRecord.deleteMany({ where: inHospitals });
      await purgeBilling(prisma, createdHospitalIds);
      await prisma.appointment.deleteMany({ where: inHospitals });
      await prisma.doctorProfile.deleteMany({ where: inHospitals });
      await prisma.staffProfile.deleteMany({ where: inHospitals });
      await prisma.patientProfile.deleteMany({ where: inHospitals });
      await prisma.refreshTokenSession.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma.department.deleteMany({ where: inHospitals });
      await prisma.auditLog.deleteMany({ where: inHospitals });
      await prisma.hospital.deleteMany({ where: { id: { in: createdHospitalIds } } });
    });
    await app.close();
  });

  describe("GET /lab-tests", () => {
    it.each(["doctor", "lab", "admin"])("returns only the caller's hospital catalog to %s, with ranges", async (who) => {
      const res = await get("/lab-tests?limit=100", tokens[who]).expect(200);
      const rows = res.body.data as Array<{ id: string; code: string; price: string; referenceRanges: { unit: string }[] }>;
      expect(rows.map((r) => r.id)).toEqual([labTestId]);
      expect(rows[0].price).toBe("450");
      expect(rows[0].referenceRanges[0].unit).toBe("ng/mL");
      expect(res.body.meta.total).toBe(1);
    });

    it("searches by name or code, case-insensitively", async () => {
      expect((await get("/lab-tests?search=ferritin", tokens.doctor).expect(200)).body.data).toHaveLength(1);
      expect((await get(`/lab-tests?search=fer-${suffix}`, tokens.doctor).expect(200)).body.data).toHaveLength(1);
      expect((await get("/lab-tests?search=glucose", tokens.doctor).expect(200)).body.data).toHaveLength(0);
    });

    it.each(["nurse", "receptionist", "pharmacist", "accountant", "patient"])("forbids %s (403)", async (who) => {
      await get("/lab-tests", tokens[who]).expect(403);
    });

    it("rejects unknown query fields and an over-long search (400)", async () => {
      await get("/lab-tests?hospitalId=x", tokens.doctor).expect(400);
      await get(`/lab-tests?search=${"a".repeat(101)}`, tokens.doctor).expect(400);
    });
  });

  describe("GET /users (staff directory)", () => {
    type StaffRow = {
      id: string;
      role: string;
      email: string;
      passwordHash?: string;
      staffProfile: { employeeCode: string; department: { name: string } | null } | null;
      doctorProfile: { id: string; specialization: string } | null;
    };

    it("lists the hospital's staff, doctors included, never patients or other hospitals", async () => {
      const res = await get("/users?limit=100", tokens.admin).expect(200);
      const rows = res.body.data as StaffRow[];
      expect(rows).toHaveLength(8);
      expect(rows.some((r) => r.role === UserRole.PATIENT)).toBe(false);
      expect(rows.some((r) => r.email.includes("other-"))).toBe(false);
      expect(rows.every((r) => !("passwordHash" in r))).toBe(true);
      const doctor = rows.find((r) => r.email.startsWith("doctor-"))!;
      expect(doctor.doctorProfile).toMatchObject({ id: doctorProfileId, specialization: "General Medicine" });
      const nurse = rows.find((r) => r.role === UserRole.NURSE)!;
      expect(nurse.staffProfile).toMatchObject({ employeeCode: `N-${suffix}`, department: { name: "General" } });
    });

    it("filters by role and by every search term", async () => {
      const doctors = (await get("/users?role=DOCTOR", tokens.admin).expect(200)).body.data as StaffRow[];
      expect(doctors.map((r) => r.doctorProfile?.id).sort()).toEqual([doctorProfileId, doctor2ProfileId].sort());
      const hit = (await get("/users?search=dora%20quill", tokens.admin).expect(200)).body.data as StaffRow[];
      expect(hit).toHaveLength(1);
      expect((await get("/users?search=dora%20stone", tokens.admin).expect(200)).body.data).toHaveLength(0);
    });

    it("keeps each admin inside their own hospital", async () => {
      const rows = (await get("/users?limit=100", tokens.otherAdmin).expect(200)).body.data as StaffRow[];
      expect(rows.map((r) => r.email).sort()).toEqual([`other-admin-${suffix}@test.medcore.test`, `other-doctor-${suffix}@test.medcore.test`]);
    });

    it("rejects a patient or unknown role filter (400)", async () => {
      await get("/users?role=PATIENT", tokens.admin).expect(400);
      await get("/users?role=SUPER_ADMIN", tokens.admin).expect(400);
    });

    it.each(["doctor", "nurse", "receptionist", "lab", "pharmacist", "accountant", "patient"])(
      "forbids %s (403)",
      async (who) => {
        await get("/users", tokens[who]).expect(403);
      },
    );
  });

  describe("GET /medical-records/by-appointment/:appointmentId", () => {
    let appointmentId: string;
    let recordId: string;

    beforeAll(async () => {
      const { appt, record } = await createRecord(hospitalId, patientProfileId, doctorProfileId, deptId);
      appointmentId = appt.id;
      recordId = record.id;
    });

    it.each(["doctor", "doctor2", "nurse"])("returns the encounter to %s in the same hospital", async (who) => {
      const res = await get(`/medical-records/by-appointment/${appointmentId}`, tokens[who]).expect(200);
      expect(res.body.data).toMatchObject({ id: recordId, appointmentId, chiefComplaint: "Cough" });
      expect(res.body.data.notesEncrypted).toBeUndefined();
    });

    it("returns the patient their own encounter, and 404 to another patient", async () => {
      await get(`/medical-records/by-appointment/${appointmentId}`, tokens.patient).expect(200);
      await get(`/medical-records/by-appointment/${appointmentId}`, tokens.patient2).expect(404);
    });

    it("is 404 across hospitals, for an appointment without a record, and for an unknown id", async () => {
      await get(`/medical-records/by-appointment/${appointmentId}`, tokens.otherDoctor).expect(404);
      const bare = await createAppointment(hospitalId, patientProfileId, doctorProfileId, deptId, AppointmentStatus.CONFIRMED);
      await get(`/medical-records/by-appointment/${bare.id}`, tokens.doctor).expect(404);
      await get(`/medical-records/by-appointment/${randomUUID()}`, tokens.doctor).expect(404);
    });

    it.each(["receptionist", "lab", "pharmacist", "accountant", "admin"])("forbids %s (403)", async (who) => {
      await get(`/medical-records/by-appointment/${appointmentId}`, tokens[who]).expect(403);
    });
  });

  describe("per-encounter filters on prescriptions and lab orders", () => {
    let recordA: string;
    let recordB: string;
    let recordOfDoctor2: string;

    beforeAll(async () => {
      recordA = (await createRecord(hospitalId, patientProfileId, doctorProfileId, deptId)).record.id;
      recordB = (await createRecord(hospitalId, patient2ProfileId, doctorProfileId, deptId)).record.id;
      recordOfDoctor2 = (await createRecord(hospitalId, patientProfileId, doctor2ProfileId, deptId)).record.id;
      for (const [rec, doc, pat] of [
        [recordA, doctorProfileId, patientProfileId],
        [recordB, doctorProfileId, patient2ProfileId],
        [recordOfDoctor2, doctor2ProfileId, patientProfileId],
      ]) {
        await createPrescription(rec, doc, pat);
        await createLabOrder(rec, doc, pat);
      }
    });

    it.each(["prescriptions", "lab-orders"])("GET /%s?medicalRecordId narrows the doctor's own list", async (path) => {
      const all = (await get(`/${path}?limit=100`, tokens.doctor).expect(200)).body.data as { medicalRecordId?: string }[];
      expect(all.length).toBeGreaterThanOrEqual(2);
      const one = (await get(`/${path}?medicalRecordId=${recordA}`, tokens.doctor).expect(200)).body;
      expect(one.meta.total).toBe(1);
    });

    it.each(["prescriptions", "lab-orders"])("GET /%s?medicalRecordId never widens a doctor's scope", async (path) => {
      const res = await get(`/${path}?medicalRecordId=${recordOfDoctor2}`, tokens.doctor).expect(200);
      expect(res.body.data).toEqual([]);
    });

    it.each(["prescriptions", "lab-orders"])("GET /%s?medicalRecordId stays inside the patient's own rows", async (path) => {
      const res = await get(`/${path}?medicalRecordId=${recordB}`, tokens.patient).expect(200);
      expect(res.body.data).toEqual([]);
      expect((await get(`/${path}?medicalRecordId=${recordA}`, tokens.patient).expect(200)).body.meta.total).toBe(1);
    });

    it.each(["prescriptions", "lab-orders"])("GET /%s?medicalRecordId rejects a non-UUID (400)", async (path) => {
      await get(`/${path}?medicalRecordId=not-a-uuid`, tokens.doctor).expect(400);
    });

    it("the pharmacist queue and lab queue filter by encounter too", async () => {
      expect((await get(`/prescriptions?medicalRecordId=${recordB}`, tokens.pharmacist).expect(200)).body.meta.total).toBe(1);
      expect((await get(`/lab-orders?medicalRecordId=${recordB}`, tokens.lab).expect(200)).body.meta.total).toBe(1);
    });

    it("another hospital's doctor sees nothing for this hospital's encounter", async () => {
      expect((await get(`/prescriptions?medicalRecordId=${recordA}`, tokens.otherDoctor).expect(200)).body.data).toEqual([]);
      expect((await get(`/lab-orders?medicalRecordId=${recordA}`, tokens.otherDoctor).expect(200)).body.data).toEqual([]);
    });
  });

  describe("detail additions for the pharmacy and billing desks", () => {
    it("GET /prescriptions/:id gives each line its dispensed quantity, and staff the patient's name", async () => {
      const { record } = await createRecord(hospitalId, patientProfileId, doctorProfileId, deptId);
      const rx = await createPrescription(record.id, doctorProfileId, patientProfileId);
      const batch = await TenantContext.run({ hospitalId, userId: null, bypassTenancy: false }, () =>
        prisma.medicineBatch.create({
          data: {
            medicineId,
            hospitalId,
            batchNumber: `B-${suffix}`,
            manufacturingDate: new Date("2026-01-01"),
            expiryDate: new Date("2030-01-01"),
            quantityOnHand: 100,
            unitCost: 1,
            mrp: 2,
          },
        }),
      );
      const itemId = (await TenantContext.bypass(() => prisma.prescriptionItem.findFirstOrThrow({ where: { prescriptionId: rx.id } }))).id;
      await request(app.getHttpServer())
        .post(`/api/prescriptions/${rx.id}/dispense`)
        .set("Authorization", `Bearer ${tokens.pharmacist}`)
        .send({ items: [{ prescriptionItemId: itemId, quantity: 4 }] })
        .expect(201);

      const staffView = (await get(`/prescriptions/${rx.id}`, tokens.pharmacist).expect(200)).body.data;
      expect(staffView.status).toBe("PARTIALLY_DISPENSED");
      expect(staffView.items[0]).toMatchObject({ quantityPrescribed: 10, dispensedQuantity: 4 });
      expect(staffView.patient).toEqual({ id: expect.any(String), firstName: "Pat", lastName: "Ient" });
      expect(JSON.stringify(staffView)).not.toContain(batch.id);

      const patientView = (await get(`/prescriptions/${rx.id}`, tokens.patient).expect(200)).body.data;
      expect(patientView.items[0].dispensedQuantity).toBe(4);
      expect(patientView.patient).toBeUndefined();
      await get(`/prescriptions/${rx.id}`, tokens.patient2).expect(404);
    });

    it("GET /invoices/:id names the patient for staff only", async () => {
      const appt = await createAppointment(hospitalId, patientProfileId, doctorProfileId, deptId, AppointmentStatus.CONFIRMED);
      const invoice = (
        await request(app.getHttpServer())
          .post("/api/invoices")
          .set("Authorization", `Bearer ${tokens.receptionist}`)
          .send({ appointmentId: appt.id })
          .expect(201)
      ).body.data;
      await request(app.getHttpServer())
        .post(`/api/invoices/${invoice.id}/items`)
        .set("Authorization", `Bearer ${tokens.receptionist}`)
        .send({ sourceType: "OTHER", description: "Dressing", quantity: 1, unitPrice: 150 })
        .expect(201);
      const staffView = (await get(`/invoices/${invoice.id}`, tokens.accountant).expect(200)).body.data;
      expect(staffView.patient).toEqual({ id: expect.any(String), firstName: "Pat", lastName: "Ient" });
      await get(`/invoices/${invoice.id}`, tokens.patient).expect(404);
      await request(app.getHttpServer())
        .patch(`/api/invoices/${invoice.id}/finalize`)
        .set("Authorization", `Bearer ${tokens.receptionist}`)
        .expect(200);
      const patientView = (await get(`/invoices/${invoice.id}`, tokens.patient).expect(200)).body.data;
      expect(patientView.patient).toBeUndefined();
      expect(patientView.total).toBe("150");
      await get(`/invoices/${invoice.id}`, tokens.otherAdmin).expect(404);
    });
  });

  describe("GET /appointments?patientId", () => {
    let p1Appt: string;
    let p2Appt: string;

    beforeAll(async () => {
      p1Appt = (await createAppointment(hospitalId, patientProfileId, doctor2ProfileId, deptId, AppointmentStatus.PENDING)).id;
      p2Appt = (await createAppointment(hospitalId, patient2ProfileId, doctor2ProfileId, deptId, AppointmentStatus.PENDING)).id;
    });

    it("gives the front desk one patient's visits", async () => {
      const rows = (await get(`/appointments?patientId=${patient2ProfileId}&limit=100`, tokens.receptionist).expect(200)).body
        .data as { id: string; patientId: string }[];
      expect(rows.map((r) => r.id)).toContain(p2Appt);
      expect(rows.every((r) => r.patientId === patient2ProfileId)).toBe(true);
    });

    it("never widens a patient's or a doctor's scope", async () => {
      expect((await get(`/appointments?patientId=${patient2ProfileId}`, tokens.patient).expect(200)).body.data).toEqual([]);
      const own = (await get(`/appointments?patientId=${patientProfileId}&limit=100`, tokens.patient).expect(200)).body.data as { id: string }[];
      expect(own.map((r) => r.id)).toContain(p1Appt);
      const doc = (await get(`/appointments?patientId=${patient2ProfileId}&limit=100`, tokens.doctor).expect(200)).body.data as { id: string }[];
      expect(doc.map((r) => r.id)).not.toContain(p2Appt);
    });

    it("is empty across hospitals and rejects a non-UUID (400)", async () => {
      expect((await get(`/appointments?patientId=${patientProfileId}`, tokens.otherAdmin).expect(200)).body.data).toEqual([]);
      await get("/appointments?patientId=nope", tokens.receptionist).expect(400);
    });
  });

  describe("GET /auth/me doctorProfileId", () => {
    it("is the doctor's own profile id for a doctor, null for everyone else", async () => {
      expect((await get("/auth/me", tokens.doctor).expect(200)).body.data.doctorProfileId).toBe(doctorProfileId);
      expect((await get("/auth/me", tokens.otherDoctor).expect(200)).body.data.doctorProfileId).toBe(otherDoctorProfileId);
      expect((await get("/auth/me", tokens.nurse).expect(200)).body.data.doctorProfileId).toBeNull();
      const me = (await get("/auth/me", tokens.patient).expect(200)).body.data;
      expect(me.doctorProfileId).toBeNull();
      expect(me.patientProfileId).toBe(patientProfileId);
      void otherPatientProfileId;
    });
  });
});
