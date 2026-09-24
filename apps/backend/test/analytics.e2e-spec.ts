import { randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import {
  AppointmentStatus,
  BedStatus,
  HospitalStatus,
  InvoiceStatus,
  LabOrderItemStatus,
  LabOrderPriority,
  MedicineForm,
  PaymentMethod,
  PaymentStatus,
  PrescriptionFrequency,
  PrescriptionStatus,
  RoomType,
  UserRole,
  UserStatus,
} from "@medcore/types";
import { AppModule } from "../src/app.module";
import { PRISMA_CLIENT } from "../src/prisma/prisma.module";
import type { ExtendedPrismaClient } from "../src/prisma/prisma-client.factory";
import { TenantContext } from "../src/common/tenancy/tenant-context";
import { configureApp } from "../src/common/bootstrap/configure-app";
import { localDateKey, zonedWallTimeToUtc } from "../src/common/time/zoned-time";
import { purgeBilling } from "./helpers/billing-cleanup";

/**
 * Phase 13 — Analytics, dashboards & search (FR-ANALYTICS-001,
 * FR-SEARCH-001, D-040). Fixture data is dated March 2019 so the platform
 * view's numbers aren't disturbed by anything else in the database, and it's
 * written straight to the tables with exact amounts, so every figure below
 * is checked for its exact value. Hospital A is Asia/Kolkata (UTC+05:30),
 * hospital B is UTC: rows near midnight land on different days in each.
 */
describe("Analytics & search (e2e)", () => {
  let app: INestApplication;
  let prisma: ExtendedPrismaClient;
  const suffix = randomUUID().slice(0, 8);
  const PASSWORD = "Passw0rd!";
  const TZ_A = "Asia/Kolkata";

  let hospitalA: string;
  let hospitalB: string;
  const createdHospitalIds: string[] = [];
  const createdUserIds: string[] = [];
  const t: Record<string, string> = {};

  let doctorA1: string;
  let doctorA2: string;
  let patientA1: string;
  let patientA2: string;
  let patientB: string;
  let deptA: string;
  let invoice1: string;
  let invoice2: string;
  let orderRoutine: string;
  let orderUrgent: string;
  let rxIssued: string;
  let rxDispensed: string;

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const scoped = <T>(hId: string, fn: () => Promise<T>) =>
    TenantContext.run({ hospitalId: hId, userId: null, bypassTenancy: false }, fn);
  const ist = (iso: string) => new Date(`${iso}+05:30`);

  async function user(hId: string | null, role: UserRole, key: string, extra: Partial<{ firstName: string; lastName: string; status: UserStatus }> = {}) {
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const create = () =>
      prisma.user.create({
        data: {
          hospitalId: hId,
          email: `${key}-${suffix}@analytics.test.medcore.test`,
          passwordHash,
          firstName: extra.firstName ?? "Ana",
          lastName: extra.lastName ?? key,
          role,
          status: extra.status ?? UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
    const row = hId ? await scoped(hId, create) : await TenantContext.bypass(create);
    createdUserIds.push(row.id);
    return row;
  }

  async function login(key: string) {
    const res = await api()
      .post("/api/auth/login")
      .send({ email: `${key}-${suffix}@analytics.test.medcore.test`, password: PASSWORD })
      .expect(200);
    t[key] = res.body.data.accessToken;
  }

  async function appointment(hId: string, doctorId: string, patientId: string, start: Date, status: AppointmentStatus) {
    const doctor = await TenantContext.bypass(() => prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } }));
    return scoped(hId, () =>
      prisma.appointment.create({
        data: {
          hospitalId: hId,
          doctorId,
          patientId,
          departmentId: doctor.departmentId,
          scheduledStart: start,
          scheduledEnd: new Date(start.getTime() + 30 * 60_000),
          status,
          createdBy: "analytics-test",
        },
      }),
    );
  }

  /** A single-line invoice with a consistent total, finalized (or not) at `finalizedAt`. */
  async function invoice(hId: string, appointmentId: string, patientId: string, total: number, status: InvoiceStatus, finalizedAt: Date | null) {
    const created = await scoped(hId, () =>
      prisma.invoice.create({
        data: {
          hospitalId: hId,
          appointmentId,
          patientId,
          subtotal: total,
          total,
          items: { create: [{ sourceType: "OTHER", description: "Fixture line", quantity: 1, unitPrice: total, lineTotal: total }] },
        },
      }),
    );
    if (status !== InvoiceStatus.DRAFT) {
      await scoped(hId, () => prisma.invoice.update({ where: { id: created.id }, data: { status, finalizedAt } }));
    }
    return created.id;
  }

  async function payment(hId: string, invoiceId: string, amount: number, method: PaymentMethod, status: PaymentStatus, createdAt: Date) {
    await scoped(hId, () =>
      prisma.payment.create({ data: { hospitalId: hId, invoiceId, amount, method, status, createdAt } }),
    );
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PRISMA_CLIENT);

    const mkHospital = (label: string, timezone: string) =>
      TenantContext.bypass(() =>
        prisma.hospital.create({
          data: {
            name: `Analytics ${label} ${suffix}`,
            slug: `analytics-${label}-${suffix}`,
            status: HospitalStatus.ACTIVE,
            timezone,
            contactEmail: `analytics-${label}-${suffix}@test.medcore.test`,
          },
        }),
      );
    hospitalA = (await mkHospital("a", TZ_A)).id;
    hospitalB = (await mkHospital("b", "UTC")).id;
    createdHospitalIds.push(hospitalA, hospitalB);

    deptA = (await scoped(hospitalA, () => prisma.department.create({ data: { hospitalId: hospitalA, name: "Cardiology" } }))).id;
    const deptA2 = (await scoped(hospitalA, () => prisma.department.create({ data: { hospitalId: hospitalA, name: "Orthopaedics" } }))).id;
    const deptB = (await scoped(hospitalB, () => prisma.department.create({ data: { hospitalId: hospitalB, name: "General" } }))).id;

    await user(null, UserRole.SUPER_ADMIN, "sa");
    await user(hospitalA, UserRole.HOSPITAL_ADMIN, "ha");
    const docUserA1 = await user(hospitalA, UserRole.DOCTOR, "doca1", { firstName: "Meera", lastName: "Varghese" });
    const docUserA2 = await user(hospitalA, UserRole.DOCTOR, "doca2", { firstName: "Arjun", lastName: "Pillai" });
    const docUserA3 = await user(hospitalA, UserRole.DOCTOR, "doca3", { status: UserStatus.DISABLED });
    for (const [role, key] of [
      [UserRole.NURSE, "nur"],
      [UserRole.RECEPTIONIST, "rec"],
      [UserRole.LAB_TECHNICIAN, "lab"],
      [UserRole.PHARMACIST, "phm"],
      [UserRole.ACCOUNTANT, "acc"],
    ] as const) {
      await user(hospitalA, role, key);
    }
    const patUserA1 = await user(hospitalA, UserRole.PATIENT, "pata1", { firstName: "Zephyrine", lastName: "Quartz" });
    const patUserA2 = await user(hospitalA, UserRole.PATIENT, "pata2", { firstName: "Ravi", lastName: "Menon" });
    await user(hospitalB, UserRole.HOSPITAL_ADMIN, "hab");
    await user(hospitalB, UserRole.RECEPTIONIST, "recb");
    const docUserB = await user(hospitalB, UserRole.DOCTOR, "docb");
    const patUserB = await user(hospitalB, UserRole.PATIENT, "patb", { firstName: "Zephyrine", lastName: "Elsewhere" });

    const doctor = (hId: string, userId: string, departmentId: string, specialization: string) =>
      scoped(hId, () =>
        prisma.doctorProfile.create({
          data: { userId, hospitalId: hId, departmentId, specialization, licenseNumber: `L-${randomUUID().slice(0, 6)}`, consultationFee: 500 },
        }),
      );
    doctorA1 = (await doctor(hospitalA, docUserA1.id, deptA, "Cardiology")).id;
    doctorA2 = (await doctor(hospitalA, docUserA2.id, deptA2, "Orthopaedics")).id;
    await doctor(hospitalA, docUserA3.id, deptA, "Cardiology");
    const doctorB = (await doctor(hospitalB, docUserB.id, deptB, "General Medicine")).id;
    const patient = (hId: string, userId: string) =>
      scoped(hId, () => prisma.patientProfile.create({ data: { userId, hospitalId: hId } }));
    patientA1 = (await patient(hospitalA, patUserA1.id)).id;
    patientA2 = (await patient(hospitalA, patUserA2.id)).id;
    patientB = (await patient(hospitalB, patUserB.id)).id;

    // Beds: Cardiology 101 (one occupied, one vacant), Orthopaedics 201 (maintenance); B has one.
    const room = (hId: string, departmentId: string, roomNumber: string, beds: BedStatus[]) =>
      scoped(hId, () =>
        prisma.room.create({
          data: {
            hospitalId: hId,
            departmentId,
            roomNumber,
            type: RoomType.GENERAL,
            beds: { create: beds.map((status, i) => ({ bedNumber: `${roomNumber}-${i + 1}`, status })) },
          },
        }),
      );
    await room(hospitalA, deptA, `101-${suffix}`, [BedStatus.OCCUPIED, BedStatus.VACANT]);
    await room(hospitalA, deptA2, `201-${suffix}`, [BedStatus.MAINTENANCE]);
    await room(hospitalB, deptB, `B1-${suffix}`, [BedStatus.OCCUPIED]);

    // Appointments, March 2019. 00:30 IST on the 3rd is still the 2nd in UTC.
    const apA1 = await appointment(hospitalA, doctorA1, patientA1, ist("2019-03-03T00:30:00"), AppointmentStatus.COMPLETED);
    const apA2 = await appointment(hospitalA, doctorA2, patientA2, ist("2019-03-03T10:00:00"), AppointmentStatus.CANCELLED);
    const apA3 = await appointment(hospitalA, doctorA1, patientA2, ist("2019-03-05T09:00:00"), AppointmentStatus.NO_SHOW);
    const apB1 = await appointment(hospitalB, doctorB, patientB, new Date("2019-03-03T12:00:00Z"), AppointmentStatus.COMPLETED);

    // Today (hospital A local): two active appointments for one patient, one cancelled.
    const todayA = localDateKey(new Date(), TZ_A);
    await appointment(hospitalA, doctorA1, patientA1, zonedWallTimeToUtc(todayA, "07:00", TZ_A), AppointmentStatus.CONFIRMED);
    await appointment(hospitalA, doctorA2, patientA1, zonedWallTimeToUtc(todayA, "07:30", TZ_A), AppointmentStatus.PENDING);
    const apTodayCancelled = await appointment(hospitalA, doctorA2, patientA2, zonedWallTimeToUtc(todayA, "08:00", TZ_A), AppointmentStatus.CANCELLED);

    // Invoices and payments. 20:00Z on 2 March is 01:30 IST on the 3rd.
    invoice1 = await invoice(hospitalA, apA1.id, patientA1, 1000, InvoiceStatus.PARTIALLY_PAID, new Date("2019-03-02T20:00:00Z"));
    invoice2 = await invoice(hospitalA, apA3.id, patientA2, 500, InvoiceStatus.FINALIZED, new Date("2019-03-05T06:00:00Z"));
    const invoice3 = await invoice(hospitalA, apA3.id, patientA2, 300, InvoiceStatus.PAID, new Date("2019-03-05T07:00:00Z"));
    await invoice(hospitalA, apA2.id, patientA2, 700, InvoiceStatus.DRAFT, null);
    // Finalized on the 4th, then cancelled: neither invoiced nor outstanding.
    await invoice(hospitalA, apA2.id, patientA2, 400, InvoiceStatus.CANCELLED, new Date("2019-03-04T06:00:00Z"));
    const invoiceToday = await invoice(hospitalA, apTodayCancelled.id, patientA2, 250, InvoiceStatus.PAID, new Date());
    await payment(hospitalA, invoice1, 600, PaymentMethod.CASH, PaymentStatus.SUCCEEDED, new Date("2019-03-03T05:00:00Z"));
    await payment(hospitalA, invoice1, 200, PaymentMethod.STRIPE, PaymentStatus.PENDING, new Date("2019-03-03T06:00:00Z"));
    await payment(hospitalA, invoice1, 150, PaymentMethod.RAZORPAY, PaymentStatus.FAILED, new Date("2019-03-03T07:00:00Z"));
    await payment(hospitalA, invoice3, 300, PaymentMethod.STRIPE, PaymentStatus.SUCCEEDED, new Date("2019-03-05T08:00:00Z"));
    await payment(hospitalA, invoiceToday, 250, PaymentMethod.CASH, PaymentStatus.SUCCEEDED, new Date());
    const invoiceB = await invoice(hospitalB, apB1.id, patientB, 999, InvoiceStatus.PAID, new Date("2019-03-03T12:00:00Z"));
    await payment(hospitalB, invoiceB, 999, PaymentMethod.CASH, PaymentStatus.SUCCEEDED, new Date("2019-03-03T12:30:00Z"));

    // Work queues: a routine order placed first, then an urgent one; two prescriptions.
    const record = await scoped(hospitalA, () =>
      prisma.medicalRecord.create({ data: { hospitalId: hospitalA, appointmentId: apA1.id, patientId: patientA1, doctorId: doctorA1 } }),
    );
    const labTest = await scoped(hospitalA, () =>
      prisma.labTest.create({ data: { hospitalId: hospitalA, name: `Lipid ${suffix}`, code: `LIP-${suffix}`, price: 400 } }),
    );
    const order = (priority: LabOrderPriority, status: LabOrderItemStatus, createdAt: Date) =>
      scoped(hospitalA, () =>
        prisma.labOrder.create({
          data: {
            hospitalId: hospitalA,
            medicalRecordId: record.id,
            doctorId: doctorA1,
            patientId: patientA1,
            priority,
            createdAt,
            items: { create: [{ labTestId: labTest.id, status }] },
          },
        }),
      );
    orderRoutine = (await order(LabOrderPriority.ROUTINE, LabOrderItemStatus.ORDERED, new Date("2019-03-03T06:00:00Z"))).id;
    orderUrgent = (await order(LabOrderPriority.URGENT, LabOrderItemStatus.SAMPLE_COLLECTED, new Date("2019-03-03T07:00:00Z"))).id;
    const medicine = await scoped(hospitalA, () =>
      prisma.medicine.create({ data: { hospitalId: hospitalA, name: `Atorvastatin ${suffix}`, genericName: "atorvastatin", form: MedicineForm.TABLET, unit: "tablet" } }),
    );
    const rx = (status: PrescriptionStatus) =>
      scoped(hospitalA, () =>
        prisma.prescription.create({
          data: {
            hospitalId: hospitalA,
            medicalRecordId: record.id,
            doctorId: doctorA1,
            patientId: patientA1,
            status,
            items: {
              create: [{ medicineId: medicine.id, dosage: "10 mg", frequency: PrescriptionFrequency.OD, durationDays: 30, quantityPrescribed: 30 }],
            },
          },
        }),
      );
    rxIssued = (await rx(PrescriptionStatus.ISSUED)).id;
    rxDispensed = (await rx(PrescriptionStatus.DISPENSED)).id;

    for (const key of ["sa", "ha", "doca1", "doca2", "nur", "rec", "lab", "phm", "acc", "pata1", "hab", "recb"]) {
      await login(key);
    }
  });

  afterAll(async () => {
    await purgeBilling(prisma, createdHospitalIds);
    await TenantContext.bypass(async () => {
      const where = { hospitalId: { in: createdHospitalIds } };
      await prisma.prescriptionItem.deleteMany({ where: { prescription: where } });
      await prisma.prescription.deleteMany({ where });
      await prisma.medicine.deleteMany({ where });
      await prisma.labOrderItem.deleteMany({ where: { labOrder: where } });
      await prisma.labOrder.deleteMany({ where });
      await prisma.labTest.deleteMany({ where });
      await prisma.medicalRecord.deleteMany({ where });
      await prisma.appointment.deleteMany({ where });
      await prisma.bed.deleteMany({ where: { room: where } });
      await prisma.room.deleteMany({ where });
      await prisma.doctorProfile.deleteMany({ where });
      await prisma.patientProfile.deleteMany({ where });
      await prisma.refreshTokenSession.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.auditLog.deleteMany({ where: { OR: [where, { actorUserId: { in: createdUserIds } }] } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma.department.deleteMany({ where });
      await prisma.hospital.deleteMany({ where: { id: { in: createdHospitalIds } } });
    });
    await app.close();
  });

  const RANGE = "from=2019-03-01&to=2019-03-07";
  interface Day {
    date: string;
    total: number;
    byStatus: Record<string, number>;
    collected: string;
    invoiced: string;
    byMethod: Record<string, string>;
  }
  const dayOf = (days: Day[], date: string) => days.find((d) => d.date === date)!;

  describe("appointment trend (hospital-local days)", () => {
    it("counts each day's appointments by status in Asia/Kolkata, zero-filled, one hospital only", async () => {
      const res = await api().get(`/api/analytics/appointments?${RANGE}`).set(auth(t.ha)).expect(200);
      const { days, timezone, scope } = res.body.data;
      expect(scope).toBe("HOSPITAL");
      expect(timezone).toBe(TZ_A);
      expect(days.map((d: { date: string }) => d.date)).toEqual([
        "2019-03-01", "2019-03-02", "2019-03-03", "2019-03-04", "2019-03-05", "2019-03-06", "2019-03-07",
      ]);
      // 00:30 IST on the 3rd counts on the 3rd, not the 2nd (UTC).
      expect(dayOf(days, "2019-03-02").total).toBe(0);
      expect(dayOf(days, "2019-03-03")).toEqual({ date: "2019-03-03", total: 2, byStatus: { COMPLETED: 1, CANCELLED: 1 } });
      expect(dayOf(days, "2019-03-05")).toEqual({ date: "2019-03-05", total: 1, byStatus: { NO_SHOW: 1 } });
      expect(days.reduce((n: number, d: { total: number }) => n + d.total, 0)).toBe(3);
    });

    it("limits a doctor to their own appointments", async () => {
      const a1 = (await api().get(`/api/analytics/appointments?${RANGE}`).set(auth(t.doca1)).expect(200)).body.data.days;
      const a2 = (await api().get(`/api/analytics/appointments?${RANGE}`).set(auth(t.doca2)).expect(200)).body.data.days;
      expect(dayOf(a1, "2019-03-03").byStatus).toEqual({ COMPLETED: 1 });
      expect(dayOf(a1, "2019-03-05").total).toBe(1);
      expect(dayOf(a2, "2019-03-03").byStatus).toEqual({ CANCELLED: 1 });
      expect(dayOf(a2, "2019-03-05").total).toBe(0);
    });

    it("gives the Super Admin the platform in UTC days, including hospital B", async () => {
      const res = await api().get(`/api/analytics/appointments?${RANGE}`).set(auth(t.sa)).expect(200);
      expect(res.body.data.scope).toBe("PLATFORM");
      expect(res.body.data.timezone).toBe("UTC");
      const days = res.body.data.days;
      // A's 00:30 IST appointment is 2 March in UTC; B's is 3 March.
      expect(dayOf(days, "2019-03-02").byStatus.COMPLETED).toBeGreaterThanOrEqual(1);
      expect(dayOf(days, "2019-03-03").byStatus).toMatchObject({ CANCELLED: 1, COMPLETED: 1 });
    });

    it("rejects bad ranges (400)", async () => {
      await api().get("/api/analytics/appointments?from=2019-03-07&to=2019-03-01").set(auth(t.ha)).expect(400);
      await api().get("/api/analytics/appointments?from=2019-01-01&to=2019-04-03").set(auth(t.ha)).expect(400);
      await api().get("/api/analytics/appointments?from=2019-02-30&to=2019-03-03").set(auth(t.ha)).expect(400);
      await api().get("/api/analytics/appointments?from=03/01/2019").set(auth(t.ha)).expect(400);
      await api().get("/api/analytics/appointments?from=2019-03-01&foo=1").set(auth(t.ha)).expect(400);
    });
  });

  describe("revenue (FR-ANALYTICS-001)", () => {
    it("adds up collections, invoicing, and what's outstanding, per local day", async () => {
      const res = await api().get(`/api/analytics/revenue?${RANGE}`).set(auth(t.acc)).expect(200);
      const r = res.body.data;
      // Invoice 1 was finalized 01:30 IST on the 3rd (still the 2nd in UTC).
      expect(dayOf(r.days, "2019-03-02")).toMatchObject({ collected: "0.00", invoiced: "0.00" });
      expect(dayOf(r.days, "2019-03-04")).toMatchObject({ collected: "0.00", invoiced: "0.00" });
      expect(dayOf(r.days, "2019-03-03")).toEqual({ date: "2019-03-03", collected: "600.00", invoiced: "1000.00", byMethod: { CASH: "600.00" } });
      expect(dayOf(r.days, "2019-03-05")).toEqual({ date: "2019-03-05", collected: "300.00", invoiced: "800.00", byMethod: { STRIPE: "300.00" } });
      // PENDING and FAILED payments and the DRAFT invoice count nowhere.
      expect(r.totals).toEqual({ collected: "900.00", invoiced: "1800.00" });
      // 1000 - 600 on invoice 1, plus 500 on invoice 2.
      expect(r.outstanding).toBe("900.00");
      expect(r.outstandingInvoices).toBe(2);
      expect(r.currency).toBe("INR");
    });

    it("keeps each hospital's money to itself", async () => {
      const b = (await api().get(`/api/analytics/revenue?${RANGE}`).set(auth(t.hab)).expect(200)).body.data;
      expect(b.totals).toEqual({ collected: "999.00", invoiced: "999.00" });
      expect(b.outstanding).toBe("0.00");
    });

    it("gives the Super Admin both hospitals, in UTC days", async () => {
      const p = (await api().get(`/api/analytics/revenue?${RANGE}`).set(auth(t.sa)).expect(200)).body.data;
      expect(p.scope).toBe("PLATFORM");
      expect(dayOf(p.days, "2019-03-02").invoiced).toBe("1000.00");
      expect(dayOf(p.days, "2019-03-03")).toMatchObject({ collected: "1599.00", invoiced: "999.00" });
    });
  });

  describe("overview KPIs (today)", () => {
    it("counts today's active appointments, distinct patients, today's takings, beds, and active doctors", async () => {
      const k = (await api().get("/api/analytics/overview").set(auth(t.ha)).expect(200)).body.data;
      expect(k).toMatchObject({
        scope: "HOSPITAL",
        timezone: TZ_A,
        date: localDateKey(new Date(), TZ_A),
        appointmentsToday: 2,
        patientsToday: 1,
        revenueToday: "250.00",
        currency: "INR",
        occupiedBeds: 1,
        totalBeds: 3,
        activeDoctors: 2,
      });
      expect(k.activeHospitals).toBeUndefined();
    });

    it("gives the Super Admin a platform view with the hospital count", async () => {
      const k = (await api().get("/api/analytics/overview").set(auth(t.sa)).expect(200)).body.data;
      expect(k.scope).toBe("PLATFORM");
      expect(k.activeHospitals).toBeGreaterThanOrEqual(2);
      expect(k.totalBeds).toBeGreaterThanOrEqual(4);
    });
  });

  describe("occupancy (bed board)", () => {
    it("groups beds by department with counts, for this hospital only", async () => {
      const o = (await api().get("/api/analytics/occupancy").set(auth(t.nur)).expect(200)).body.data;
      expect(o.counts).toEqual({ VACANT: 1, OCCUPIED: 1, MAINTENANCE: 1 });
      expect(o.departments.map((d: { name: string }) => d.name)).toEqual(["Cardiology", "Orthopaedics"]);
      expect(o.departments[0].rooms[0].beds.map((b: { status: string }) => b.status)).toEqual(["OCCUPIED", "VACANT"]);
      const b = (await api().get("/api/analytics/occupancy").set(auth(t.hab)).expect(200)).body.data;
      expect(b.counts).toEqual({ VACANT: 0, OCCUPIED: 1, MAINTENANCE: 0 });
    });
  });

  describe("RBAC (docs/07-RBAC-MATRIX.md §3.1, §3.8, §3.9)", () => {
    const matrix: [string, string[], string[]][] = [
      ["/api/analytics/overview", ["sa", "ha"], ["doca1", "nur", "rec", "lab", "phm", "acc", "pata1"]],
      [`/api/analytics/appointments?${RANGE}`, ["sa", "ha", "doca1"], ["nur", "rec", "lab", "phm", "acc", "pata1"]],
      [`/api/analytics/revenue?${RANGE}`, ["sa", "ha", "acc"], ["doca1", "nur", "rec", "lab", "phm", "pata1"]],
      ["/api/analytics/occupancy", ["ha", "nur"], ["sa", "doca1", "rec", "lab", "phm", "acc", "pata1"]],
      ["/api/audit-logs", ["sa", "ha"], ["doca1", "nur", "rec", "lab", "phm", "acc", "pata1"]],
      ["/api/payments", ["ha", "acc"], ["sa", "doca1", "nur", "rec", "lab", "phm", "pata1"]],
      // Super Admin has no hospital to search in; platform-wide search is out of scope (D-040).
      ["/api/search?q=ze", ["ha", "doca1", "nur", "rec", "lab", "phm", "acc"], ["pata1", "sa"]],
    ];
    it.each(matrix)("%s: allowed roles get 200, every other role 403", async (path, allowed, denied) => {
      for (const key of allowed) {
        const res = await api().get(path).set(auth(t[key]));
        expect([key, res.status]).toEqual([key, 200]);
      }
      for (const key of denied) {
        const res = await api().get(path).set(auth(t[key]));
        expect([key, res.status]).toEqual([key, 403]);
      }
    });

    it("refuses anonymous callers (401)", async () => {
      await api().get("/api/analytics/overview").expect(401);
      await api().get("/api/search?q=ze").expect(401);
    });
  });

  describe("global search (FR-SEARCH-001)", () => {
    it("matches every term across name fields, within the caller's hospital only", async () => {
      const res = await api().get("/api/search?q=zeph%20qua").set(auth(t.rec)).expect(200);
      expect(res.body.data.scopes).toEqual(["patients", "doctors"]);
      expect(res.body.data.patients.total).toBe(1);
      expect(res.body.data.patients.hits[0]).toMatchObject({ id: patientA1, name: "Zephyrine Quartz" });
      expect(res.body.data.medicines).toBeUndefined();
      const b = await api().get("/api/search?q=zephyrine").set(auth(t.recb)).expect(200);
      expect(b.body.data.patients.hits.map((h: { id: string }) => h.id)).toEqual([patientB]);
    });

    it("gives each role only the scopes the matrix allows", async () => {
      const phm = (await api().get(`/api/search?q=${suffix}`).set(auth(t.phm)).expect(200)).body.data;
      expect(phm.scopes).toEqual(["doctors", "medicines"]);
      expect(phm.medicines.hits[0].name).toBe(`Atorvastatin ${suffix}`);
      expect(phm.patients).toBeUndefined();
      await api().get("/api/search?q=zeph&scope=patients").set(auth(t.lab)).expect(403);
      await api().get("/api/search?q=ator&scope=medicines").set(auth(t.nur)).expect(403);
    });

    it("finds doctors by name, specialization, or department, and paginates a single scope", async () => {
      const byDept = await api().get("/api/search?q=orthopaedics&scope=doctors").set(auth(t.ha)).expect(200);
      expect(byDept.body.data.map((h: { id: string }) => h.id)).toEqual([doctorA2]);
      expect(byDept.body.data[0]).toEqual({ id: doctorA2, name: "Dr. Arjun Pillai", specialization: "Orthopaedics", department: "Orthopaedics" });
      const paged = await api().get("/api/search?q=cardio&scope=doctors&limit=1&page=2").set(auth(t.ha)).expect(200);
      expect(paged.body.meta).toMatchObject({ page: 2, limit: 1, total: 2 });
      expect(paged.body.data).toHaveLength(1);
    });

    it("validates the query (400) and never leaks password hashes", async () => {
      await api().get("/api/search?q=z").set(auth(t.ha)).expect(400);
      await api().get("/api/search?q=%20%20z%20").set(auth(t.ha)).expect(400);
      await api().get(`/api/search?q=${"x".repeat(101)}`).set(auth(t.ha)).expect(400);
      await api().get("/api/search?q=zeph&scope=everything").set(auth(t.ha)).expect(400);
      await api().get("/api/search").set(auth(t.ha)).expect(400);
      const res = await api().get("/api/search?q=zeph").set(auth(t.ha)).expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
    });
  });

  describe("work queues and filters", () => {
    it("puts URGENT lab orders first for the lab, filters by item status, and scopes a doctor to their own", async () => {
      const queue = (await api().get("/api/lab-orders").set(auth(t.lab)).expect(200)).body.data;
      const ids = queue.map((o: { id: string }) => o.id);
      expect(ids.indexOf(orderUrgent)).toBeLessThan(ids.indexOf(orderRoutine));
      expect(queue[0].patient).toMatchObject({ firstName: "Zephyrine" });
      const collected = (await api().get("/api/lab-orders?status=SAMPLE_COLLECTED").set(auth(t.lab)).expect(200)).body.data;
      expect(collected.map((o: { id: string }) => o.id)).toEqual([orderUrgent]);
      const mine = (await api().get("/api/lab-orders").set(auth(t.doca1)).expect(200)).body.data;
      expect(mine.map((o: { id: string }) => o.id).sort()).toEqual([orderRoutine, orderUrgent].sort());
      expect((await api().get("/api/lab-orders").set(auth(t.doca2)).expect(200)).body.data).toEqual([]);
      await api().get("/api/lab-orders?status=NOPE").set(auth(t.lab)).expect(400);
      await api().get("/api/lab-orders").set(auth(t.rec)).expect(403);
    });

    it("gives the pharmacist a dispensing queue filterable by status", async () => {
      const issued = (await api().get("/api/prescriptions?status=ISSUED,PARTIALLY_DISPENSED").set(auth(t.phm)).expect(200)).body.data;
      expect(issued.map((p: { id: string }) => p.id)).toEqual([rxIssued]);
      expect(issued[0]).toMatchObject({ patient: { firstName: "Zephyrine" }, pdfReady: false });
      const all = (await api().get("/api/prescriptions").set(auth(t.phm)).expect(200)).body.data;
      expect(all.map((p: { id: string }) => p.id).sort()).toEqual([rxIssued, rxDispensed].sort());
      await api().get("/api/prescriptions").set(auth(t.nur)).expect(403);
    });

    it("filters invoices by several statuses (outstanding) and appointments by doctor", async () => {
      const outstanding = (await api().get("/api/invoices?status=FINALIZED,PARTIALLY_PAID").set(auth(t.acc)).expect(200)).body.data;
      expect(outstanding.map((i: { id: string }) => i.id).sort()).toEqual([invoice1, invoice2].sort());
      expect(outstanding.every((i: { patient: { firstName: string } | null }) => i.patient?.firstName)).toBe(true);
      expect(JSON.stringify(outstanding)).not.toMatch(/email|phone/);
      await api().get("/api/invoices?status=FINALIZED,BOGUS").set(auth(t.acc)).expect(400);
      const a2 = (await api().get(`/api/appointments?doctorId=${doctorA2}&limit=100`).set(auth(t.rec)).expect(200)).body.data;
      expect(a2.length).toBeGreaterThan(0);
      expect(a2.every((a: { doctorId: string }) => a.doctorId === doctorA2)).toBe(true);
      const cancelled = (await api().get("/api/appointments?status=CANCELLED,NO_SHOW&limit=100").set(auth(t.rec)).expect(200)).body.data;
      expect(cancelled.every((a: { status: string }) => ["CANCELLED", "NO_SHOW"].includes(a.status))).toBe(true);
      expect(cancelled).toHaveLength(3);
      // A doctorId filter narrows within a doctor's own scope, so a colleague's id gives nothing.
      const forced = (await api().get(`/api/appointments?doctorId=${doctorA2}&limit=100`).set(auth(t.doca1)).expect(200)).body.data;
      expect(forced).toEqual([]);
    });

    it("lists payments for reconciliation, filterable, without provider internals", async () => {
      const pending = (await api().get("/api/payments?status=PENDING,FAILED").set(auth(t.acc)).expect(200)).body.data;
      expect(pending.map((p: { status: string }) => p.status).sort()).toEqual(["FAILED", "PENDING"]);
      expect(pending[0].patient).toMatchObject({ firstName: "Zephyrine" });
      expect(Object.keys(pending[0]).sort()).toEqual(["amount", "createdAt", "currency", "id", "invoiceId", "method", "patient", "status"]);
      const b = (await api().get("/api/payments").set(auth(t.hab)).expect(200)).body.data;
      expect(b.every((p: { invoiceId: string }) => p.invoiceId !== invoice1)).toBe(true);
    });

    it("keeps the patient directory list to the roles the matrix allows (D-040)", async () => {
      const rec = (await api().get("/api/patients?search=zephyrine").set(auth(t.rec)).expect(200)).body;
      expect(rec.meta.total).toBe(1);
      for (const key of ["lab", "phm"]) {
        const res = (await api().get("/api/patients?search=zephyrine").set(auth(t[key])).expect(200)).body;
        expect([key, res.meta.total]).toEqual([key, 0]);
      }
    });
  });

  describe("audit log", () => {
    it("shows a hospital admin their own hospital's trail without before/after data", async () => {
      const res = (await api().get("/api/audit-logs?entityType=Invoice&limit=50").set(auth(t.ha)).expect(200)).body;
      expect(res.meta.total).toBeGreaterThan(0);
      expect(res.data.every((r: { hospitalId: string }) => r.hospitalId === hospitalA)).toBe(true);
      expect(res.data.every((r: { entityType: string }) => r.entityType === "Invoice")).toBe(true);
      expect(Object.keys(res.data[0]).sort()).toEqual(["action", "actor", "createdAt", "entityId", "entityType", "hospitalId", "id"]);
      const b = (await api().get("/api/audit-logs?limit=100").set(auth(t.hab)).expect(200)).body.data;
      expect(b.every((r: { hospitalId: string }) => r.hospitalId === hospitalB)).toBe(true);
      await api().get("/api/audit-logs?entityType=drop%20table").set(auth(t.ha)).expect(400);
    });

    it("gives the Super Admin every hospital's trail", async () => {
      const res = (await api().get("/api/audit-logs?entityType=Room&limit=100").set(auth(t.sa)).expect(200)).body.data;
      const hospitals = new Set(res.map((r: { hospitalId: string }) => r.hospitalId));
      expect(hospitals.has(hospitalA)).toBe(true);
      expect(hospitals.has(hospitalB)).toBe(true);
    });
  });
});
