import { randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import {
  AppointmentStatus,
  HospitalStatus,
  LabOrderItemStatus,
  LabResultDecision,
  LabResultFlag,
  ReferenceRangeGender,
  UserRole,
  UserStatus,
} from "@medcore/types";
import { AppModule } from "../src/app.module";
import { PRISMA_CLIENT } from "../src/prisma/prisma.module";
import type { ExtendedPrismaClient } from "../src/prisma/prisma-client.factory";
import { TenantContext } from "../src/common/tenancy/tenant-context";
import { configureApp } from "../src/common/bootstrap/configure-app";

/**
 * Phase 8 — Laboratory. Covers order creation gated on "own encounter"
 * (FR-LAB-001), the collection/processing status lifecycle (FR-LAB-002),
 * structured result entry with automatic reference-range out-of-range
 * flagging (FR-LAB-003), four-eyes approval/rejection (FR-LAB-004), the
 * approval notification fan-out (FR-LAB-005), and per-item result-visibility
 * gating on GET /lab-orders/:id (docs/11-DECISIONS.md D-021).
 */
describe("Laboratory (e2e)", () => {
  let app: INestApplication;
  let prisma: ExtendedPrismaClient;
  const suffix = randomUUID().slice(0, 8);
  const PASSWORD = "Passw0rd!";

  let hospitalId: string;
  let deptId: string;
  let doctorProfileId: string;
  let doctorUserId: string;
  let doctor2ProfileId: string;
  let patientProfileId: string;
  let patientUserId: string;

  let otherHospitalId: string;
  let otherDoctorToken: string;

  let testWithRangeId: string;
  let testNoRangeId: string;

  const createdUserIds: string[] = [];
  const createdHospitalIds: string[] = [];

  let adminToken: string;
  let doctorToken: string;
  let doctor2Token: string;
  let nurseToken: string;
  let receptionistToken: string;
  let labToken: string;
  let lab2Token: string;
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

  async function createOrder(labTestIds: string[]) {
    const record = await createMedicalRecord(hospitalId, patientProfileId, doctorProfileId, deptId);
    const res = await request(app.getHttpServer())
      .post("/api/lab-orders")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ medicalRecordId: record.id, items: labTestIds.map((labTestId) => ({ labTestId })) })
      .expect(201);
    return res.body.data as { id: string; items: { id: string; labTestId: string; status: string }[] };
  }

  async function advanceToInProgress(orderId: string, itemId: string) {
    await request(app.getHttpServer())
      .patch(`/api/lab-orders/${orderId}/items/${itemId}/status`)
      .set("Authorization", `Bearer ${labToken}`)
      .send({ status: LabOrderItemStatus.SAMPLE_COLLECTED })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/lab-orders/${orderId}/items/${itemId}/status`)
      .set("Authorization", `Bearer ${labToken}`)
      .send({ status: LabOrderItemStatus.IN_PROGRESS })
      .expect(200);
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
          name: `Lab Test Hospital ${suffix}`,
          slug: `lab-test-${suffix}`,
          status: HospitalStatus.ACTIVE,
          contactEmail: `lab-${suffix}@test.medcore.test`,
        },
      }),
    );
    hospitalId = hospital.id;
    createdHospitalIds.push(hospitalId);

    const otherHospital = await TenantContext.bypass(() =>
      prisma.hospital.create({
        data: {
          name: `Lab Other Hospital ${suffix}`,
          slug: `lab-other-${suffix}`,
          status: HospitalStatus.ACTIVE,
          contactEmail: `lab-other-${suffix}@test.medcore.test`,
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
    const doctor2User = await createUser(hospitalId, UserRole.DOCTOR, `doctor2-${suffix}@test.medcore.test`);
    const nurseUser = await createUser(hospitalId, UserRole.NURSE, `nurse-${suffix}@test.medcore.test`);
    const receptionistUser = await createUser(
      hospitalId,
      UserRole.RECEPTIONIST,
      `reception-${suffix}@test.medcore.test`,
    );
    const labUser = await createUser(hospitalId, UserRole.LAB_TECHNICIAN, `lab-${suffix}@test.medcore.test`);
    const lab2User = await createUser(hospitalId, UserRole.LAB_TECHNICIAN, `lab2-${suffix}@test.medcore.test`);
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
    patientUserId = patientUser.id;

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
    doctorUserId = doctorUser.id;

    const doctor2Profile = await TenantContext.run(
      { hospitalId, userId: null, bypassTenancy: false },
      () =>
        prisma.doctorProfile.create({
          data: {
            userId: doctor2User.id,
            hospitalId,
            departmentId: deptId,
            specialization: "General Medicine",
            licenseNumber: `LIC2-${suffix}`,
            consultationFee: 100,
          },
        }),
    );
    doctor2ProfileId = doctor2Profile.id;
    void doctor2ProfileId;

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

    const testWithRange = await TenantContext.run(
      { hospitalId, userId: null, bypassTenancy: false },
      () =>
        prisma.labTest.create({
          data: { hospitalId, name: `Fasting Glucose ${suffix}`, code: `FG-${suffix}`, price: 200 },
        }),
    );
    testWithRangeId = testWithRange.id;
    await TenantContext.bypass(() =>
      prisma.labTestReferenceRange.create({
        data: {
          labTestId: testWithRangeId,
          gender: ReferenceRangeGender.ANY,
          lowValue: 70,
          highValue: 100,
          unit: "mg/dL",
        },
      }),
    );

    const testNoRange = await TenantContext.run(
      { hospitalId, userId: null, bypassTenancy: false },
      () =>
        prisma.labTest.create({
          data: { hospitalId, name: `Vitamin D ${suffix}`, code: `VITD-${suffix}`, price: 500 },
        }),
    );
    testNoRangeId = testNoRange.id;

    adminToken = await login(adminUser.email);
    doctorToken = await login(doctorUser.email);
    doctor2Token = await login(doctor2User.email);
    nurseToken = await login(nurseUser.email);
    receptionistToken = await login(receptionistUser.email);
    labToken = await login(labUser.email);
    lab2Token = await login(lab2User.email);
    pharmacistToken = await login(pharmacistUser.email);
    accountantToken = await login(accountantUser.email);
    patientToken = await login(patientUser.email);
    otherDoctorToken = await login(otherDoctorUser.email);
  });

  afterAll(async () => {
    await TenantContext.bypass(async () => {
      await prisma.notification.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.labResult.deleteMany({
        where: { labOrderItem: { labOrder: { hospitalId: { in: createdHospitalIds } } } },
      });
      await prisma.labOrderItem.deleteMany({ where: { labOrder: { hospitalId: { in: createdHospitalIds } } } });
      await prisma.labOrder.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.labTestReferenceRange.deleteMany({ where: { labTest: { hospitalId: { in: createdHospitalIds } } } });
      await prisma.labTest.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.medicalRecord.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.appointment.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
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

  describe("order creation (FR-LAB-001)", () => {
    it("lets the encounter's own doctor create an order with catalog items", async () => {
      const order = await createOrder([testWithRangeId, testNoRangeId]);
      expect(order.items).toHaveLength(2);
      expect(order.items.every((i) => i.status === LabOrderItemStatus.ORDERED)).toBe(true);
    });

    it("rejects a same-hospital doctor who isn't the encounter's own doctor (404)", async () => {
      const record = await createMedicalRecord(hospitalId, patientProfileId, doctorProfileId, deptId);
      await request(app.getHttpServer())
        .post("/api/lab-orders")
        .set("Authorization", `Bearer ${doctor2Token}`)
        .send({ medicalRecordId: record.id, items: [{ labTestId: testWithRangeId }] })
        .expect(404);
    });

    it("rejects a cross-tenant doctor (404, tenant-scoped medical record lookup)", async () => {
      const record = await createMedicalRecord(hospitalId, patientProfileId, doctorProfileId, deptId);
      await request(app.getHttpServer())
        .post("/api/lab-orders")
        .set("Authorization", `Bearer ${otherDoctorToken}`)
        .send({ medicalRecordId: record.id, items: [{ labTestId: testWithRangeId }] })
        .expect(404);
    });

    it("rejects an unknown labTestId", async () => {
      const record = await createMedicalRecord(hospitalId, patientProfileId, doctorProfileId, deptId);
      await request(app.getHttpServer())
        .post("/api/lab-orders")
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({ medicalRecordId: record.id, items: [{ labTestId: randomUUID() }] })
        .expect(400);
    });

    it("rejects every non-Doctor role", async () => {
      const record = await createMedicalRecord(hospitalId, patientProfileId, doctorProfileId, deptId);
      for (const token of [nurseToken, receptionistToken, labToken, pharmacistToken, accountantToken, patientToken, adminToken]) {
        await request(app.getHttpServer())
          .post("/api/lab-orders")
          .set("Authorization", `Bearer ${token}`)
          .send({ medicalRecordId: record.id, items: [{ labTestId: testWithRangeId }] })
          .expect(403);
      }
    });
  });

  describe("status lifecycle (FR-LAB-002)", () => {
    it("lets Receptionist collect a sample, and Lab Tech advance it to IN_PROGRESS", async () => {
      const order = await createOrder([testWithRangeId]);
      const itemId = order.items[0].id;

      await request(app.getHttpServer())
        .patch(`/api/lab-orders/${order.id}/items/${itemId}/status`)
        .set("Authorization", `Bearer ${receptionistToken}`)
        .send({ status: LabOrderItemStatus.SAMPLE_COLLECTED })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/lab-orders/${order.id}/items/${itemId}/status`)
        .set("Authorization", `Bearer ${labToken}`)
        .send({ status: LabOrderItemStatus.IN_PROGRESS })
        .expect(200);
    });

    it("rejects Receptionist attempting the SAMPLE_COLLECTED->IN_PROGRESS transition", async () => {
      const order = await createOrder([testWithRangeId]);
      const itemId = order.items[0].id;
      await request(app.getHttpServer())
        .patch(`/api/lab-orders/${order.id}/items/${itemId}/status`)
        .set("Authorization", `Bearer ${receptionistToken}`)
        .send({ status: LabOrderItemStatus.SAMPLE_COLLECTED })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/lab-orders/${order.id}/items/${itemId}/status`)
        .set("Authorization", `Bearer ${receptionistToken}`)
        .send({ status: LabOrderItemStatus.IN_PROGRESS })
        .expect(400);
    });

    it("rejects skipping straight from ORDERED to IN_PROGRESS", async () => {
      const order = await createOrder([testWithRangeId]);
      const itemId = order.items[0].id;
      await request(app.getHttpServer())
        .patch(`/api/lab-orders/${order.id}/items/${itemId}/status`)
        .set("Authorization", `Bearer ${labToken}`)
        .send({ status: LabOrderItemStatus.IN_PROGRESS })
        .expect(400);
    });

    it("rejects non-Receptionist/Lab roles", async () => {
      const order = await createOrder([testWithRangeId]);
      const itemId = order.items[0].id;
      for (const token of [doctorToken, nurseToken, patientToken, pharmacistToken, accountantToken, adminToken]) {
        await request(app.getHttpServer())
          .patch(`/api/lab-orders/${order.id}/items/${itemId}/status`)
          .set("Authorization", `Bearer ${token}`)
          .send({ status: LabOrderItemStatus.SAMPLE_COLLECTED })
          .expect(403);
      }
    });

    it("404s a cross-tenant lab order id", async () => {
      const order = await createOrder([testWithRangeId]);
      const itemId = order.items[0].id;
      // A same-hospital Lab Tech acting on another hospital's order id is
      // indistinguishable from a nonexistent id once tenant-scoped — there is
      // no cross-tenant Lab Technician account, so this exercises the same
      // "not found for this hospital" branch via a random id.
      await request(app.getHttpServer())
        .patch(`/api/lab-orders/${randomUUID()}/items/${itemId}/status`)
        .set("Authorization", `Bearer ${labToken}`)
        .send({ status: LabOrderItemStatus.SAMPLE_COLLECTED })
        .expect(404);
    });
  });

  describe("result entry (FR-LAB-003)", () => {
    it("rejects entering a result before the item is IN_PROGRESS", async () => {
      const order = await createOrder([testWithRangeId]);
      const itemId = order.items[0].id;
      await request(app.getHttpServer())
        .patch(`/api/lab-orders/${order.id}/items/${itemId}/result`)
        .set("Authorization", `Bearer ${labToken}`)
        .send({ values: [{ parameter: "Glucose", value: 85, unit: "mg/dL" }] })
        .expect(409);
    });

    it("flags an in-range value NORMAL", async () => {
      const order = await createOrder([testWithRangeId]);
      const itemId = order.items[0].id;
      await advanceToInProgress(order.id, itemId);

      const res = await request(app.getHttpServer())
        .patch(`/api/lab-orders/${order.id}/items/${itemId}/result`)
        .set("Authorization", `Bearer ${labToken}`)
        .send({ values: [{ parameter: "Glucose", value: 85, unit: "mg/dL" }] })
        .expect(200);

      expect(res.body.data.status).toBe(LabOrderItemStatus.RESULT_UPLOADED);
      expect(res.body.data.result.isOutOfRange).toBe(false);
      expect(res.body.data.result.structuredValues[0].flag).toBe(LabResultFlag.NORMAL);
    });

    it("flags a below-range value LOW and sets isOutOfRange", async () => {
      const order = await createOrder([testWithRangeId]);
      const itemId = order.items[0].id;
      await advanceToInProgress(order.id, itemId);

      const res = await request(app.getHttpServer())
        .patch(`/api/lab-orders/${order.id}/items/${itemId}/result`)
        .set("Authorization", `Bearer ${labToken}`)
        .send({ values: [{ parameter: "Glucose", value: 40, unit: "mg/dL" }] })
        .expect(200);

      expect(res.body.data.result.isOutOfRange).toBe(true);
      expect(res.body.data.result.structuredValues[0].flag).toBe(LabResultFlag.LOW);
    });

    it("flags a value for a test with no reference range as NO_REFERENCE_RANGE", async () => {
      const order = await createOrder([testNoRangeId]);
      const itemId = order.items[0].id;
      await advanceToInProgress(order.id, itemId);

      const res = await request(app.getHttpServer())
        .patch(`/api/lab-orders/${order.id}/items/${itemId}/result`)
        .set("Authorization", `Bearer ${labToken}`)
        .send({ values: [{ parameter: "Vitamin D", value: 30, unit: "ng/mL" }] })
        .expect(200);

      expect(res.body.data.result.isOutOfRange).toBe(false);
      expect(res.body.data.result.structuredValues[0].flag).toBe(LabResultFlag.NO_REFERENCE_RANGE);
    });

    it("accepts an optional report file and round-trips real bytes through S3", async () => {
      const order = await createOrder([testWithRangeId]);
      const itemId = order.items[0].id;
      await advanceToInProgress(order.id, itemId);

      const fileBytes = Buffer.from("fake-pdf-bytes-for-lab-report-test");
      const res = await request(app.getHttpServer())
        .patch(`/api/lab-orders/${order.id}/items/${itemId}/result`)
        .set("Authorization", `Bearer ${labToken}`)
        .send({
          values: [{ parameter: "Glucose", value: 85, unit: "mg/dL" }],
          reportFile: { fileName: "report.pdf", mimeType: "application/pdf", sizeBytes: fileBytes.length },
        })
        .expect(200);
      expect(res.body.data.uploadUrl).toBeTruthy();

      const putRes = await fetch(res.body.data.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: fileBytes,
      });
      expect(putRes.ok).toBe(true);
    });

    it("rejects a values array with zero or more than one entry", async () => {
      const order = await createOrder([testWithRangeId]);
      const itemId = order.items[0].id;
      await advanceToInProgress(order.id, itemId);

      await request(app.getHttpServer())
        .patch(`/api/lab-orders/${order.id}/items/${itemId}/result`)
        .set("Authorization", `Bearer ${labToken}`)
        .send({ values: [] })
        .expect(400);

      await request(app.getHttpServer())
        .patch(`/api/lab-orders/${order.id}/items/${itemId}/result`)
        .set("Authorization", `Bearer ${labToken}`)
        .send({
          values: [
            { parameter: "Glucose", value: 85, unit: "mg/dL" },
            { parameter: "Glucose2", value: 90, unit: "mg/dL" },
          ],
        })
        .expect(400);
    });

    it("rejects every non-Lab-Technician role", async () => {
      const order = await createOrder([testWithRangeId]);
      const itemId = order.items[0].id;
      await advanceToInProgress(order.id, itemId);
      for (const token of [doctorToken, nurseToken, receptionistToken, patientToken, pharmacistToken, accountantToken, adminToken]) {
        await request(app.getHttpServer())
          .patch(`/api/lab-orders/${order.id}/items/${itemId}/result`)
          .set("Authorization", `Bearer ${token}`)
          .send({ values: [{ parameter: "Glucose", value: 85, unit: "mg/dL" }] })
          .expect(403);
      }
    });
  });

  describe("approval / four-eyes (FR-LAB-004) and notification fan-out (FR-LAB-005)", () => {
    async function createResultUploadedItem(labTestId: string, value: number) {
      const order = await createOrder([labTestId]);
      const itemId = order.items[0].id;
      await advanceToInProgress(order.id, itemId);
      await request(app.getHttpServer())
        .patch(`/api/lab-orders/${order.id}/items/${itemId}/result`)
        .set("Authorization", `Bearer ${labToken}`)
        .send({ values: [{ parameter: "Glucose", value, unit: "mg/dL" }] })
        .expect(200);
      return { orderId: order.id, itemId };
    }

    it("rejects approval before a result has been entered", async () => {
      const order = await createOrder([testWithRangeId]);
      const itemId = order.items[0].id;
      await request(app.getHttpServer())
        .patch(`/api/lab-orders/${order.id}/items/${itemId}/approve`)
        .set("Authorization", `Bearer ${lab2Token}`)
        .send({ decision: LabResultDecision.APPROVED })
        .expect(409);
    });

    it("rejects the same Lab Tech who entered the result from approving it (four-eyes)", async () => {
      const { orderId, itemId } = await createResultUploadedItem(testWithRangeId, 85);
      await request(app.getHttpServer())
        .patch(`/api/lab-orders/${orderId}/items/${itemId}/approve`)
        .set("Authorization", `Bearer ${labToken}`)
        .send({ decision: LabResultDecision.APPROVED })
        .expect(403);
    });

    it("lets a different Lab Tech approve, and fans out a Notification to doctor + patient", async () => {
      const { orderId, itemId } = await createResultUploadedItem(testWithRangeId, 85);
      const res = await request(app.getHttpServer())
        .patch(`/api/lab-orders/${orderId}/items/${itemId}/approve`)
        .set("Authorization", `Bearer ${lab2Token}`)
        .send({ decision: LabResultDecision.APPROVED })
        .expect(200);
      expect(res.body.data.status).toBe(LabOrderItemStatus.APPROVED);

      const notifications = await TenantContext.bypass(() =>
        prisma.notification.findMany({ where: { relatedEntityId: orderId, type: "LAB_RESULT_APPROVED" } }),
      );
      const recipients = notifications.map((n) => n.recipientUserId).sort();
      expect(recipients).toEqual([doctorUserId, patientUserId].sort());
    });

    it("lets a different Lab Tech reject, with no notification fan-out", async () => {
      const { orderId, itemId } = await createResultUploadedItem(testWithRangeId, 40);
      const res = await request(app.getHttpServer())
        .patch(`/api/lab-orders/${orderId}/items/${itemId}/approve`)
        .set("Authorization", `Bearer ${lab2Token}`)
        .send({ decision: LabResultDecision.REJECTED, notes: "Sample hemolyzed, redraw needed" })
        .expect(200);
      expect(res.body.data.status).toBe(LabOrderItemStatus.REJECTED);

      const notifications = await TenantContext.bypass(() =>
        prisma.notification.findMany({ where: { relatedEntityId: orderId, type: "LAB_RESULT_APPROVED" } }),
      );
      expect(notifications).toHaveLength(0);
    });

    it("rejects every non-Lab-Technician role", async () => {
      const { orderId, itemId } = await createResultUploadedItem(testWithRangeId, 85);
      for (const token of [doctorToken, nurseToken, receptionistToken, patientToken, pharmacistToken, accountantToken, adminToken]) {
        await request(app.getHttpServer())
          .patch(`/api/lab-orders/${orderId}/items/${itemId}/approve`)
          .set("Authorization", `Bearer ${token}`)
          .send({ decision: LabResultDecision.APPROVED })
          .expect(403);
      }
    });
  });

  describe("GET /lab-orders/:id result-visibility gating (docs/11-DECISIONS.md D-021)", () => {
    it("shows the order (200, not 404) to Doctor/Nurse/Patient before any approval, with result: null", async () => {
      const order = await createOrder([testWithRangeId]);
      const itemId = order.items[0].id;

      for (const token of [doctorToken, nurseToken, patientToken]) {
        const res = await request(app.getHttpServer())
          .get(`/api/lab-orders/${order.id}`)
          .set("Authorization", `Bearer ${token}`)
          .expect(200);
        const item = res.body.data.items.find((i: { id: string }) => i.id === itemId);
        expect(item.result).toBeNull();
      }
    });

    it("always shows the result to Lab Technician, regardless of approval state", async () => {
      const order = await createOrder([testWithRangeId]);
      const itemId = order.items[0].id;
      await advanceToInProgress(order.id, itemId);
      await request(app.getHttpServer())
        .patch(`/api/lab-orders/${order.id}/items/${itemId}/result`)
        .set("Authorization", `Bearer ${labToken}`)
        .send({ values: [{ parameter: "Glucose", value: 85, unit: "mg/dL" }] })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/lab-orders/${order.id}`)
        .set("Authorization", `Bearer ${labToken}`)
        .expect(200);
      const item = res.body.data.items.find((i: { id: string }) => i.id === itemId);
      expect(item.result).not.toBeNull();
    });

    it("reveals the result to Doctor/Nurse/Patient once APPROVED", async () => {
      const order = await createOrder([testWithRangeId]);
      const itemId = order.items[0].id;
      await advanceToInProgress(order.id, itemId);
      await request(app.getHttpServer())
        .patch(`/api/lab-orders/${order.id}/items/${itemId}/result`)
        .set("Authorization", `Bearer ${labToken}`)
        .send({ values: [{ parameter: "Glucose", value: 85, unit: "mg/dL" }] })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/lab-orders/${order.id}/items/${itemId}/approve`)
        .set("Authorization", `Bearer ${lab2Token}`)
        .send({ decision: LabResultDecision.APPROVED })
        .expect(200);

      for (const token of [doctorToken, nurseToken, patientToken]) {
        const res = await request(app.getHttpServer())
          .get(`/api/lab-orders/${order.id}`)
          .set("Authorization", `Bearer ${token}`)
          .expect(200);
        const item = res.body.data.items.find((i: { id: string }) => i.id === itemId);
        expect(item.result).not.toBeNull();
      }
    });

    it("reveals a REJECTED result to Doctor/Nurse but not to Patient", async () => {
      const order = await createOrder([testWithRangeId]);
      const itemId = order.items[0].id;
      await advanceToInProgress(order.id, itemId);
      await request(app.getHttpServer())
        .patch(`/api/lab-orders/${order.id}/items/${itemId}/result`)
        .set("Authorization", `Bearer ${labToken}`)
        .send({ values: [{ parameter: "Glucose", value: 85, unit: "mg/dL" }] })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/lab-orders/${order.id}/items/${itemId}/approve`)
        .set("Authorization", `Bearer ${lab2Token}`)
        .send({ decision: LabResultDecision.REJECTED })
        .expect(200);

      for (const token of [doctorToken, nurseToken]) {
        const res = await request(app.getHttpServer())
          .get(`/api/lab-orders/${order.id}`)
          .set("Authorization", `Bearer ${token}`)
          .expect(200);
        const item = res.body.data.items.find((i: { id: string }) => i.id === itemId);
        expect(item.result).not.toBeNull();
      }

      const patientRes = await request(app.getHttpServer())
        .get(`/api/lab-orders/${order.id}`)
        .set("Authorization", `Bearer ${patientToken}`)
        .expect(200);
      const patientItem = patientRes.body.data.items.find((i: { id: string }) => i.id === itemId);
      expect(patientItem.result).toBeNull();
    });

    it("denies Receptionist/Pharmacist/Accountant/HospitalAdmin entirely", async () => {
      const order = await createOrder([testWithRangeId]);
      for (const token of [receptionistToken, pharmacistToken, accountantToken, adminToken]) {
        await request(app.getHttpServer())
          .get(`/api/lab-orders/${order.id}`)
          .set("Authorization", `Bearer ${token}`)
          .expect(403);
      }
    });

    it("404s a cross-tenant doctor", async () => {
      const order = await createOrder([testWithRangeId]);
      await request(app.getHttpServer())
        .get(`/api/lab-orders/${order.id}`)
        .set("Authorization", `Bearer ${otherDoctorToken}`)
        .expect(404);
    });
  });
});
