import { randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import {
  AppointmentStatus,
  HospitalStatus,
  MedicineBatchStatus,
  MedicineForm,
  NotificationChannel,
  NotificationType,
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
import { ExpiryScanService } from "../src/medicines/expiry-scan.service";
import { MedicineExpiryScanScheduler } from "../src/queue/medicine-expiry-scan.scheduler";
import { MEDICINE_EXPIRY_SCAN_CRON } from "../src/queue/queue.constants";
import { addDays, hospitalToday, toDateKey } from "../src/medicines/pharmacy-date.util";

/**
 * Phase 9 — Pharmacy. Covers batch-level inventory (FR-PHARM-001), FEFO
 * dispensing (FR-PHARM-002), expired/quarantined-batch rejection including
 * the brief's mandatory "expired medicine cannot be dispensed" scenario
 * (FR-PHARM-003, docs/10-TESTING-STRATEGY.md §3 #5), the low-stock alert's
 * once-per-crossing latch (FR-PHARM-004), and the nightly expiry scan's
 * quarantine + digest (FR-PHARM-003/005), plus every RBAC cell in
 * docs/07-RBAC-MATRIX.md §3.7 and cross-tenant access in both directions.
 */
describe("Pharmacy (e2e)", () => {
  let app: INestApplication;
  let prisma: ExtendedPrismaClient;
  let expiryScan: ExpiryScanService;
  const suffix = randomUUID().slice(0, 8);
  const PASSWORD = "Passw0rd!";
  const TIMEZONE = "Asia/Kolkata";

  let hospitalId: string;
  let otherHospitalId: string;
  let deptId: string;
  let doctorProfileId: string;
  let patientProfileId: string;

  const createdUserIds: string[] = [];
  const createdHospitalIds: string[] = [];

  let adminUserId: string;
  let pharmacistUserId: string;
  let pharmacist2UserId: string;
  let doctorUserId: string;
  let otherPharmacistUserId: string;

  let adminToken: string;
  let doctorToken: string;
  let nurseToken: string;
  let receptionistToken: string;
  let labToken: string;
  let pharmacistToken: string;
  let accountantToken: string;
  let patientToken: string;
  let otherPharmacistToken: string;
  let otherAdminToken: string;

  /** Calendar date `offsetDays` from the hospital's local today, as YYYY-MM-DD. */
  function day(offsetDays: number): string {
    return toDateKey(addDays(hospitalToday(TIMEZONE), offsetDays));
  }

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

  function api() {
    return request(app.getHttpServer());
  }

  let nameCounter = 0;
  async function createMedicine(reorderLevel = 10, token = pharmacistToken) {
    nameCounter += 1;
    const res = await api()
      .post("/api/medicines")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: `Med ${nameCounter} ${suffix}`,
        form: MedicineForm.TABLET,
        unit: "tablet",
        reorderLevel,
      })
      .expect(201);
    return res.body.data as { id: string; name: string; reorderLevel: number };
  }

  let batchCounter = 0;
  async function receiveBatch(medicineId: string, quantity: number, expiryOffsetDays: number) {
    batchCounter += 1;
    const res = await api()
      .post(`/api/medicines/${medicineId}/batches`)
      .set("Authorization", `Bearer ${pharmacistToken}`)
      .send({
        batchNumber: `B${batchCounter}-${suffix}`,
        manufacturingDate: day(-60),
        expiryDate: day(expiryOffsetDays),
        quantity,
        unitCost: 2.5,
        mrp: 4.75,
      })
      .expect(201);
    return res.body.data as {
      id: string;
      batchNumber: string;
      quantityOnHand: number;
      status: string;
    };
  }

  /** Seeds a batch directly — the API (correctly) refuses to receive an
   * already-expired batch, so expired stock can only exist by having
   * expired while on the shelf, which is what this simulates. */
  async function seedBatch(
    hId: string,
    medicineId: string,
    quantity: number,
    expiryOffsetDays: number,
    status: MedicineBatchStatus = MedicineBatchStatus.ACTIVE,
  ) {
    batchCounter += 1;
    return scoped(hId, () =>
      prisma.medicineBatch.create({
        data: {
          hospitalId: hId,
          medicineId,
          batchNumber: `S${batchCounter}-${suffix}`,
          manufacturingDate: new Date(`${day(-400)}T00:00:00.000Z`),
          expiryDate: new Date(`${day(expiryOffsetDays)}T00:00:00.000Z`),
          quantityOnHand: quantity,
          unitCost: 1,
          mrp: 2,
          status,
        },
      }),
    );
  }

  let apptOffsetMinutes = 0;
  async function createPrescription(lines: { medicineId: string; quantity: number }[]) {
    apptOffsetMinutes += 60;
    const start = Date.now() + apptOffsetMinutes * 60_000;
    return scoped(hospitalId, async () => {
      const appt = await prisma.appointment.create({
        data: {
          hospitalId,
          patientId: patientProfileId,
          doctorId: doctorProfileId,
          departmentId: deptId,
          scheduledStart: new Date(start),
          scheduledEnd: new Date(start + 1_800_000),
          status: AppointmentStatus.IN_PROGRESS,
          createdBy: "system-test",
        },
      });
      const record = await prisma.medicalRecord.create({
        data: {
          hospitalId,
          appointmentId: appt.id,
          patientId: patientProfileId,
          doctorId: doctorProfileId,
        },
      });
      return prisma.prescription.create({
        data: {
          hospitalId,
          medicalRecordId: record.id,
          doctorId: doctorProfileId,
          patientId: patientProfileId,
          items: {
            create: lines.map((l) => ({
              medicineId: l.medicineId,
              dosage: "1 tablet",
              frequency: PrescriptionFrequency.BD,
              durationDays: 5,
              quantityPrescribed: l.quantity,
            })),
          },
        },
        include: { items: true },
      });
    });
  }

  function dispense(prescriptionId: string, items: object[], token = pharmacistToken) {
    return api()
      .post(`/api/prescriptions/${prescriptionId}/dispense`)
      .set("Authorization", `Bearer ${token}`)
      .send({ items });
  }

  async function batchState(batchId: string) {
    return TenantContext.bypass(() =>
      prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchId } }),
    );
  }

  async function dispenseRecordCount(prescriptionId: string) {
    return TenantContext.bypass(() =>
      prisma.dispenseRecord.count({ where: { prescriptionItem: { prescriptionId } } }),
    );
  }

  async function lowStockAlerts(medicineId: string) {
    return TenantContext.bypass(() =>
      prisma.notification.findMany({
        where: { type: NotificationType.LOW_STOCK_ALERT, relatedEntityId: medicineId },
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
    expiryScan = app.get(ExpiryScanService);

    const hospital = await TenantContext.bypass(() =>
      prisma.hospital.create({
        data: {
          name: `Pharmacy Test Hospital ${suffix}`,
          slug: `pharm-test-${suffix}`,
          status: HospitalStatus.ACTIVE,
          contactEmail: `pharm-${suffix}@test.medcore.test`,
          timezone: TIMEZONE,
        },
      }),
    );
    hospitalId = hospital.id;
    createdHospitalIds.push(hospitalId);

    const otherHospital = await TenantContext.bypass(() =>
      prisma.hospital.create({
        data: {
          name: `Pharmacy Other Hospital ${suffix}`,
          slug: `pharm-other-${suffix}`,
          status: HospitalStatus.ACTIVE,
          contactEmail: `pharm-other-${suffix}@test.medcore.test`,
          timezone: TIMEZONE,
        },
      }),
    );
    otherHospitalId = otherHospital.id;
    createdHospitalIds.push(otherHospitalId);

    const dept = await scoped(hospitalId, () =>
      prisma.department.create({ data: { hospitalId, name: "General" } }),
    );
    deptId = dept.id;

    const adminUser = await createUser(
      hospitalId,
      UserRole.HOSPITAL_ADMIN,
      `admin-${suffix}@test.medcore.test`,
    );
    const doctorUser = await createUser(
      hospitalId,
      UserRole.DOCTOR,
      `doctor-${suffix}@test.medcore.test`,
    );
    const nurseUser = await createUser(
      hospitalId,
      UserRole.NURSE,
      `nurse-${suffix}@test.medcore.test`,
    );
    const receptionistUser = await createUser(
      hospitalId,
      UserRole.RECEPTIONIST,
      `rec-${suffix}@test.medcore.test`,
    );
    const labUser = await createUser(
      hospitalId,
      UserRole.LAB_TECHNICIAN,
      `lab-${suffix}@test.medcore.test`,
    );
    const pharmacistUser = await createUser(
      hospitalId,
      UserRole.PHARMACIST,
      `pharm-${suffix}@test.medcore.test`,
    );
    const pharmacist2User = await createUser(
      hospitalId,
      UserRole.PHARMACIST,
      `pharm2-${suffix}@test.medcore.test`,
    );
    const accountantUser = await createUser(
      hospitalId,
      UserRole.ACCOUNTANT,
      `acct-${suffix}@test.medcore.test`,
    );
    const patientUser = await createUser(
      hospitalId,
      UserRole.PATIENT,
      `patient-${suffix}@test.medcore.test`,
    );
    const otherPharmacistUser = await createUser(
      otherHospitalId,
      UserRole.PHARMACIST,
      `other-pharm-${suffix}@test.medcore.test`,
    );
    const otherAdminUser = await createUser(
      otherHospitalId,
      UserRole.HOSPITAL_ADMIN,
      `other-admin-${suffix}@test.medcore.test`,
    );
    adminUserId = adminUser.id;
    pharmacistUserId = pharmacistUser.id;
    pharmacist2UserId = pharmacist2User.id;
    doctorUserId = doctorUser.id;
    otherPharmacistUserId = otherPharmacistUser.id;

    const doctorProfile = await scoped(hospitalId, () =>
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
    const patientProfile = await scoped(hospitalId, () =>
      prisma.patientProfile.create({ data: { userId: patientUser.id, hospitalId } }),
    );
    patientProfileId = patientProfile.id;

    adminToken = await login(adminUser.email);
    doctorToken = await login(doctorUser.email);
    nurseToken = await login(nurseUser.email);
    receptionistToken = await login(receptionistUser.email);
    labToken = await login(labUser.email);
    pharmacistToken = await login(pharmacistUser.email);
    accountantToken = await login(accountantUser.email);
    patientToken = await login(patientUser.email);
    otherPharmacistToken = await login(otherPharmacistUser.email);
    otherAdminToken = await login(otherAdminUser.email);
  });

  afterAll(async () => {
    await TenantContext.bypass(async () => {
      const where = { hospitalId: { in: createdHospitalIds } };
      await prisma.notification.deleteMany({ where });
      await prisma.dispenseRecord.deleteMany({ where: { medicineBatch: where } });
      await prisma.prescriptionItem.deleteMany({ where: { prescription: where } });
      await prisma.prescription.deleteMany({ where });
      await prisma.medicineBatch.deleteMany({ where });
      await prisma.medicine.deleteMany({ where });
      await prisma.medicalRecord.deleteMany({ where });
      await purgeBilling(prisma, createdHospitalIds);
      await prisma.appointment.deleteMany({ where });
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

  const nonPharmacistTokens = () => [
    adminToken,
    doctorToken,
    nurseToken,
    receptionistToken,
    labToken,
    accountantToken,
    patientToken,
  ];

  describe("medicine catalog (FR-PHARM-001)", () => {
    it("lets a Pharmacist create a medicine, which starts with zero available stock", async () => {
      const medicine = await createMedicine(15);
      expect(medicine.reorderLevel).toBe(15);
      const res = await api()
        .get(`/api/medicines/${medicine.id}`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .expect(200);
      expect(res.body.data.availableQuantity).toBe(0);
    });

    it("rejects catalog creation by every non-Pharmacist role (403)", async () => {
      for (const token of nonPharmacistTokens()) {
        await api()
          .post("/api/medicines")
          .set("Authorization", `Bearer ${token}`)
          .send({ name: `Nope ${suffix}`, form: MedicineForm.TABLET, unit: "tablet" })
          .expect(403);
      }
    });

    it("validates the catalog payload, including unknown fields and enum values", async () => {
      const base = { name: `V ${suffix}`, form: MedicineForm.TABLET, unit: "tablet" };
      for (const body of [
        { ...base, name: "" },
        { ...base, form: "POWDER" },
        { ...base, reorderLevel: -1 },
        { ...base, reorderLevel: 1.5 },
        { form: MedicineForm.TABLET, unit: "tablet" },
        { ...base, hospitalId: otherHospitalId },
      ]) {
        await api()
          .post("/api/medicines")
          .set("Authorization", `Bearer ${pharmacistToken}`)
          .send(body)
          .expect(400);
      }
    });

    it("lets a Pharmacist update the catalog entry; Hospital Admin's 🟡 access is read-only (403)", async () => {
      const medicine = await createMedicine();
      const res = await api()
        .patch(`/api/medicines/${medicine.id}`)
        .set("Authorization", `Bearer ${pharmacistToken}`)
        .send({ manufacturer: "Acme Pharma", reorderLevel: 25 })
        .expect(200);
      expect(res.body.data.manufacturer).toBe("Acme Pharma");
      expect(res.body.data.reorderLevel).toBe(25);

      await api()
        .patch(`/api/medicines/${medicine.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reorderLevel: 1 })
        .expect(403);
    });

    it("hides another hospital's medicine from every read and write (404, both directions)", async () => {
      const medicine = await createMedicine();
      await api()
        .get(`/api/medicines/${medicine.id}`)
        .set("Authorization", `Bearer ${otherAdminToken}`)
        .expect(404);
      await api()
        .patch(`/api/medicines/${medicine.id}`)
        .set("Authorization", `Bearer ${otherPharmacistToken}`)
        .send({ reorderLevel: 0 })
        .expect(404);

      const theirs = await createMedicine(10, otherPharmacistToken);
      await api()
        .get(`/api/medicines/${theirs.id}`)
        .set("Authorization", `Bearer ${pharmacistToken}`)
        .expect(404);
      const list = await api()
        .get(`/api/medicines?search=${encodeURIComponent(theirs.name)}`)
        .set("Authorization", `Bearer ${pharmacistToken}`)
        .expect(200);
      expect(list.body.data).toHaveLength(0);
    });
  });

  describe("batch inventory (FR-PHARM-001)", () => {
    it("records every batch-level field and reflects it in available stock", async () => {
      const medicine = await createMedicine();
      const batch = await receiveBatch(medicine.id, 40, 200);
      expect(batch.status).toBe(MedicineBatchStatus.ACTIVE);
      const stored = await batchState(batch.id);
      expect(stored.quantityOnHand).toBe(40);
      expect(stored.unitCost.toString()).toBe("2.5");
      expect(stored.mrp.toString()).toBe("4.75");
      expect(toDateKey(stored.expiryDate)).toBe(day(200));
      expect(toDateKey(stored.manufacturingDate)).toBe(day(-60));
      expect(stored.hospitalId).toBe(hospitalId);

      const res = await api()
        .get(`/api/medicines/${medicine.id}`)
        .set("Authorization", `Bearer ${pharmacistToken}`)
        .expect(200);
      expect(res.body.data.availableQuantity).toBe(40);
    });

    it("rejects a duplicate batch number for the same medicine (409)", async () => {
      const medicine = await createMedicine();
      const batch = await receiveBatch(medicine.id, 10, 100);
      await api()
        .post(`/api/medicines/${medicine.id}/batches`)
        .set("Authorization", `Bearer ${pharmacistToken}`)
        .send({
          batchNumber: batch.batchNumber,
          manufacturingDate: day(-10),
          expiryDate: day(300),
          quantity: 5,
          unitCost: 1,
          mrp: 2,
        })
        .expect(409);
    });

    it("refuses to receive already-expired stock (422 MEDICINE_EXPIRED) and invalid dates/amounts (400)", async () => {
      const medicine = await createMedicine();
      const valid = {
        batchNumber: `X-${suffix}`,
        manufacturingDate: day(-30),
        expiryDate: day(100),
        quantity: 5,
        unitCost: 1,
        mrp: 2,
      };
      const url = `/api/medicines/${medicine.id}/batches`;
      const expired = await api()
        .post(url)
        .set("Authorization", `Bearer ${pharmacistToken}`)
        .send({ ...valid, expiryDate: day(-1) })
        .expect(422);
      expect(expired.body.error.code).toBe("MEDICINE_EXPIRED");

      for (const body of [
        { ...valid, expiryDate: day(-40) }, // before manufacturing
        { ...valid, manufacturingDate: day(5) }, // manufactured in the future
        { ...valid, expiryDate: "2027-02-30" }, // impossible date
        { ...valid, expiryDate: "2027-01-01T00:00:00Z" }, // not a plain date
        { ...valid, quantity: 0 },
        { ...valid, quantity: -3 },
        { ...valid, unitCost: 1.234 },
        { ...valid, mrp: -1 },
        { ...valid, batchNumber: "bad batch!" },
        { ...valid, status: MedicineBatchStatus.QUARANTINED },
      ]) {
        await api()
          .post(url)
          .set("Authorization", `Bearer ${pharmacistToken}`)
          .send(body)
          .expect(400);
      }
    });

    it("lets Hospital Admin view batches but not receive them; other roles can do neither", async () => {
      const medicine = await createMedicine();
      await receiveBatch(medicine.id, 10, 100);
      const res = await api()
        .get(`/api/medicines/${medicine.id}/batches`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.data).toHaveLength(1);

      const body = {
        batchNumber: `HA-${suffix}`,
        manufacturingDate: day(-1),
        expiryDate: day(100),
        quantity: 1,
        unitCost: 1,
        mrp: 1,
      };
      for (const token of nonPharmacistTokens()) {
        await api()
          .post(`/api/medicines/${medicine.id}/batches`)
          .set("Authorization", `Bearer ${token}`)
          .send(body)
          .expect(403);
      }
      for (const token of [
        doctorToken,
        nurseToken,
        receptionistToken,
        labToken,
        accountantToken,
        patientToken,
      ]) {
        await api()
          .get(`/api/medicines/${medicine.id}/batches`)
          .set("Authorization", `Bearer ${token}`)
          .expect(403);
      }
    });

    it("blocks cross-tenant batch reads and receipts (404) and writes nothing", async () => {
      const medicine = await createMedicine();
      await api()
        .get(`/api/medicines/${medicine.id}/batches`)
        .set("Authorization", `Bearer ${otherPharmacistToken}`)
        .expect(404);
      await api()
        .post(`/api/medicines/${medicine.id}/batches`)
        .set("Authorization", `Bearer ${otherPharmacistToken}`)
        .send({
          batchNumber: `XT-${suffix}`,
          manufacturingDate: day(-1),
          expiryDate: day(100),
          quantity: 99,
          unitCost: 1,
          mrp: 1,
        })
        .expect(404);
      const count = await TenantContext.bypass(() =>
        prisma.medicineBatch.count({ where: { medicineId: medicine.id } }),
      );
      expect(count).toBe(0);
    });
  });

  describe("FEFO dispensing (FR-PHARM-002)", () => {
    it("consumes the earliest-expiring batch first regardless of receipt order, splitting across batches", async () => {
      const medicine = await createMedicine(0);
      // Received latest-expiring first, so receipt order != expiry order.
      const late = await receiveBatch(medicine.id, 10, 300);
      const early = await receiveBatch(medicine.id, 5, 30);
      const middle = await receiveBatch(medicine.id, 10, 120);
      const rx = await createPrescription([{ medicineId: medicine.id, quantity: 20 }]);
      const itemId = rx.items[0].id;

      const first = await dispense(rx.id, [{ prescriptionItemId: itemId, quantity: 3 }]).expect(
        201,
      );
      expect(first.body.data.status).toBe(PrescriptionStatus.PARTIALLY_DISPENSED);
      expect(first.body.data.items[0].quantityDispensed).toBe(3);
      expect(
        first.body.data.items[0].dispenseRecords.map(
          (r: { medicineBatchId: string }) => r.medicineBatchId,
        ),
      ).toEqual([early.id]);
      expect((await batchState(early.id)).quantityOnHand).toBe(2);

      // 9 more: the 2 left in `early`, then 7 from `middle` — never `late`.
      const second = await dispense(rx.id, [{ prescriptionItemId: itemId, quantity: 9 }]).expect(
        201,
      );
      const records = second.body.data.items[0].dispenseRecords as {
        medicineBatchId: string;
        quantity: number;
      }[];
      expect(records.slice(1).map((r) => [r.medicineBatchId, r.quantity])).toEqual([
        [early.id, 2],
        [middle.id, 7],
      ]);
      const earlyAfter = await batchState(early.id);
      expect(earlyAfter.quantityOnHand).toBe(0);
      expect(earlyAfter.status).toBe(MedicineBatchStatus.DEPLETED);
      expect((await batchState(middle.id)).quantityOnHand).toBe(3);
      expect((await batchState(late.id)).quantityOnHand).toBe(10);

      const last = await dispense(rx.id, [{ prescriptionItemId: itemId, quantity: 8 }]).expect(201);
      expect(last.body.data.status).toBe(PrescriptionStatus.DISPENSED);
      expect(last.body.data.items[0].quantityDispensed).toBe(20);
      expect((await batchState(middle.id)).status).toBe(MedicineBatchStatus.DEPLETED);
      expect((await batchState(late.id)).quantityOnHand).toBe(5);

      // Records the acting pharmacist on every dispense.
      const dispensers = await TenantContext.bypass(() =>
        prisma.dispenseRecord.findMany({
          where: { prescriptionItemId: itemId },
          select: { dispensedBy: true },
        }),
      );
      expect(new Set(dispensers.map((d) => d.dispensedBy))).toEqual(new Set([pharmacistUserId]));

      // SEC-AUDIT-001: stock movements are attributed to the pharmacist in the audit trail.
      const audits = await TenantContext.bypass(() =>
        prisma.auditLog.findMany({
          where: { hospitalId, entityType: "MedicineBatch", entityId: early.id, action: "UPDATE" },
        }),
      );
      expect(audits.length).toBeGreaterThan(0);
      expect(audits.every((a) => a.actorUserId === pharmacistUserId)).toBe(true);
    });

    it("dispenses several medicines in one request and marks a multi-item prescription correctly", async () => {
      const a = await createMedicine(0);
      const b = await createMedicine(0);
      await receiveBatch(a.id, 10, 100);
      await receiveBatch(b.id, 10, 100);
      const rx = await createPrescription([
        { medicineId: a.id, quantity: 4 },
        { medicineId: b.id, quantity: 6 },
      ]);
      const [itemA, itemB] = rx.items;
      const partial = await dispense(rx.id, [{ prescriptionItemId: itemA.id, quantity: 4 }]).expect(
        201,
      );
      expect(partial.body.data.status).toBe(PrescriptionStatus.PARTIALLY_DISPENSED);
      const done = await dispense(rx.id, [{ prescriptionItemId: itemB.id, quantity: 6 }]).expect(
        201,
      );
      expect(done.body.data.status).toBe(PrescriptionStatus.DISPENSED);
    });

    it("accepts an explicit batchId only when it is the FEFO batch", async () => {
      const medicine = await createMedicine(0);
      const early = await receiveBatch(medicine.id, 5, 40);
      const late = await receiveBatch(medicine.id, 5, 400);
      const other = await createMedicine(0);
      const otherBatch = await receiveBatch(other.id, 5, 40);
      const rx = await createPrescription([{ medicineId: medicine.id, quantity: 4 }]);
      const itemId = rx.items[0].id;

      const outOfOrder = await dispense(rx.id, [
        { prescriptionItemId: itemId, quantity: 1, batchId: late.id },
      ]).expect(422);
      expect(outOfOrder.body.error.code).toBe("VALIDATION_ERROR");
      expect(outOfOrder.body.error.details.expectedBatchId).toBe(early.id);

      await dispense(rx.id, [
        { prescriptionItemId: itemId, quantity: 1, batchId: otherBatch.id },
      ]).expect(400);

      await dispense(rx.id, [
        { prescriptionItemId: itemId, quantity: 4, batchId: early.id },
      ]).expect(201);
      expect((await batchState(early.id)).quantityOnHand).toBe(1);
      expect((await batchState(late.id)).quantityOnHand).toBe(5);
    });
  });

  describe("expired / quarantined / exhausted stock (FR-PHARM-003)", () => {
    // docs/10-TESTING-STRATEGY.md §3 mandatory scenario #5 — the Phase 9 extra gate.
    it("rejects dispensing when the only stock is an expired batch: 422 MEDICINE_EXPIRED, nothing written", async () => {
      const medicine = await createMedicine(0);
      // Expired yesterday, still ACTIVE: the nightly scan hasn't run yet.
      const expired = await seedBatch(hospitalId, medicine.id, 50, -1);
      const rx = await createPrescription([{ medicineId: medicine.id, quantity: 5 }]);

      const res = await dispense(rx.id, [
        { prescriptionItemId: rx.items[0].id, quantity: 5 },
      ]).expect(422);
      expect(res.body.error.code).toBe("MEDICINE_EXPIRED");

      expect(await dispenseRecordCount(rx.id)).toBe(0);
      const batch = await batchState(expired.id);
      expect(batch.quantityOnHand).toBe(50);
      expect(batch.status).toBe(MedicineBatchStatus.ACTIVE);
      const after = await TenantContext.bypass(() =>
        prisma.prescription.findUniqueOrThrow({ where: { id: rx.id }, include: { items: true } }),
      );
      expect(after.status).toBe(PrescriptionStatus.ISSUED);
      expect(after.items[0].quantityDispensed).toBe(0);
    });

    it("rejects an explicitly chosen expired batch even when valid stock exists (no silent fallback)", async () => {
      const medicine = await createMedicine(0);
      const expired = await seedBatch(hospitalId, medicine.id, 50, -3);
      const valid = await receiveBatch(medicine.id, 50, 100);
      const rx = await createPrescription([{ medicineId: medicine.id, quantity: 5 }]);

      const res = await dispense(rx.id, [
        { prescriptionItemId: rx.items[0].id, quantity: 5, batchId: expired.id },
      ]).expect(422);
      expect(res.body.error.code).toBe("MEDICINE_EXPIRED");
      expect((await batchState(valid.id)).quantityOnHand).toBe(50);
      expect(await dispenseRecordCount(rx.id)).toBe(0);
    });

    it("skips an expired batch that expires before a valid one during automatic FEFO selection", async () => {
      const medicine = await createMedicine(0);
      const expired = await seedBatch(hospitalId, medicine.id, 50, -2);
      const valid = await receiveBatch(medicine.id, 20, 60);
      const rx = await createPrescription([{ medicineId: medicine.id, quantity: 5 }]);
      const res = await dispense(rx.id, [
        { prescriptionItemId: rx.items[0].id, quantity: 5 },
      ]).expect(201);
      expect(res.body.data.items[0].dispenseRecords[0].medicineBatchId).toBe(valid.id);
      expect((await batchState(expired.id)).quantityOnHand).toBe(50);
    });

    it("rejects a quarantined batch, whether selected automatically or explicitly (422 MEDICINE_EXPIRED)", async () => {
      const medicine = await createMedicine(0);
      // Quarantined but not yet past expiry, e.g. a recall.
      const quarantined = await seedBatch(
        hospitalId,
        medicine.id,
        50,
        90,
        MedicineBatchStatus.QUARANTINED,
      );
      const rx = await createPrescription([{ medicineId: medicine.id, quantity: 5 }]);
      const auto = await dispense(rx.id, [
        { prescriptionItemId: rx.items[0].id, quantity: 5 },
      ]).expect(422);
      expect(auto.body.error.code).toBe("MEDICINE_EXPIRED");
      const explicit = await dispense(rx.id, [
        { prescriptionItemId: rx.items[0].id, quantity: 5, batchId: quarantined.id },
      ]).expect(422);
      expect(explicit.body.error.code).toBe("MEDICINE_EXPIRED");
      expect((await batchState(quarantined.id)).quantityOnHand).toBe(50);
    });

    it("rejects exhausted stock (422 INSUFFICIENT_STOCK) rather than partially filling", async () => {
      const medicine = await createMedicine(0);
      const batch = await receiveBatch(medicine.id, 3, 100);
      const rx = await createPrescription([{ medicineId: medicine.id, quantity: 5 }]);
      const res = await dispense(rx.id, [
        { prescriptionItemId: rx.items[0].id, quantity: 5 },
      ]).expect(422);
      expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
      expect(res.body.error.details).toMatchObject({ available: 3, requested: 5 });
      expect((await batchState(batch.id)).quantityOnHand).toBe(3);

      // A depleted batch named explicitly is exhausted, not expired.
      const depleted = await seedBatch(
        hospitalId,
        medicine.id,
        0,
        50,
        MedicineBatchStatus.DEPLETED,
      );
      const named = await dispense(rx.id, [
        { prescriptionItemId: rx.items[0].id, quantity: 1, batchId: depleted.id },
      ]).expect(422);
      expect(named.body.error.code).toBe("INSUFFICIENT_STOCK");
    });

    it("is atomic across lines: one failing line leaves every other line undispensed", async () => {
      const ok = await createMedicine(0);
      const short = await createMedicine(0);
      const okBatch = await receiveBatch(ok.id, 10, 100);
      await receiveBatch(short.id, 1, 100);
      const rx = await createPrescription([
        { medicineId: ok.id, quantity: 5 },
        { medicineId: short.id, quantity: 5 },
      ]);
      await dispense(rx.id, [
        { prescriptionItemId: rx.items[0].id, quantity: 5 },
        { prescriptionItemId: rx.items[1].id, quantity: 5 },
      ]).expect(422);
      expect((await batchState(okBatch.id)).quantityOnHand).toBe(10);
      expect(await dispenseRecordCount(rx.id)).toBe(0);
    });
  });

  describe("dispense request validation and prescription state", () => {
    it("rejects over-dispensing, duplicate lines, foreign items, and malformed bodies", async () => {
      const medicine = await createMedicine(0);
      await receiveBatch(medicine.id, 100, 100);
      const rx = await createPrescription([{ medicineId: medicine.id, quantity: 5 }]);
      const otherRx = await createPrescription([{ medicineId: medicine.id, quantity: 5 }]);
      const itemId = rx.items[0].id;

      await dispense(rx.id, [{ prescriptionItemId: itemId, quantity: 6 }]).expect(400);
      await dispense(rx.id, [
        { prescriptionItemId: itemId, quantity: 1 },
        { prescriptionItemId: itemId, quantity: 1 },
      ]).expect(400);
      await dispense(rx.id, [{ prescriptionItemId: otherRx.items[0].id, quantity: 1 }]).expect(400);
      await dispense(rx.id, []).expect(400);
      await dispense(rx.id, [{ prescriptionItemId: itemId, quantity: 0 }]).expect(400);
      await dispense(rx.id, [
        { prescriptionItemId: itemId, quantity: 1, dispensedBy: doctorUserId },
      ]).expect(400);
      await dispense(rx.id, [{ prescriptionItemId: "not-a-uuid", quantity: 1 }]).expect(400);
      await dispense(randomUUID(), [{ prescriptionItemId: itemId, quantity: 1 }]).expect(404);

      await dispense(rx.id, [{ prescriptionItemId: itemId, quantity: 3 }]).expect(201);
      // Only 2 remain outstanding now.
      await dispense(rx.id, [{ prescriptionItemId: itemId, quantity: 3 }]).expect(400);
      await dispense(rx.id, [{ prescriptionItemId: itemId, quantity: 2 }]).expect(201);
      // Fully dispensed.
      await dispense(rx.id, [{ prescriptionItemId: itemId, quantity: 1 }]).expect(409);
    });

    it("refuses to dispense a CANCELLED (e.g. superseded) prescription (409)", async () => {
      const medicine = await createMedicine(0);
      await receiveBatch(medicine.id, 10, 100);
      const rx = await createPrescription([{ medicineId: medicine.id, quantity: 2 }]);
      await scoped(hospitalId, () =>
        prisma.prescription.update({
          where: { id: rx.id },
          data: { status: PrescriptionStatus.CANCELLED },
        }),
      );
      await dispense(rx.id, [{ prescriptionItemId: rx.items[0].id, quantity: 1 }]).expect(409);
    });

    it("allows only Pharmacists to dispense (403 for every other role)", async () => {
      const medicine = await createMedicine(0);
      const batch = await receiveBatch(medicine.id, 10, 100);
      const rx = await createPrescription([{ medicineId: medicine.id, quantity: 2 }]);
      for (const token of nonPharmacistTokens()) {
        await dispense(rx.id, [{ prescriptionItemId: rx.items[0].id, quantity: 1 }], token).expect(
          403,
        );
      }
      expect((await batchState(batch.id)).quantityOnHand).toBe(10);
    });

    it("denies Super Admin every pharmacy endpoint (no @BypassTenantScope on any of them)", async () => {
      const sa = await TenantContext.bypass(async () => {
        const user = await prisma.user.create({
          data: {
            email: `sa-${suffix}@test.medcore.test`,
            passwordHash: await bcrypt.hash(PASSWORD, 4),
            firstName: "Super",
            lastName: "Admin",
            role: UserRole.SUPER_ADMIN,
            status: UserStatus.ACTIVE,
            emailVerifiedAt: new Date(),
          },
        });
        createdUserIds.push(user.id);
        return user;
      });
      const saToken = await login(sa.email);
      const medicine = await createMedicine(0);
      const rx = await createPrescription([{ medicineId: medicine.id, quantity: 1 }]);
      await api()
        .post("/api/medicines")
        .set("Authorization", `Bearer ${saToken}`)
        .send({ name: "x", form: MedicineForm.TABLET, unit: "t" })
        .expect(403);
      await api()
        .get("/api/medicines/low-stock")
        .set("Authorization", `Bearer ${saToken}`)
        .expect(403);
      await api()
        .get(`/api/medicines/${medicine.id}/batches`)
        .set("Authorization", `Bearer ${saToken}`)
        .expect(403);
      await dispense(rx.id, [{ prescriptionItemId: rx.items[0].id, quantity: 1 }], saToken).expect(
        403,
      );
    });

    it("hides a prescription from another hospital's Pharmacist (404) and changes nothing", async () => {
      const medicine = await createMedicine(0);
      const batch = await receiveBatch(medicine.id, 10, 100);
      const rx = await createPrescription([{ medicineId: medicine.id, quantity: 2 }]);
      await dispense(
        rx.id,
        [{ prescriptionItemId: rx.items[0].id, quantity: 1 }],
        otherPharmacistToken,
      ).expect(404);
      expect((await batchState(batch.id)).quantityOnHand).toBe(10);
      expect(await dispenseRecordCount(rx.id)).toBe(0);
    });
  });

  describe("concurrency", () => {
    it("never oversells: two concurrent dispenses for the last units — exactly one succeeds", async () => {
      const medicine = await createMedicine(0);
      const batch = await receiveBatch(medicine.id, 5, 100);
      const rx1 = await createPrescription([{ medicineId: medicine.id, quantity: 5 }]);
      const rx2 = await createPrescription([{ medicineId: medicine.id, quantity: 5 }]);

      const results = await Promise.all([
        dispense(rx1.id, [{ prescriptionItemId: rx1.items[0].id, quantity: 5 }]),
        dispense(rx2.id, [{ prescriptionItemId: rx2.items[0].id, quantity: 5 }]),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 422]);
      expect(results.find((r) => r.status === 422)!.body.error.code).toBe("INSUFFICIENT_STOCK");
      const after = await batchState(batch.id);
      expect(after.quantityOnHand).toBe(0);
      expect(after.status).toBe(MedicineBatchStatus.DEPLETED);
    });

    it("never over-dispenses one prescription under concurrent requests", async () => {
      const medicine = await createMedicine(0);
      const batch = await receiveBatch(medicine.id, 50, 100);
      const rx = await createPrescription([{ medicineId: medicine.id, quantity: 4 }]);
      const results = await Promise.all(
        [1, 2, 3].map(() => dispense(rx.id, [{ prescriptionItemId: rx.items[0].id, quantity: 4 }])),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(
        results.filter((r) => r.status !== 201).every((r) => r.status === 409 || r.status === 400),
      ).toBe(true);
      expect((await batchState(batch.id)).quantityOnHand).toBe(46);
      expect(await dispenseRecordCount(rx.id)).toBe(1);
    });
  });

  describe("low-stock alerts (FR-PHARM-004)", () => {
    it("fires exactly once per crossing, to Pharmacists and the Hospital Admin only", async () => {
      const medicine = await createMedicine(10);
      await receiveBatch(medicine.id, 15, 100);
      // Creating a zero-stock medicine and stocking it is not a crossing.
      expect(await lowStockAlerts(medicine.id)).toHaveLength(0);

      const rx = await createPrescription([{ medicineId: medicine.id, quantity: 40 }]);
      const itemId = rx.items[0].id;

      await dispense(rx.id, [{ prescriptionItemId: itemId, quantity: 3 }]).expect(201); // 12, still >= 10
      expect(await lowStockAlerts(medicine.id)).toHaveLength(0);

      await dispense(rx.id, [{ prescriptionItemId: itemId, quantity: 4 }]).expect(201); // 8, crosses
      const first = await lowStockAlerts(medicine.id);
      expect(first.map((n) => n.recipientUserId).sort()).toEqual(
        [adminUserId, pharmacistUserId, pharmacist2UserId].sort(),
      );
      expect(first.every((n) => n.hospitalId === hospitalId)).toBe(true);
      // Brief §7.8 trigger table: "Low stock alert (staff only) — Email + In-app" (Phase 11).
      expect(first[0].channels).toEqual([NotificationChannel.EMAIL, NotificationChannel.IN_APP]);

      // Further drops and repeated reads while still low: no new alerts.
      await dispense(rx.id, [{ prescriptionItemId: itemId, quantity: 1 }]).expect(201); // 7
      for (let i = 0; i < 3; i += 1) {
        const list = await api()
          .get("/api/medicines/low-stock?limit=100")
          .set("Authorization", `Bearer ${pharmacistToken}`)
          .expect(200);
        const row = (list.body.data as { id: string; availableQuantity: number }[]).find(
          (m) => m.id === medicine.id,
        );
        expect(row?.availableQuantity).toBe(7);
      }
      expect(await lowStockAlerts(medicine.id)).toHaveLength(3);

      // Restocking above the level re-arms the latch; the next crossing alerts again.
      await receiveBatch(medicine.id, 10, 150); // 17
      await dispense(rx.id, [{ prescriptionItemId: itemId, quantity: 5 }]).expect(201); // 12
      expect(await lowStockAlerts(medicine.id)).toHaveLength(3);
      await dispense(rx.id, [{ prescriptionItemId: itemId, quantity: 5 }]).expect(201); // 7, crosses again
      expect(await lowStockAlerts(medicine.id)).toHaveLength(6);
    });

    it("treats raising the reorder level above current stock as a crossing", async () => {
      const medicine = await createMedicine(5);
      await receiveBatch(medicine.id, 20, 100);
      await api()
        .patch(`/api/medicines/${medicine.id}`)
        .set("Authorization", `Bearer ${pharmacistToken}`)
        .send({ reorderLevel: 50 })
        .expect(200);
      expect(await lowStockAlerts(medicine.id)).toHaveLength(3);
      // An unrelated edit while still low doesn't re-alert.
      await api()
        .patch(`/api/medicines/${medicine.id}`)
        .set("Authorization", `Bearer ${pharmacistToken}`)
        .send({ manufacturer: "Other" })
        .expect(200);
      expect(await lowStockAlerts(medicine.id)).toHaveLength(3);
    });

    it("excludes expired stock from the low-stock figure and scopes the list per hospital", async () => {
      const medicine = await createMedicine(10);
      await receiveBatch(medicine.id, 5, 100);
      await seedBatch(hospitalId, medicine.id, 100, -1); // expired, doesn't count
      const res = await api()
        .get("/api/medicines/low-stock?limit=100")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const row = (res.body.data as { id: string; availableQuantity: number }[]).find(
        (m) => m.id === medicine.id,
      );
      expect(row?.availableQuantity).toBe(5);

      const other = await api()
        .get("/api/medicines/low-stock?limit=100")
        .set("Authorization", `Bearer ${otherAdminToken}`)
        .expect(200);
      expect((other.body.data as { id: string }[]).some((m) => m.id === medicine.id)).toBe(false);
      const otherAlerts = await TenantContext.bypass(() =>
        prisma.notification.count({
          where: { recipientUserId: otherPharmacistUserId, type: NotificationType.LOW_STOCK_ALERT },
        }),
      );
      expect(otherAlerts).toBe(0);
    });

    it("restricts the low-stock and expiring views to Pharmacist and Hospital Admin", async () => {
      for (const token of [
        doctorToken,
        nurseToken,
        receptionistToken,
        labToken,
        accountantToken,
        patientToken,
      ]) {
        await api()
          .get("/api/medicines/low-stock")
          .set("Authorization", `Bearer ${token}`)
          .expect(403);
        await api()
          .get("/api/medicines/expiring")
          .set("Authorization", `Bearer ${token}`)
          .expect(403);
      }
      await api()
        .get("/api/medicines/expiring")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      await api()
        .get("/api/medicines/expiring?days=400")
        .set("Authorization", `Bearer ${pharmacistToken}`)
        .expect(400);
      await api()
        .get("/api/medicines/low-stock?limit=500")
        .set("Authorization", `Bearer ${pharmacistToken}`)
        .expect(400);
    });
  });

  describe("nightly expiry scan: quarantine + digest (FR-PHARM-003/005)", () => {
    it("is registered as a nightly BullMQ job scheduler", async () => {
      const schedule = await app.get(MedicineExpiryScanScheduler).getSchedule();
      expect(schedule?.pattern).toBe(MEDICINE_EXPIRY_SCAN_CRON);
    });

    it("quarantines expired batches, alerts on the resulting crossing, and sends one digest per day", async () => {
      const medicine = await createMedicine(10);
      await receiveBatch(medicine.id, 4, 20); // expiring soon, in the digest
      const expired = await seedBatch(hospitalId, medicine.id, 30, -1); // expired on the shelf, not yet quarantined
      await receiveBatch(medicine.id, 30, 300); // far future, not in the digest
      const depleted = await seedBatch(
        hospitalId,
        medicine.id,
        0,
        -5,
        MedicineBatchStatus.DEPLETED,
      );

      // Other hospital's expired batch must not be touched by this hospital's scan.
      const theirMedicine = await createMedicine(0, otherPharmacistToken);
      const theirExpired = await seedBatch(otherHospitalId, theirMedicine.id, 10, -1);

      const [result] = await expiryScan.runScan(new Date(), [hospitalId]);
      expect(result.scanDate).toBe(day(0));
      expect(result.quarantinedBatchIds).toEqual(expect.arrayContaining([expired.id]));
      expect((await batchState(expired.id)).status).toBe(MedicineBatchStatus.QUARANTINED);
      expect((await batchState(expired.id)).quantityOnHand).toBe(30);
      expect((await batchState(depleted.id)).status).toBe(MedicineBatchStatus.DEPLETED);
      const quarantineAudit = await TenantContext.bypass(() =>
        prisma.auditLog.findFirst({
          where: { entityType: "MedicineBatch", entityId: expired.id, action: "UPDATE" },
        }),
      );
      expect(quarantineAudit?.hospitalId).toBe(hospitalId);
      expect(quarantineAudit?.actorUserId).toBeNull(); // system job
      expect((await batchState(theirExpired.id)).status).toBe(MedicineBatchStatus.ACTIVE);

      const digests = await TenantContext.bypass(() =>
        prisma.notification.findMany({
          where: {
            hospitalId,
            type: NotificationType.MEDICINE_EXPIRY_DIGEST,
            relatedEntityId: day(0),
          },
        }),
      );
      expect(digests.map((d) => d.recipientUserId).sort()).toEqual(
        [adminUserId, pharmacistUserId, pharmacist2UserId].sort(),
      );
      expect(digests[0].channels).toEqual([NotificationChannel.EMAIL, NotificationChannel.IN_APP]);
      expect(digests[0].body).toContain(medicine.name);

      // Same-day re-run: idempotent — nothing new quarantined, no duplicate digest.
      const [again] = await expiryScan.runScan(new Date(), [hospitalId]);
      expect(again.quarantinedBatchIds).toHaveLength(0);
      expect(again.digestNotificationsCreated).toBe(0);

      // The other hospital's own scan quarantines its batch.
      const [theirs] = await expiryScan.runScan(new Date(), [otherHospitalId]);
      expect(theirs.quarantinedBatchIds).toEqual([theirExpired.id]);
      const theirDigests = await TenantContext.bypass(() =>
        prisma.notification.findMany({
          where: { hospitalId: otherHospitalId, type: NotificationType.MEDICINE_EXPIRY_DIGEST },
        }),
      );
      expect(theirDigests.every((d) => d.body.includes(medicine.name) === false)).toBe(true);
    });

    it("raises a low-stock alert when quarantining expired stock is the crossing", async () => {
      const medicine = await createMedicine(10);
      await receiveBatch(medicine.id, 6, 100);
      // Stock was 26 before this batch expired; the latch was cleared on receipt.
      await receiveBatch(medicine.id, 20, 1);
      await scoped(hospitalId, async () => {
        const batches = await prisma.medicineBatch.findMany({ where: { medicineId: medicine.id } });
        const soon = batches.find((b) => b.quantityOnHand === 20)!;
        await prisma.medicineBatch.update({
          where: { id: soon.id },
          data: { expiryDate: new Date(`${day(-1)}T00:00:00.000Z`) },
        });
      });
      expect(await lowStockAlerts(medicine.id)).toHaveLength(0);
      const [result] = await expiryScan.runScan(new Date(), [hospitalId]);
      expect(result.lowStockAlertedMedicineIds).toContain(medicine.id);
      expect(await lowStockAlerts(medicine.id)).toHaveLength(3);
    });

    it("lists expiring batches in the requested window, soonest first", async () => {
      const medicine = await createMedicine(0);
      const soon = await receiveBatch(medicine.id, 5, 7);
      const later = await receiveBatch(medicine.id, 5, 25);
      const far = await receiveBatch(medicine.id, 5, 200);
      const res = await api()
        .get("/api/medicines/expiring?days=30&limit=100")
        .set("Authorization", `Bearer ${pharmacistToken}`)
        .expect(200);
      const ids = (res.body.data as { id: string }[]).map((b) => b.id);
      expect(ids.indexOf(soon.id)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(later.id)).toBeGreaterThan(ids.indexOf(soon.id));
      expect(ids).not.toContain(far.id);
    });
  });
});
