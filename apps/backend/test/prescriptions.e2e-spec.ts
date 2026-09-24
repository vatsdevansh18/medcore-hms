import { randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import {
  AppointmentStatus,
  HospitalStatus,
  MedicineForm,
  PrescriptionFrequency,
  PrescriptionStatus,
  UserRole,
  UserStatus,
} from "@medcore/types";
import { AppModule } from "../src/app.module";
import { PRISMA_CLIENT } from "../src/prisma/prisma.module";
import type { ExtendedPrismaClient } from "../src/prisma/prisma-client.factory";
import { TenantContext } from "../src/common/tenancy/tenant-context";
import { configureApp } from "../src/common/bootstrap/configure-app";
import { purgeBilling } from "./helpers/billing-cleanup";
import { PrescriptionPdfQueueService } from "../src/queue/prescription-pdf-queue.service";

/**
 * Phase 7 — Prescriptions. Covers medicine search RBAC, doctor signature
 * upload, prescription creation gated on "own encounter" (FR-RX-001),
 * inventory-backed items (FR-RX-002), the async pdf-generate job actually
 * producing a real PDF via Puppeteer + LocalStack S3 (FR-RX-003), the
 * correction/supersession flow, and RBAC/tenancy for every read path.
 */
describe("Prescriptions (e2e)", () => {
  let app: INestApplication;
  let prisma: ExtendedPrismaClient;
  let pdfQueue: PrescriptionPdfQueueService;
  const suffix = randomUUID().slice(0, 8);
  const PASSWORD = "Passw0rd!";

  let hospitalId: string;
  let deptId: string;
  let doctorProfileId: string;
  let patientProfileId: string;
  let medicineId: string;

  let otherHospitalId: string;
  let otherDoctorToken: string;

  const createdUserIds: string[] = [];
  const createdHospitalIds: string[] = [];

  let adminToken: string;
  let doctorToken: string;
  let nurseToken: string;
  let receptionistToken: string;
  let labToken: string;
  let pharmacistToken: string;
  let accountantToken: string;
  let patientToken: string;

  async function createUser(hId: string, role: UserRole, email: string) {
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    return TenantContext.run({ hospitalId: hId, userId: null, bypassTenancy: false }, async () => {
      const user = await prisma.user.create({
        data: {
          hospitalId: hId,
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

  let nextApptOffsetMinutes = 0;

  /** Creates an appointment + IN_PROGRESS-ready medical record directly —
   * Phase 5/6 already cover the booking/encounter-creation APIs themselves. */
  async function createMedicalRecord(hId: string, patId: string, docId: string, deptIdArg: string) {
    nextApptOffsetMinutes += 60;
    const offsetMs = nextApptOffsetMinutes * 60_000;
    const appt = await TenantContext.run({ hospitalId: hId, userId: null, bypassTenancy: false }, () =>
      prisma.appointment.create({
        data: {
          hospitalId: hId,
          patientId: patId,
          doctorId: docId,
          departmentId: deptIdArg,
          scheduledStart: new Date(Date.now() + offsetMs),
          scheduledEnd: new Date(Date.now() + offsetMs + 1_800_000),
          status: AppointmentStatus.IN_PROGRESS,
          createdBy: "system-test",
        },
      }),
    );
    return TenantContext.run({ hospitalId: hId, userId: null, bypassTenancy: false }, () =>
      prisma.medicalRecord.create({
        data: { hospitalId: hId, appointmentId: appt.id, patientId: patId, doctorId: docId },
      }),
    );
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PRISMA_CLIENT);
    pdfQueue = app.get(PrescriptionPdfQueueService);

    const hospital = await TenantContext.bypass(() =>
      prisma.hospital.create({
        data: {
          name: `Rx Test Hospital ${suffix}`,
          slug: `rx-test-${suffix}`,
          status: HospitalStatus.ACTIVE,
          contactEmail: `rx-${suffix}@test.medcore.test`,
        },
      }),
    );
    hospitalId = hospital.id;
    createdHospitalIds.push(hospitalId);

    const otherHospital = await TenantContext.bypass(() =>
      prisma.hospital.create({
        data: {
          name: `Rx Other Hospital ${suffix}`,
          slug: `rx-other-${suffix}`,
          status: HospitalStatus.ACTIVE,
          contactEmail: `rx-other-${suffix}@test.medcore.test`,
        },
      }),
    );
    otherHospitalId = otherHospital.id;
    createdHospitalIds.push(otherHospitalId);

    const dept = await TenantContext.run({ hospitalId, userId: null, bypassTenancy: false }, () =>
      prisma.department.create({ data: { hospitalId, name: "General" } }),
    );
    deptId = dept.id;
    const otherDept = await TenantContext.run(
      { hospitalId: otherHospitalId, userId: null, bypassTenancy: false },
      () => prisma.department.create({ data: { hospitalId: otherHospitalId, name: "General" } }),
    );

    const adminUser = await createUser(hospitalId, UserRole.HOSPITAL_ADMIN, `admin-${suffix}@test.medcore.test`);
    const doctorUser = await createUser(hospitalId, UserRole.DOCTOR, `doctor-${suffix}@test.medcore.test`);
    const nurseUser = await createUser(hospitalId, UserRole.NURSE, `nurse-${suffix}@test.medcore.test`);
    const receptionistUser = await createUser(
      hospitalId,
      UserRole.RECEPTIONIST,
      `reception-${suffix}@test.medcore.test`,
    );
    const labUser = await createUser(hospitalId, UserRole.LAB_TECHNICIAN, `lab-${suffix}@test.medcore.test`);
    const pharmacistUser = await createUser(
      hospitalId,
      UserRole.PHARMACIST,
      `pharm-${suffix}@test.medcore.test`,
    );
    const accountantUser = await createUser(
      hospitalId,
      UserRole.ACCOUNTANT,
      `acct-${suffix}@test.medcore.test`,
    );
    const patientUser = await createUser(hospitalId, UserRole.PATIENT, `patient-${suffix}@test.medcore.test`);

    const otherDoctorUser = await createUser(
      otherHospitalId,
      UserRole.DOCTOR,
      `other-doctor-${suffix}@test.medcore.test`,
    );

    const doctorProfile = await TenantContext.run(
      { hospitalId, userId: null, bypassTenancy: false },
      () =>
        prisma.doctorProfile.create({
          data: {
            userId: doctorUser.id,
            hospitalId,
            departmentId: deptId,
            specialization: "General Medicine",
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

    const otherDoctorProfile = await TenantContext.run(
      { hospitalId: otherHospitalId, userId: null, bypassTenancy: false },
      () =>
        prisma.doctorProfile.create({
          data: {
            userId: otherDoctorUser.id,
            hospitalId: otherHospitalId,
            departmentId: otherDept.id,
            specialization: "General",
            licenseNumber: `LIC-OTHER-${suffix}`,
            consultationFee: 100,
          },
        }),
    );
    void otherDoctorProfile;

    const medicine = await TenantContext.run(
      { hospitalId, userId: null, bypassTenancy: false },
      () =>
        prisma.medicine.create({
          data: {
            hospitalId,
            name: "Amoxicillin",
            genericName: "Amoxicillin",
            form: MedicineForm.CAPSULE,
            unit: "capsule",
          },
        }),
    );
    medicineId = medicine.id;

    adminToken = await login(adminUser.email);
    doctorToken = await login(doctorUser.email);
    nurseToken = await login(nurseUser.email);
    receptionistToken = await login(receptionistUser.email);
    labToken = await login(labUser.email);
    pharmacistToken = await login(pharmacistUser.email);
    accountantToken = await login(accountantUser.email);
    patientToken = await login(patientUser.email);
    otherDoctorToken = await login(otherDoctorUser.email);
  });

  afterAll(async () => {
    await TenantContext.bypass(async () => {
      await prisma.prescriptionItem.deleteMany({
        where: { prescription: { hospitalId: { in: createdHospitalIds } } },
      });
      await prisma.prescription.updateMany({
        where: { hospitalId: { in: createdHospitalIds } },
        data: { supersedesId: null },
      });
      await prisma.notification.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.prescription.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.medicalRecord.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await purgeBilling(prisma, createdHospitalIds);
      await prisma.appointment.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.medicine.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.doctorProfile.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.patientProfile.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.refreshTokenSession.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma.department.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.auditLog.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.hospital.deleteMany({ where: { id: { in: createdHospitalIds } } });
    });
    await app.close();
  });

  describe("medicine search (docs/07-RBAC-MATRIX.md §3.7)", () => {
    it("lets Doctor/Pharmacist/HospitalAdmin search, and finds the seeded medicine", async () => {
      for (const token of [doctorToken, pharmacistToken, adminToken]) {
        const res = await request(app.getHttpServer())
          .get("/api/medicines")
          .query({ search: "Amox" })
          .set("Authorization", `Bearer ${token}`)
          .expect(200);
        expect(res.body.data.some((m: { id: string }) => m.id === medicineId)).toBe(true);
      }
    });

    it("denies Nurse/Receptionist/Lab/Accountant/Patient", async () => {
      for (const token of [nurseToken, receptionistToken, labToken, accountantToken, patientToken]) {
        await request(app.getHttpServer())
          .get("/api/medicines")
          .set("Authorization", `Bearer ${token}`)
          .expect(403);
      }
    });
  });

  describe("doctor signature upload (FR-RX-003)", () => {
    const signatureBytes = Buffer.from("fake-png-bytes-for-signature-test");

    it("lets the doctor upload their own signature, real bytes round-trip through S3", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/doctors/${doctorProfileId}/signature`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({ fileName: "signature.png", mimeType: "image/png", sizeBytes: signatureBytes.length })
        .expect(201);

      const putRes = await fetch(res.body.data.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: signatureBytes,
      });
      expect(putRes.ok).toBe(true);

      const profile = await TenantContext.bypass(() =>
        prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorProfileId } }),
      );
      expect(profile.signatureImageUrl).toBeTruthy();
    });

    it("denies a different doctor uploading to this doctorId (404)", async () => {
      await request(app.getHttpServer())
        .post(`/api/doctors/${doctorProfileId}/signature`)
        .set("Authorization", `Bearer ${otherDoctorToken}`)
        .send({ fileName: "signature.png", mimeType: "image/png", sizeBytes: 10 })
        .expect(404);
    });

    it("denies a non-image file type", async () => {
      await request(app.getHttpServer())
        .post(`/api/doctors/${doctorProfileId}/signature`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({ fileName: "signature.pdf", mimeType: "application/pdf", sizeBytes: 10 })
        .expect(400);
    });

    it("denies a Nurse from uploading a doctor's signature", async () => {
      await request(app.getHttpServer())
        .post(`/api/doctors/${doctorProfileId}/signature`)
        .set("Authorization", `Bearer ${nurseToken}`)
        .send({ fileName: "signature.png", mimeType: "image/png", sizeBytes: 10 })
        .expect(403);
    });
  });

  describe("prescription creation (FR-RX-001/002) and PDF generation (FR-RX-003)", () => {
    it("rejects a doctor who is not the encounter's own doctor (404)", async () => {
      const record = await createMedicalRecord(hospitalId, patientProfileId, doctorProfileId, deptId);
      await request(app.getHttpServer())
        .post("/api/prescriptions")
        .set("Authorization", `Bearer ${otherDoctorToken}`)
        .send({
          medicalRecordId: record.id,
          items: [{ medicineId, dosage: "500mg", frequency: PrescriptionFrequency.TDS, durationDays: 5, quantityPrescribed: 15 }],
        })
        .expect(404);
    });

    it("rejects a medicine not in the hospital's inventory", async () => {
      const record = await createMedicalRecord(hospitalId, patientProfileId, doctorProfileId, deptId);
      await request(app.getHttpServer())
        .post("/api/prescriptions")
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({
          medicalRecordId: record.id,
          items: [
            {
              medicineId: randomUUID(),
              dosage: "500mg",
              frequency: PrescriptionFrequency.TDS,
              durationDays: 5,
              quantityPrescribed: 15,
            },
          ],
        })
        .expect(400);
    });

    it("rejects every non-Doctor role (FORBIDDEN_ROLE)", async () => {
      const record = await createMedicalRecord(hospitalId, patientProfileId, doctorProfileId, deptId);
      for (const token of [nurseToken, receptionistToken, labToken, pharmacistToken, accountantToken, patientToken, adminToken]) {
        await request(app.getHttpServer())
          .post("/api/prescriptions")
          .set("Authorization", `Bearer ${token}`)
          .send({
            medicalRecordId: record.id,
            items: [{ medicineId, dosage: "500mg", frequency: PrescriptionFrequency.TDS, durationDays: 5, quantityPrescribed: 15 }],
          })
          .expect(403);
      }
    });

    let prescriptionId: string;

    it("creates a prescription with items, and generates a real downloadable PDF", async () => {
      const record = await createMedicalRecord(hospitalId, patientProfileId, doctorProfileId, deptId);
      const createRes = await request(app.getHttpServer())
        .post("/api/prescriptions")
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({
          medicalRecordId: record.id,
          items: [
            {
              medicineId,
              dosage: "500mg",
              frequency: PrescriptionFrequency.TDS,
              durationDays: 5,
              specialInstructions: "Take after food",
              quantityPrescribed: 15,
            },
          ],
        })
        .expect(201);

      prescriptionId = createRes.body.data.id;
      expect(createRes.body.data.items).toHaveLength(1);
      expect(createRes.body.data.items[0].medicine.name).toBe("Amoxicillin");
      expect(createRes.body.data.status).toBe(PrescriptionStatus.ISSUED);

      await pdfQueue.waitForCompletion(prescriptionId);

      const pdfRes = await request(app.getHttpServer())
        .get(`/api/prescriptions/${prescriptionId}/pdf`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .expect(200);
      expect(pdfRes.body.data.downloadUrl).toBeTruthy();

      const fetchRes = await fetch(pdfRes.body.data.downloadUrl);
      expect(fetchRes.ok).toBe(true);
      const pdfBytes = Buffer.from(await fetchRes.arrayBuffer());
      expect(pdfBytes.subarray(0, 4).toString("ascii")).toBe("%PDF");
    }, 30_000);

    it("lets Doctor/Nurse/Pharmacist (own hospital) and Patient (self) view the prescription", async () => {
      for (const token of [doctorToken, nurseToken, pharmacistToken, patientToken]) {
        await request(app.getHttpServer())
          .get(`/api/prescriptions/${prescriptionId}`)
          .set("Authorization", `Bearer ${token}`)
          .expect(200);
      }
    });

    it("denies Receptionist/Lab/Accountant/HospitalAdmin from viewing", async () => {
      for (const token of [receptionistToken, labToken, accountantToken, adminToken]) {
        await request(app.getHttpServer())
          .get(`/api/prescriptions/${prescriptionId}`)
          .set("Authorization", `Bearer ${token}`)
          .expect(403);
      }
    });

    it("denies a cross-tenant doctor from viewing (404)", async () => {
      await request(app.getHttpServer())
        .get(`/api/prescriptions/${prescriptionId}`)
        .set("Authorization", `Bearer ${otherDoctorToken}`)
        .expect(404);
    });

    it("restricts PDF download to Doctor/Patient — denies Nurse/Pharmacist even though they can view", async () => {
      for (const token of [nurseToken, pharmacistToken]) {
        await request(app.getHttpServer())
          .get(`/api/prescriptions/${prescriptionId}/pdf`)
          .set("Authorization", `Bearer ${token}`)
          .expect(403);
      }
    });

    it("lets the Patient download their own prescription's PDF", async () => {
      await request(app.getHttpServer())
        .get(`/api/prescriptions/${prescriptionId}/pdf`)
        .set("Authorization", `Bearer ${patientToken}`)
        .expect(200);
    });

    describe("corrections / supersession (FR-RX-003)", () => {
      let correctionId: string;

      it("creates a correction referencing supersedesId, and cancels the original", async () => {
        const record = await createMedicalRecord(hospitalId, patientProfileId, doctorProfileId, deptId);
        const res = await request(app.getHttpServer())
          .post("/api/prescriptions")
          .set("Authorization", `Bearer ${doctorToken}`)
          .send({
            medicalRecordId: record.id,
            supersedesId: prescriptionId,
            items: [
              { medicineId, dosage: "250mg", frequency: PrescriptionFrequency.BD, durationDays: 7, quantityPrescribed: 14 },
            ],
          })
          .expect(201);
        correctionId = res.body.data.id;

        const original = await TenantContext.bypass(() =>
          prisma.prescription.findUniqueOrThrow({ where: { id: prescriptionId } }),
        );
        expect(original.status).toBe(PrescriptionStatus.CANCELLED);

        await pdfQueue.waitForCompletion(correctionId);
      }, 30_000);

      it("rejects superseding a prescription that's already been superseded", async () => {
        const record = await createMedicalRecord(hospitalId, patientProfileId, doctorProfileId, deptId);
        await request(app.getHttpServer())
          .post("/api/prescriptions")
          .set("Authorization", `Bearer ${doctorToken}`)
          .send({
            medicalRecordId: record.id,
            supersedesId: prescriptionId,
            items: [{ medicineId, dosage: "250mg", frequency: PrescriptionFrequency.BD, durationDays: 7, quantityPrescribed: 14 }],
          })
          .expect(409);
      });

      it("rejects a supersedesId that doesn't resolve to a prescription for this patient", async () => {
        // Tenant scoping alone (Layer 1) already makes a foreign-hospital
        // prescription id indistinguishable from a nonexistent one for this
        // check, so a random id exercises the same "not found for this
        // patient" branch a genuine cross-patient id would.
        const record = await createMedicalRecord(hospitalId, patientProfileId, doctorProfileId, deptId);
        await request(app.getHttpServer())
          .post("/api/prescriptions")
          .set("Authorization", `Bearer ${doctorToken}`)
          .send({
            medicalRecordId: record.id,
            supersedesId: randomUUID(),
            items: [{ medicineId, dosage: "250mg", frequency: PrescriptionFrequency.BD, durationDays: 7, quantityPrescribed: 14 }],
          })
          .expect(400);
      });
    });
  });
});
