import { randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import {
  AppointmentStatus,
  FamilyHistoryCondition,
  HospitalStatus,
  UserRole,
  UserStatus,
} from "@medcore/types";
import { AppModule } from "../src/app.module";
import { PRISMA_CLIENT } from "../src/prisma/prisma.module";
import type { ExtendedPrismaClient } from "../src/prisma/prisma-client.factory";
import { TenantContext } from "../src/common/tenancy/tenant-context";
import { configureApp } from "../src/common/bootstrap/configure-app";
import { purgeBilling } from "./helpers/billing-cleanup";

/**
 * Phase 6 — EMR & clinical workflow. Covers encounter creation gated on
 * appointment IN_PROGRESS state (FR-EMR-001), append-only addenda with
 * application-level encryption (FR-EMR-002, D-008), server-computed BMI
 * (FR-EMR-003), patient-level allergy/vaccination/family-history (FR-EMR-005),
 * the full pre-signed-URL attachment round-trip against LocalStack
 * (FR-EMR-006), and the RBAC read restriction that only Doctor/Nurse/self
 * have any clinical-notes access at all (FR-EMR-007).
 */
describe("Medical Records / EMR (e2e)", () => {
  let app: INestApplication;
  let prisma: ExtendedPrismaClient;
  const suffix = randomUUID().slice(0, 8);
  const PASSWORD = "Passw0rd!";

  let hospitalId: string;
  let deptId: string;
  let doctorProfileId: string;
  let patientProfileId: string;

  // A second hospital + doctor/patient pair for cross-tenant negative tests.
  let otherHospitalId: string;
  let otherDoctorToken: string;
  let otherPatientProfileId: string;

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

  /** Creates an appointment directly (Phase 5 already covers the booking
   * API itself) and optionally fast-forwards it to IN_PROGRESS so encounter
   * creation tests don't need to replay the full status lifecycle. */
  // Every test appointment uses the same doctor; the DB exclusion
  // constraint (D-005) rejects overlapping windows for one doctor, so each
  // call gets its own non-overlapping slot.
  let nextApptOffsetMinutes = 0;

  async function createAppointment(
    hId: string,
    patId: string,
    docId: string,
    deptIdArg: string,
    status: AppointmentStatus,
  ) {
    nextApptOffsetMinutes += 60;
    const offsetMs = nextApptOffsetMinutes * 60_000;
    return TenantContext.run({ hospitalId: hId, userId: null, bypassTenancy: false }, () =>
      prisma.appointment.create({
        data: {
          hospitalId: hId,
          patientId: patId,
          doctorId: docId,
          departmentId: deptIdArg,
          scheduledStart: new Date(Date.now() + offsetMs),
          scheduledEnd: new Date(Date.now() + offsetMs + 1_800_000),
          status,
          createdBy: "system-test",
        },
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

    const hospital = await TenantContext.bypass(() =>
      prisma.hospital.create({
        data: {
          name: `EMR Test Hospital ${suffix}`,
          slug: `emr-test-${suffix}`,
          status: HospitalStatus.ACTIVE,
          contactEmail: `emr-${suffix}@test.medcore.test`,
        },
      }),
    );
    hospitalId = hospital.id;
    createdHospitalIds.push(hospitalId);

    const otherHospital = await TenantContext.bypass(() =>
      prisma.hospital.create({
        data: {
          name: `EMR Other Hospital ${suffix}`,
          slug: `emr-other-${suffix}`,
          status: HospitalStatus.ACTIVE,
          contactEmail: `emr-other-${suffix}@test.medcore.test`,
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
    const otherPatientUser = await createUser(
      otherHospitalId,
      UserRole.PATIENT,
      `other-patient-${suffix}@test.medcore.test`,
    );

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
    const otherPatientProfile = await TenantContext.run(
      { hospitalId: otherHospitalId, userId: null, bypassTenancy: false },
      () =>
        prisma.patientProfile.create({
          data: { userId: otherPatientUser.id, hospitalId: otherHospitalId },
        }),
    );
    otherPatientProfileId = otherPatientProfile.id;
    void otherDoctorProfile;

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
      await prisma.attachment.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.vitals.deleteMany({
        where: { medicalRecord: { hospitalId: { in: createdHospitalIds } } },
      });
      await prisma.medicalRecordAddendum.deleteMany({
        where: { medicalRecord: { hospitalId: { in: createdHospitalIds } } },
      });
      await prisma.medicalRecord.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await purgeBilling(prisma, createdHospitalIds);
      await prisma.appointment.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.allergy.deleteMany({ where: { patientId: { in: [patientProfileId, otherPatientProfileId] } } });
      await prisma.vaccinationRecord.deleteMany({
        where: { patientId: { in: [patientProfileId, otherPatientProfileId] } },
      });
      await prisma.familyHistoryFlag.deleteMany({
        where: { patientId: { in: [patientProfileId, otherPatientProfileId] } },
      });
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

  describe("encounter creation (FR-EMR-001)", () => {
    it("rejects creation when the appointment is not IN_PROGRESS", async () => {
      const appt = await createAppointment(
        hospitalId,
        patientProfileId,
        doctorProfileId,
        deptId,
        AppointmentStatus.CONFIRMED,
      );
      await request(app.getHttpServer())
        .post("/api/medical-records")
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({ appointmentId: appt.id, chiefComplaint: "Fever" })
        .expect(400);
    });

    it("rejects a doctor who is not the appointment's own doctor (404, not 403)", async () => {
      const appt = await createAppointment(
        hospitalId,
        patientProfileId,
        doctorProfileId,
        deptId,
        AppointmentStatus.IN_PROGRESS,
      );
      await request(app.getHttpServer())
        .post("/api/medical-records")
        .set("Authorization", `Bearer ${otherDoctorToken}`)
        .send({ appointmentId: appt.id })
        .expect(404);
    });

    it("rejects NURSE and every non-Doctor role (FORBIDDEN_ROLE)", async () => {
      const appt = await createAppointment(
        hospitalId,
        patientProfileId,
        doctorProfileId,
        deptId,
        AppointmentStatus.IN_PROGRESS,
      );
      for (const token of [nurseToken, receptionistToken, labToken, pharmacistToken, accountantToken, patientToken, adminToken]) {
        await request(app.getHttpServer())
          .post("/api/medical-records")
          .set("Authorization", `Bearer ${token}`)
          .send({ appointmentId: appt.id })
          .expect(403);
      }
    });

    let recordId: string;
    let encounterAppointmentId: string;

    it("creates a medical record with diagnosis notes + ICD-10 codes (FR-EMR-004) and encrypted free-text notes", async () => {
      const appt = await createAppointment(
        hospitalId,
        patientProfileId,
        doctorProfileId,
        deptId,
        AppointmentStatus.IN_PROGRESS,
      );
      encounterAppointmentId = appt.id;

      const res = await request(app.getHttpServer())
        .post("/api/medical-records")
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({
          appointmentId: appt.id,
          chiefComplaint: "Persistent cough",
          presentingSymptoms: "Dry cough, mild fever",
          diagnosisNotes: "Likely viral upper respiratory infection",
          confirmedDiagnosisIcd10: ["J06.9"],
          treatmentPlan: "Rest, fluids, follow-up in 1 week",
          notes: "Patient anxious about symptoms; reassured.",
        })
        .expect(201);

      const data = res.body.data;
      expect(data.diagnosisNotes).toBe("Likely viral upper respiratory infection");
      expect(data.confirmedDiagnosisIcd10).toEqual(["J06.9"]);
      expect(data.notes).toBe("Patient anxious about symptoms; reassured.");
      expect(data.notesEncrypted).toBeUndefined();
      recordId = data.id;

      const raw = await TenantContext.bypass(() =>
        prisma.medicalRecord.findUniqueOrThrow({ where: { id: recordId } }),
      );
      expect(raw.notesEncrypted).toBeInstanceOf(Buffer);
      expect(raw.notesEncrypted?.toString("utf8")).not.toContain("anxious");
    });

    it("rejects a second medical record for the same appointment (already exists)", async () => {
      await request(app.getHttpServer())
        .post("/api/medical-records")
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({ appointmentId: encounterAppointmentId })
        .expect(409);
    });

    it("lets Doctor/Nurse read within their own hospital, and Patient read their own", async () => {
      for (const token of [doctorToken, nurseToken, patientToken]) {
        await request(app.getHttpServer())
          .get(`/api/medical-records/by-id/${recordId}`)
          .set("Authorization", `Bearer ${token}`)
          .expect(200);
      }
    });

    it("denies Receptionist/Lab/Pharmacist/Accountant direct read access (FR-EMR-007)", async () => {
      for (const token of [receptionistToken, labToken, pharmacistToken, accountantToken]) {
        await request(app.getHttpServer())
          .get(`/api/medical-records/by-id/${recordId}`)
          .set("Authorization", `Bearer ${token}`)
          .expect(403);
      }
    });

    it("denies cross-tenant read (other hospital's doctor gets 404, not 403)", async () => {
      await request(app.getHttpServer())
        .get(`/api/medical-records/by-id/${recordId}`)
        .set("Authorization", `Bearer ${otherDoctorToken}`)
        .expect(404);
    });

    it("lists the patient's records via GET /medical-records/:patientId, paginated", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/medical-records/${patientProfileId}`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .expect(200);
      expect(res.body.meta).toBeDefined();
      expect(res.body.data.some((r: { id: string }) => r.id === recordId)).toBe(true);
    });

    it("denies a Patient viewing another patient's records (404) — docs/10-TESTING-STRATEGY.md §3 scenario #2", async () => {
      await request(app.getHttpServer())
        .get(`/api/medical-records/${otherPatientProfileId}`)
        .set("Authorization", `Bearer ${patientToken}`)
        .expect(404);
    });

    describe("append-only addenda (FR-EMR-002)", () => {
      it("lets Doctor and Nurse append addenda, accumulating rather than replacing", async () => {
        await request(app.getHttpServer())
          .post(`/api/medical-records/${recordId}/addenda`)
          .set("Authorization", `Bearer ${doctorToken}`)
          .send({ note: "Follow-up call: symptoms improving." })
          .expect(201);

        const res = await request(app.getHttpServer())
          .post(`/api/medical-records/${recordId}/addenda`)
          .set("Authorization", `Bearer ${nurseToken}`)
          .send({ note: "Vitals re-checked at home visit." })
          .expect(201);
        expect(res.body.data.note).toBe("Vitals re-checked at home visit.");

        const readBack = await request(app.getHttpServer())
          .get(`/api/medical-records/by-id/${recordId}`)
          .set("Authorization", `Bearer ${doctorToken}`)
          .expect(200);
        expect(readBack.body.data.addenda.length).toBeGreaterThanOrEqual(2);
      });

      it("stores the addendum body encrypted at rest, not as plaintext", async () => {
        const addendum = await TenantContext.bypass(() =>
          prisma.medicalRecordAddendum.findFirstOrThrow({
            where: { medicalRecordId: recordId },
            orderBy: { createdAt: "asc" },
          }),
        );
        expect(addendum.noteEncrypted).toBeInstanceOf(Buffer);
        expect(addendum.noteEncrypted.toString("utf8")).not.toContain("Follow-up");
      });

      it("denies Patient from adding an addendum", async () => {
        await request(app.getHttpServer())
          .post(`/api/medical-records/${recordId}/addenda`)
          .set("Authorization", `Bearer ${patientToken}`)
          .send({ note: "I feel fine now." })
          .expect(403);
      });
    });

    describe("vitals with server-computed BMI (FR-EMR-003)", () => {
      it("computes BMI from height/weight server-side", async () => {
        const res = await request(app.getHttpServer())
          .post(`/api/medical-records/${recordId}/vitals`)
          .set("Authorization", `Bearer ${nurseToken}`)
          .send({ heightCm: 170, weightKg: 70, bpSystolic: 118, bpDiastolic: 76, pulse: 72, spo2: 98 })
          .expect(201);
        // 70 / (1.70^2) = 24.2
        expect(Number(res.body.data.bmi)).toBeCloseTo(24.2, 1);
      });

      it("rejects a client-supplied bmi field outright (whitelist validation)", async () => {
        await request(app.getHttpServer())
          .post(`/api/medical-records/${recordId}/vitals`)
          .set("Authorization", `Bearer ${nurseToken}`)
          .send({ heightCm: 170, weightKg: 70, bmi: 999 })
          .expect(400);
      });

      it("rejects an out-of-range vital", async () => {
        await request(app.getHttpServer())
          .post(`/api/medical-records/${recordId}/vitals`)
          .set("Authorization", `Bearer ${nurseToken}`)
          .send({ spo2: 150 })
          .expect(400);
      });
    });

    describe("attachments via pre-signed S3 URLs (FR-EMR-006)", () => {
      it("rejects a disallowed file type even with a spoofed extension", async () => {
        await request(app.getHttpServer())
          .post(`/api/medical-records/${recordId}/attachments`)
          .set("Authorization", `Bearer ${doctorToken}`)
          .send({ fileName: "malware.exe", mimeType: "image/png", sizeBytes: 1024 })
          .expect(400);
      });

      it("rejects a file over the 20MB cap", async () => {
        await request(app.getHttpServer())
          .post(`/api/medical-records/${recordId}/attachments`)
          .set("Authorization", `Bearer ${doctorToken}`)
          .send({ fileName: "scan.pdf", mimeType: "application/pdf", sizeBytes: 21 * 1024 * 1024 })
          .expect(400);
      });

      it("denies Patient from uploading an attachment", async () => {
        await request(app.getHttpServer())
          .post(`/api/medical-records/${recordId}/attachments`)
          .set("Authorization", `Bearer ${patientToken}`)
          .send({ fileName: "scan.pdf", mimeType: "application/pdf", sizeBytes: 1024 })
          .expect(403);
      });

      let attachmentId: string;
      const fileBytes = Buffer.from("%PDF-1.4 test clinical scan content", "utf8");

      it("issues a pre-signed upload URL, and the real bytes round-trip through LocalStack S3", async () => {
        const createRes = await request(app.getHttpServer())
          .post(`/api/medical-records/${recordId}/attachments`)
          .set("Authorization", `Bearer ${doctorToken}`)
          .send({ fileName: "chest-xray.pdf", mimeType: "application/pdf", sizeBytes: fileBytes.length })
          .expect(201);

        const { attachment, uploadUrl } = createRes.body.data;
        attachmentId = attachment.id;
        expect(uploadUrl).toContain("chest-xray.pdf");

        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/pdf" },
          body: fileBytes,
        });
        expect(putRes.ok).toBe(true);

        const downloadRes = await request(app.getHttpServer())
          .get(`/api/medical-records/${recordId}/attachments/${attachmentId}/download-url`)
          .set("Authorization", `Bearer ${doctorToken}`)
          .expect(200);

        const getRes = await fetch(downloadRes.body.data.downloadUrl);
        expect(getRes.ok).toBe(true);
        const downloaded = Buffer.from(await getRes.arrayBuffer());
        expect(downloaded.equals(fileBytes)).toBe(true);
      });

      it("lets the Patient fetch a download URL for their own record's attachment", async () => {
        await request(app.getHttpServer())
          .get(`/api/medical-records/${recordId}/attachments/${attachmentId}/download-url`)
          .set("Authorization", `Bearer ${patientToken}`)
          .expect(200);
      });

      it("denies a cross-tenant doctor a download URl for this attachment (404)", async () => {
        await request(app.getHttpServer())
          .get(`/api/medical-records/${recordId}/attachments/${attachmentId}/download-url`)
          .set("Authorization", `Bearer ${otherDoctorToken}`)
          .expect(404);
      });
    });
  });

  describe("patient-level clinical data (FR-EMR-005)", () => {
    it("lets Doctor record an allergy, and Patient reads their own", async () => {
      await request(app.getHttpServer())
        .post(`/api/patients/${patientProfileId}/allergies`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({ allergen: "Penicillin", reaction: "Rash", severity: "Moderate" })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/patients/${patientProfileId}/allergies`)
        .set("Authorization", `Bearer ${patientToken}`)
        .expect(200);
      expect(res.body.data.some((a: { allergen: string }) => a.allergen === "Penicillin")).toBe(true);
    });

    it("denies Patient from creating their own allergy record", async () => {
      await request(app.getHttpServer())
        .post(`/api/patients/${patientProfileId}/allergies`)
        .set("Authorization", `Bearer ${patientToken}`)
        .send({ allergen: "Latex" })
        .expect(403);
    });

    it("denies a cross-tenant doctor from viewing or creating for a patient outside their hospital", async () => {
      await request(app.getHttpServer())
        .get(`/api/patients/${patientProfileId}/allergies`)
        .set("Authorization", `Bearer ${otherDoctorToken}`)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/api/patients/${patientProfileId}/allergies`)
        .set("Authorization", `Bearer ${otherDoctorToken}`)
        .send({ allergen: "Latex" })
        .expect(404);
    });

    it("lets Nurse record a vaccination", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/patients/${patientProfileId}/vaccinations`)
        .set("Authorization", `Bearer ${nurseToken}`)
        .send({ vaccineName: "Tetanus", doseNumber: 1, dateAdministered: "2026-01-15" })
        .expect(201);
      expect(res.body.data.vaccineName).toBe("Tetanus");
    });

    it("accepts a valid family-history condition and rejects an invalid one", async () => {
      await request(app.getHttpServer())
        .post(`/api/patients/${patientProfileId}/family-history`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({ condition: FamilyHistoryCondition.DIABETES, notes: "Maternal grandmother" })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/patients/${patientProfileId}/family-history`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({ condition: "NOT_A_REAL_CONDITION" })
        .expect(400);
    });

    it("denies Receptionist/Lab/Pharmacist/Accountant from reading allergy/vaccination/family-history", async () => {
      for (const token of [receptionistToken, labToken, pharmacistToken, accountantToken]) {
        await request(app.getHttpServer())
          .get(`/api/patients/${patientProfileId}/allergies`)
          .set("Authorization", `Bearer ${token}`)
          .expect(403);
      }
    });
  });
});
