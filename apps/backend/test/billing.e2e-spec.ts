import { TEST_RAZORPAY_WEBHOOK_SECRET, TEST_STRIPE_WEBHOOK_SECRET } from "./helpers/payment-test-env";
import { createHmac, randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import Stripe from "stripe";
import {
  AppointmentStatus,
  HospitalStatus,
  InvoiceItemSourceType,
  InvoiceStatus,
  MedicineForm,
  NotificationType,
  PaymentMethod,
  PaymentProvider,
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
import { CheckoutClient, type CheckoutRequest } from "../src/billing/payments/checkout-client";
import { purgeBilling } from "./helpers/billing-cleanup";

/**
 * Phase 10 — Billing & Payments. Covers automatic charge accumulation from
 * encounters, lab orders, and dispensing, plus supplementary invoices
 * (FR-BILL-001, D-027); finalization and credit-only corrections
 * (FR-BILL-002); invoice-total integrity at both the API and the database
 * level (FR-BILL-003, mandatory scenario #6, extra gate); cash payments;
 * online checkout; and signed, idempotent Stripe/Razorpay webhooks
 * (FR-BILL-004/005/006, SEC-PAY-*, mandatory scenario #8, extra gate). Also
 * every RBAC cell in docs/07-RBAC-MATRIX.md §3.8 and cross-tenant access.
 *
 * Only the *outbound* checkout-creation network call is replaced
 * (`CheckoutClient`), since no provider test keys exist in this environment.
 * Webhook signature verification runs through the real Stripe and Razorpay
 * SDKs with real signatures.
 */
describe("Billing & Payments (e2e)", () => {
  let app: INestApplication;
  let prisma: ExtendedPrismaClient;
  const suffix = randomUUID().slice(0, 8);
  const PASSWORD = "Passw0rd!";
  const stripe = new Stripe("sk_test_unused_for_signing");

  const checkoutCalls: { provider: PaymentProvider; req: CheckoutRequest }[] = [];
  const fakeCheckout = {
    configured: true,
    isConfigured: () => fakeCheckout.configured,
    createCheckout: async (provider: PaymentProvider, req: CheckoutRequest) => {
      checkoutCalls.push({ provider, req });
      return provider === PaymentProvider.STRIPE
        ? { reference: `cs_test_${randomUUID()}`, checkoutUrl: "https://checkout.stripe.test/pay", keyId: null }
        : { reference: `order_${randomUUID().replace(/-/g, "").slice(0, 14)}`, checkoutUrl: null, keyId: "rzp_test_key" };
    },
  };

  let hospitalId: string;
  let otherHospitalId: string;
  let deptId: string;
  let doctorProfileId: string;
  let patientProfileId: string;
  let patientUserId: string;
  let otherPatientProfileId: string;
  let labTestId: string;
  let medicineId: string;

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
  let otherPatientToken: string;
  let otherReceptionistToken: string;
  let otherPatientSameNameToken: string;

  const CONSULTATION_FEE = 500;
  const LAB_PRICE = 200;
  const MRP = 4.75;

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
    const res = await request(app.getHttpServer()).post("/api/auth/login").send({ email, password: PASSWORD }).expect(200);
    return res.body.data.accessToken as string;
  }

  const api = () => request(app.getHttpServer());

  let apptOffset = 0;
  async function createAppointment(patientId = patientProfileId) {
    apptOffset += 60;
    const start = Date.now() + apptOffset * 60_000;
    return scoped(hospitalId, () =>
      prisma.appointment.create({
        data: {
          hospitalId,
          patientId,
          doctorId: doctorProfileId,
          departmentId: deptId,
          scheduledStart: new Date(start),
          scheduledEnd: new Date(start + 1_800_000),
          status: AppointmentStatus.IN_PROGRESS,
          createdBy: "system-test",
        },
      }),
    );
  }

  /** A real encounter via the API, which charges the consultation fee. */
  async function startEncounter(patientId = patientProfileId) {
    const appt = await createAppointment(patientId);
    const res = await api()
      .post("/api/medical-records")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ appointmentId: appt.id, chiefComplaint: "Fever" })
      .expect(201);
    return { appointmentId: appt.id, medicalRecordId: res.body.data.id as string };
  }

  async function invoicesFor(appointmentId: string) {
    return TenantContext.bypass(() =>
      prisma.invoice.findMany({
        where: { appointmentId },
        include: { items: true, payments: true },
        orderBy: { createdAt: "asc" },
      }),
    );
  }

  async function draftInvoiceId(appointmentId: string): Promise<string> {
    const invoices = await invoicesFor(appointmentId);
    const draft = invoices.find((i) => i.status === InvoiceStatus.DRAFT);
    if (!draft) throw new Error("no draft invoice");
    return draft.id;
  }

  function addItem(invoiceId: string, body: object, token = receptionistToken) {
    return api().post(`/api/invoices/${invoiceId}/items`).set("Authorization", `Bearer ${token}`).send(body);
  }

  function finalize(invoiceId: string, token = receptionistToken) {
    return api().patch(`/api/invoices/${invoiceId}/finalize`).set("Authorization", `Bearer ${token}`);
  }

  /** An encounter-backed invoice, finalized, with total = consultation fee. */
  async function finalizedInvoice(patientId = patientProfileId) {
    const { appointmentId } = await startEncounter(patientId);
    const invoiceId = await draftInvoiceId(appointmentId);
    await finalize(invoiceId).expect(200);
    return { invoiceId, appointmentId };
  }

  async function invoiceRow(invoiceId: string) {
    return TenantContext.bypass(() =>
      prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { items: true, payments: true } }),
    );
  }

  /** Asserts FR-BILL-003 against the stored rows: every lineTotal is
   * quantity × unitPrice, and subtotal/total equal the sum. */
  async function expectTotalsConsistent(invoiceId: string) {
    const inv = await invoiceRow(invoiceId);
    let sum = 0;
    for (const item of inv.items) {
      expect(Number(item.lineTotal)).toBeCloseTo(item.quantity * Number(item.unitPrice), 2);
      sum += Number(item.lineTotal);
    }
    expect(Number(inv.subtotal)).toBeCloseTo(sum, 2);
    expect(Number(inv.total)).toBeCloseTo(sum, 2);
    return inv;
  }

  function stripeEvent(type: string, session: Record<string, unknown>) {
    return JSON.stringify({
      id: `evt_${randomUUID().replace(/-/g, "")}`,
      object: "event",
      type,
      api_version: "2024-06-20",
      created: Math.floor(Date.now() / 1000),
      data: { object: { object: "checkout.session", ...session } },
    });
  }

  function postStripe(payload: string, signature?: string) {
    const req = api().post("/api/payments/webhook/stripe").set("Content-Type", "application/json");
    if (signature !== undefined) req.set("Stripe-Signature", signature);
    return req.send(payload);
  }

  function signStripe(payload: string, opts: { secret?: string; timestamp?: number } = {}) {
    return stripe.webhooks.generateTestHeaderString({
      payload,
      secret: opts.secret ?? TEST_STRIPE_WEBHOOK_SECRET,
      timestamp: opts.timestamp,
    });
  }

  function postRazorpay(payload: string, signature: string | null, eventId = `evt_${randomUUID()}`) {
    const req = api()
      .post("/api/payments/webhook/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Event-Id", eventId);
    if (signature !== null) req.set("X-Razorpay-Signature", signature);
    return req.send(payload);
  }

  function signRazorpay(payload: string, secret = TEST_RAZORPAY_WEBHOOK_SECRET) {
    return createHmac("sha256", secret).update(payload).digest("hex");
  }

  function startCheckout(invoiceId: string, provider: PaymentProvider, token = patientToken) {
    return api()
      .post(`/api/invoices/${invoiceId}/checkout-session`)
      .set("Authorization", `Bearer ${token}`)
      .send({ provider });
  }

  async function paymentRow(paymentId: string) {
    return TenantContext.bypass(() => prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }));
  }

  async function receiptNotifications(invoicePaymentIds: string[]) {
    return TenantContext.bypass(() =>
      prisma.notification.findMany({
        where: { type: NotificationType.PAYMENT_RECEIVED, relatedEntityId: { in: invoicePaymentIds } },
      }),
    );
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CheckoutClient)
      .useValue(fakeCheckout)
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PRISMA_CLIENT);

    const mkHospital = (label: string) =>
      TenantContext.bypass(() =>
        prisma.hospital.create({
          data: {
            name: `Billing ${label} ${suffix}`,
            slug: `billing-${label}-${suffix}`,
            status: HospitalStatus.ACTIVE,
            contactEmail: `billing-${label}-${suffix}@test.medcore.test`,
          },
        }),
      );
    hospitalId = (await mkHospital("a")).id;
    otherHospitalId = (await mkHospital("b")).id;
    createdHospitalIds.push(hospitalId, otherHospitalId);

    deptId = (await scoped(hospitalId, () => prisma.department.create({ data: { hospitalId, name: "General" } }))).id;

    const admin = await createUser(hospitalId, UserRole.HOSPITAL_ADMIN, `admin-${suffix}@test.medcore.test`);
    const doctor = await createUser(hospitalId, UserRole.DOCTOR, `doctor-${suffix}@test.medcore.test`);
    const nurse = await createUser(hospitalId, UserRole.NURSE, `nurse-${suffix}@test.medcore.test`);
    const receptionist = await createUser(hospitalId, UserRole.RECEPTIONIST, `rec-${suffix}@test.medcore.test`);
    const lab = await createUser(hospitalId, UserRole.LAB_TECHNICIAN, `lab-${suffix}@test.medcore.test`);
    const pharmacist = await createUser(hospitalId, UserRole.PHARMACIST, `pharm-${suffix}@test.medcore.test`);
    const accountant = await createUser(hospitalId, UserRole.ACCOUNTANT, `acct-${suffix}@test.medcore.test`);
    const patient = await createUser(hospitalId, UserRole.PATIENT, `patient-${suffix}@test.medcore.test`);
    const otherPatient = await createUser(hospitalId, UserRole.PATIENT, `patient2-${suffix}@test.medcore.test`);
    const otherReceptionist = await createUser(otherHospitalId, UserRole.RECEPTIONIST, `other-rec-${suffix}@test.medcore.test`);
    const otherHospitalPatient = await createUser(otherHospitalId, UserRole.PATIENT, `other-pat-${suffix}@test.medcore.test`);
    patientUserId = patient.id;

    doctorProfileId = (
      await scoped(hospitalId, () =>
        prisma.doctorProfile.create({
          data: {
            userId: doctor.id,
            hospitalId,
            departmentId: deptId,
            specialization: "General Medicine",
            licenseNumber: `LIC-${suffix}`,
            consultationFee: CONSULTATION_FEE,
          },
        }),
      )
    ).id;
    patientProfileId = (await scoped(hospitalId, () => prisma.patientProfile.create({ data: { userId: patient.id, hospitalId } }))).id;
    otherPatientProfileId = (
      await scoped(hospitalId, () => prisma.patientProfile.create({ data: { userId: otherPatient.id, hospitalId } }))
    ).id;
    await scoped(otherHospitalId, () =>
      prisma.patientProfile.create({ data: { userId: otherHospitalPatient.id, hospitalId: otherHospitalId } }),
    );
    labTestId = (
      await scoped(hospitalId, () =>
        prisma.labTest.create({ data: { hospitalId, name: `CBC ${suffix}`, code: `CBC-${suffix}`, price: LAB_PRICE } }),
      )
    ).id;
    medicineId = (
      await scoped(hospitalId, () =>
        prisma.medicine.create({
          data: { hospitalId, name: `Paracetamol ${suffix}`, form: MedicineForm.TABLET, unit: "tablet", reorderLevel: 0 },
        }),
      )
    ).id;
    await scoped(hospitalId, () =>
      prisma.medicineBatch.create({
        data: {
          hospitalId,
          medicineId,
          batchNumber: `BILL-${suffix}`,
          manufacturingDate: new Date("2026-01-01T00:00:00.000Z"),
          expiryDate: new Date("2030-01-01T00:00:00.000Z"),
          quantityOnHand: 1000,
          unitCost: 1,
          mrp: MRP,
        },
      }),
    );

    adminToken = await login(admin.email);
    doctorToken = await login(doctor.email);
    nurseToken = await login(nurse.email);
    receptionistToken = await login(receptionist.email);
    labToken = await login(lab.email);
    pharmacistToken = await login(pharmacist.email);
    accountantToken = await login(accountant.email);
    patientToken = await login(patient.email);
    otherPatientToken = await login(otherPatient.email);
    otherReceptionistToken = await login(otherReceptionist.email);
    otherPatientSameNameToken = await login(otherHospitalPatient.email);
  });

  afterAll(async () => {
    await purgeBilling(prisma, createdHospitalIds);
    await TenantContext.bypass(async () => {
      const where = { hospitalId: { in: createdHospitalIds } };
      await prisma.notification.deleteMany({ where });
      await prisma.dispenseRecord.deleteMany({ where: { medicineBatch: where } });
      await prisma.prescriptionItem.deleteMany({ where: { prescription: where } });
      await prisma.prescription.deleteMany({ where });
      await prisma.medicineBatch.deleteMany({ where });
      await prisma.medicine.deleteMany({ where });
      await prisma.labResult.deleteMany({ where: { labOrderItem: { labOrder: where } } });
      await prisma.labOrderItem.deleteMany({ where: { labOrder: where } });
      await prisma.labOrder.deleteMany({ where });
      await prisma.labTest.deleteMany({ where });
      await prisma.medicalRecord.deleteMany({ where });
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

  const nonBillingStaffTokens = () => [adminToken, doctorToken, nurseToken, labToken, pharmacistToken, patientToken];

  describe("automatic charge accumulation (FR-BILL-001)", () => {
    it("charges consultation, lab, and pharmacy onto the visit's DRAFT invoice as they're incurred", async () => {
      const { appointmentId, medicalRecordId } = await startEncounter();
      let [invoice] = await invoicesFor(appointmentId);
      expect(invoice.status).toBe(InvoiceStatus.DRAFT);
      expect(invoice.patientId).toBe(patientProfileId);
      expect(invoice.items.map((i) => [i.sourceType, Number(i.unitPrice), i.sourceId])).toEqual([
        [InvoiceItemSourceType.CONSULTATION, CONSULTATION_FEE, appointmentId],
      ]);

      const order = await api()
        .post("/api/lab-orders")
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({ medicalRecordId, items: [{ labTestId }] })
        .expect(201);

      const rx = await scoped(hospitalId, () =>
        prisma.prescription.create({
          data: {
            hospitalId,
            medicalRecordId,
            doctorId: doctorProfileId,
            patientId: patientProfileId,
            items: {
              create: [
                { medicineId, dosage: "1 tab", frequency: PrescriptionFrequency.BD, durationDays: 3, quantityPrescribed: 6 },
              ],
            },
          },
          include: { items: true },
        }),
      );
      const dispensed = await api()
        .post(`/api/prescriptions/${rx.id}/dispense`)
        .set("Authorization", `Bearer ${pharmacistToken}`)
        .send({ items: [{ prescriptionItemId: rx.items[0].id, quantity: 6 }] })
        .expect(201);

      const invoices = await invoicesFor(appointmentId);
      expect(invoices).toHaveLength(1);
      invoice = invoices[0];
      const bySource = Object.fromEntries(invoice.items.map((i) => [i.sourceType, i]));
      expect(bySource[InvoiceItemSourceType.LAB].sourceId).toBe(order.body.data.items[0].id);
      expect(Number(bySource[InvoiceItemSourceType.LAB].lineTotal)).toBe(LAB_PRICE);
      expect(bySource[InvoiceItemSourceType.PHARMACY].sourceId).toBe(dispensed.body.data.items[0].dispenseRecords[0].id);
      expect(bySource[InvoiceItemSourceType.PHARMACY].quantity).toBe(6);
      expect(Number(bySource[InvoiceItemSourceType.PHARMACY].lineTotal)).toBeCloseTo(6 * MRP, 2);
      const inv = await expectTotalsConsistent(invoice.id);
      expect(Number(inv.total)).toBeCloseTo(CONSULTATION_FEE + LAB_PRICE + 6 * MRP, 2);

      // Receptionist's work queue finds it.
      const list = await api()
        .get(`/api/invoices?appointmentId=${appointmentId}&status=${InvoiceStatus.DRAFT}`)
        .set("Authorization", `Bearer ${receptionistToken}`)
        .expect(200);
      expect(list.body.data.map((i: { id: string }) => i.id)).toEqual([invoice.id]);
    });

    it("opens a supplementary DRAFT invoice for a charge incurred after the visit's invoice was finalized (D-027)", async () => {
      const { appointmentId, medicalRecordId } = await startEncounter();
      const first = await draftInvoiceId(appointmentId);
      await finalize(first).expect(200);

      await api()
        .post("/api/lab-orders")
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({ medicalRecordId, items: [{ labTestId }] })
        .expect(201);

      const invoices = await invoicesFor(appointmentId);
      expect(invoices).toHaveLength(2);
      const [finalized, supplementary] = invoices;
      expect(finalized.id).toBe(first);
      expect(finalized.status).toBe(InvoiceStatus.FINALIZED);
      expect(finalized.items).toHaveLength(1);
      expect(Number(finalized.total)).toBe(CONSULTATION_FEE);
      expect(supplementary.status).toBe(InvoiceStatus.DRAFT);
      expect(supplementary.items.map((i) => i.sourceType)).toEqual([InvoiceItemSourceType.LAB]);
    });

    it("POST /invoices returns the visit's existing DRAFT invoice rather than opening a second one", async () => {
      const { appointmentId } = await startEncounter();
      const existing = await draftInvoiceId(appointmentId);
      const res = await api()
        .post("/api/invoices")
        .set("Authorization", `Bearer ${accountantToken}`)
        .send({ appointmentId })
        .expect(201);
      expect(res.body.data.id).toBe(existing);
      expect(await invoicesFor(appointmentId)).toHaveLength(1);

      // Before any encounter: an empty draft can be opened, but not finalized.
      const appt = await createAppointment();
      const empty = await api().post("/api/invoices").set("Authorization", `Bearer ${receptionistToken}`).send({ appointmentId: appt.id }).expect(201);
      expect(empty.body.data.items).toHaveLength(0);
      await finalize(empty.body.data.id).expect(400);
    });

    it("never opens two DRAFT invoices for one visit under concurrent charges", async () => {
      const appt = await createAppointment();
      const results = await Promise.all(
        [1, 2, 3].map(() =>
          api().post("/api/invoices").set("Authorization", `Bearer ${receptionistToken}`).send({ appointmentId: appt.id }),
        ),
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
      expect(await invoicesFor(appt.id)).toHaveLength(1);
    });
  });

  describe("invoice total integrity (FR-BILL-003, mandatory scenario #6 — extra gate)", () => {
    it("keeps total == sum(line items) after every mutation and rejects client-supplied totals", async () => {
      const { appointmentId } = await startEncounter();
      const invoiceId = await draftInvoiceId(appointmentId);
      await expectTotalsConsistent(invoiceId);

      const lines = [
        { sourceType: InvoiceItemSourceType.OTHER, description: "Dressing", quantity: 3, unitPrice: 45.5 },
        { sourceType: InvoiceItemSourceType.ROOM, description: "Observation bed", quantity: 2, unitPrice: 1200 },
        { sourceType: InvoiceItemSourceType.OTHER, description: "Syringe", quantity: 7, unitPrice: 0.99 },
        { sourceType: InvoiceItemSourceType.OTHER, description: "Goodwill credit", quantity: 1, unitPrice: -100.25 },
      ];
      for (const line of lines) {
        const res = await addItem(invoiceId, line).expect(201);
        const inv = await expectTotalsConsistent(invoiceId);
        expect(Number(res.body.data.total)).toBeCloseTo(Number(inv.total), 2);
      }
      const expected = CONSULTATION_FEE + 3 * 45.5 + 2 * 1200 + 7 * 0.99 - 100.25;
      expect(Number((await invoiceRow(invoiceId)).total)).toBeCloseTo(expected, 2);

      // Deliberately malformed client-supplied totals: rejected outright
      // (forbidNonWhitelisted), and the stored total is untouched.
      for (const bad of [
        { ...lines[0], total: 1 },
        { ...lines[0], lineTotal: 99999 },
        { ...lines[0], subtotal: 0 },
      ]) {
        await addItem(invoiceId, bad).expect(400);
      }
      await addItem(invoiceId, { ...lines[0], sourceType: InvoiceItemSourceType.PHARMACY }).expect(400);
      await addItem(invoiceId, { ...lines[0], unitPrice: 0 }).expect(400);
      await addItem(invoiceId, { ...lines[0], unitPrice: 1.234 }).expect(400);
      await addItem(invoiceId, { ...lines[0], quantity: 0 }).expect(400);
      expect(Number((await invoiceRow(invoiceId)).total)).toBeCloseTo(expected, 2);
    });

    it("the database itself rejects a total that doesn't match its line items", async () => {
      const { appointmentId } = await startEncounter();
      const invoiceId = await draftInvoiceId(appointmentId);
      const before = await invoiceRow(invoiceId);

      // total != subtotal + tax - discount → CHECK constraint.
      await expect(
        scoped(hospitalId, () => prisma.invoice.update({ where: { id: invoiceId }, data: { total: 1 } })),
      ).rejects.toThrow();
      // Internally consistent but not the items' sum → deferred trigger at commit.
      await expect(
        scoped(hospitalId, () => prisma.invoice.update({ where: { id: invoiceId }, data: { subtotal: 1, total: 1 } })),
      ).rejects.toThrow(/does not equal the sum of its line items/);
      // lineTotal != quantity × unitPrice → CHECK constraint.
      await expect(
        TenantContext.bypass(() =>
          prisma.invoiceItem.update({ where: { id: before.items[0].id }, data: { lineTotal: 1 } }),
        ),
      ).rejects.toThrow();
      // An item slipped in without recomputing the invoice → trigger at commit.
      await expect(
        TenantContext.bypass(() =>
          prisma.invoiceItem.create({
            data: {
              invoiceId,
              sourceType: InvoiceItemSourceType.OTHER,
              description: "sneaky",
              quantity: 1,
              unitPrice: 10,
              lineTotal: 10,
            },
          }),
        ),
      ).rejects.toThrow(/does not equal the sum of its line items/);

      const after = await expectTotalsConsistent(invoiceId);
      expect(after.total.toString()).toBe(before.total.toString());
      expect(after.items).toHaveLength(before.items.length);
    });
  });

  describe("finalization and corrections (FR-BILL-002)", () => {
    it("finalizes once; line items are then immutable and only credit lines are accepted", async () => {
      const { appointmentId } = await startEncounter();
      const invoiceId = await draftInvoiceId(appointmentId);
      await addItem(invoiceId, { sourceType: InvoiceItemSourceType.OTHER, description: "Kit", quantity: 1, unitPrice: 300 }).expect(201);

      const res = await finalize(invoiceId, accountantToken).expect(200);
      expect(res.body.data.status).toBe(InvoiceStatus.FINALIZED);
      const row = await invoiceRow(invoiceId);
      expect(row.finalizedBy).toBeTruthy();
      expect(row.finalizedAt).toBeTruthy();

      const again = await finalize(invoiceId).expect(409);
      expect(again.body.error.code).toBe("INVOICE_LOCKED");
      const charge = await addItem(invoiceId, {
        sourceType: InvoiceItemSourceType.OTHER,
        description: "Late add",
        quantity: 1,
        unitPrice: 50,
      }).expect(409);
      expect(charge.body.error.code).toBe("INVOICE_LOCKED");

      const credit = await addItem(invoiceId, {
        sourceType: InvoiceItemSourceType.OTHER,
        description: "Correction: kit not used",
        quantity: 1,
        unitPrice: -300,
      }).expect(201);
      expect(Number(credit.body.data.total)).toBe(CONSULTATION_FEE);
      await expectTotalsConsistent(invoiceId);

      const tooBig = await addItem(invoiceId, {
        sourceType: InvoiceItemSourceType.OTHER,
        description: "Over-credit",
        quantity: 1,
        unitPrice: -(CONSULTATION_FEE + 1),
      }).expect(422);
      expect(tooBig.body.error.code).toBe("VALIDATION_ERROR");

      // The database enforces the same immutability independently of the API.
      await expect(
        TenantContext.bypass(() =>
          prisma.invoiceItem.update({ where: { id: row.items[0].id }, data: { description: "edited" } }),
        ),
      ).rejects.toThrow(/immutable/);
      await expect(
        TenantContext.bypass(() => prisma.invoiceItem.delete({ where: { id: row.items[0].id } })),
      ).rejects.toThrow(/immutable/);
    });

    it("finalizes a fully-credited (zero-total) invoice straight to PAID", async () => {
      const { appointmentId } = await startEncounter();
      const invoiceId = await draftInvoiceId(appointmentId);
      await addItem(invoiceId, {
        sourceType: InvoiceItemSourceType.OTHER,
        description: "Waived consultation",
        quantity: 1,
        unitPrice: -CONSULTATION_FEE,
      }).expect(201);
      const res = await finalize(invoiceId).expect(200);
      expect(res.body.data.status).toBe(InvoiceStatus.PAID);
      expect(Number(res.body.data.total)).toBe(0);
    });

    it("restricts invoice writes to Receptionist and Accountant (403 for every other role)", async () => {
      const { appointmentId } = await startEncounter();
      const invoiceId = await draftInvoiceId(appointmentId);
      const line = { sourceType: InvoiceItemSourceType.OTHER, description: "x", quantity: 1, unitPrice: 1 };
      for (const token of nonBillingStaffTokens()) {
        await api().post("/api/invoices").set("Authorization", `Bearer ${token}`).send({ appointmentId }).expect(403);
        await addItem(invoiceId, line, token).expect(403);
        await finalize(invoiceId, token).expect(403);
        await api()
          .post(`/api/invoices/${invoiceId}/cash-payment`)
          .set("Authorization", `Bearer ${token}`)
          .send({ amount: 1 })
          .expect(403);
      }
      expect((await invoiceRow(invoiceId)).status).toBe(InvoiceStatus.DRAFT);
      await expectTotalsConsistent(invoiceId);
    });
  });

  describe("cash payments and receipts (FR-BILL-004/006)", () => {
    it("records partial then full cash payments, derives PARTIALLY_PAID/PAID, and notifies the patient each time", async () => {
      const { invoiceId } = await finalizedInvoice();
      const partial = await api()
        .post(`/api/invoices/${invoiceId}/cash-payment`)
        .set("Authorization", `Bearer ${receptionistToken}`)
        .send({ amount: 200 })
        .expect(201);
      expect(partial.body.data.invoice.status).toBe(InvoiceStatus.PARTIALLY_PAID);
      expect(Number(partial.body.data.invoice.balanceDue)).toBe(CONSULTATION_FEE - 200);
      expect(partial.body.data.receipt.method).toBe(PaymentMethod.CASH);

      const over = await api()
        .post(`/api/invoices/${invoiceId}/cash-payment`)
        .set("Authorization", `Bearer ${accountantToken}`)
        .send({ amount: CONSULTATION_FEE })
        .expect(422);
      expect(over.body.error.details.balanceDue).toBe("300.00");

      const rest = await api()
        .post(`/api/invoices/${invoiceId}/cash-payment`)
        .set("Authorization", `Bearer ${accountantToken}`)
        .send({ amount: 300 })
        .expect(201);
      expect(rest.body.data.invoice.status).toBe(InvoiceStatus.PAID);
      expect(Number(rest.body.data.invoice.amountPaid)).toBe(CONSULTATION_FEE);

      await api()
        .post(`/api/invoices/${invoiceId}/cash-payment`)
        .set("Authorization", `Bearer ${accountantToken}`)
        .send({ amount: 1 })
        .expect(409);

      const payments = (await invoiceRow(invoiceId)).payments;
      expect(payments.every((p) => p.status === PaymentStatus.SUCCEEDED && p.recordedBy)).toBe(true);
      const notes = await receiptNotifications(payments.map((p) => p.id));
      expect(notes).toHaveLength(2);
      expect(notes.every((n) => n.recipientUserId === patientUserId)).toBe(true);
    });

    it("refuses payment on a DRAFT invoice and validates the amount", async () => {
      const { appointmentId } = await startEncounter();
      const invoiceId = await draftInvoiceId(appointmentId);
      const url = `/api/invoices/${invoiceId}/cash-payment`;
      await api().post(url).set("Authorization", `Bearer ${receptionistToken}`).send({ amount: 10 }).expect(409);
      for (const amount of [0, -5, 1.001, "10"]) {
        await api().post(url).set("Authorization", `Bearer ${receptionistToken}`).send({ amount }).expect(400);
      }
      await api().post(url).set("Authorization", `Bearer ${receptionistToken}`).send({ amount: 10, status: "PAID" }).expect(400);
    });

    it("never over-collects under concurrent cash payments for the full balance", async () => {
      const { invoiceId } = await finalizedInvoice();
      const results = await Promise.all(
        [receptionistToken, accountantToken].map((token) =>
          api()
            .post(`/api/invoices/${invoiceId}/cash-payment`)
            .set("Authorization", `Bearer ${token}`)
            .send({ amount: CONSULTATION_FEE }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const row = await invoiceRow(invoiceId);
      expect(row.payments).toHaveLength(1);
      expect(row.status).toBe(InvoiceStatus.PAID);
    });
  });

  describe("online checkout (FR-BILL-004)", () => {
    it("creates a PENDING payment for the server-computed balance and changes nothing else", async () => {
      const { invoiceId } = await finalizedInvoice();
      await api()
        .post(`/api/invoices/${invoiceId}/cash-payment`)
        .set("Authorization", `Bearer ${receptionistToken}`)
        .send({ amount: 120.5 })
        .expect(201);

      const res = await startCheckout(invoiceId, PaymentProvider.STRIPE).expect(201);
      expect(res.body.data.checkoutUrl).toBeTruthy();
      expect(Number(res.body.data.amount)).toBeCloseTo(CONSULTATION_FEE - 120.5, 2);
      const call = checkoutCalls[checkoutCalls.length - 1];
      expect(call.req.amountMinor).toBe((CONSULTATION_FEE - 120.5) * 100);
      expect(call.req.paymentId).toBe(res.body.data.paymentId);

      const payment = await paymentRow(res.body.data.paymentId);
      expect(payment.status).toBe(PaymentStatus.PENDING);
      expect(payment.providerEventId).toBe(res.body.data.reference);
      expect((await invoiceRow(invoiceId)).status).toBe(InvoiceStatus.PARTIALLY_PAID);
    });

    it("lets only the invoice's own patient check out, only when there's something to pay", async () => {
      const { invoiceId } = await finalizedInvoice();
      await startCheckout(invoiceId, PaymentProvider.STRIPE, otherPatientToken).expect(404);
      await startCheckout(invoiceId, PaymentProvider.STRIPE, otherPatientSameNameToken).expect(404);
      await startCheckout(invoiceId, PaymentProvider.STRIPE, receptionistToken).expect(403);
      await startCheckout(invoiceId, "PAYPAL" as PaymentProvider).expect(400);
      await api()
        .post(`/api/invoices/${invoiceId}/checkout-session`)
        .set("Authorization", `Bearer ${patientToken}`)
        .send({ provider: PaymentProvider.STRIPE, amount: 1 })
        .expect(400);

      const { appointmentId } = await startEncounter();
      await startCheckout(await draftInvoiceId(appointmentId), PaymentProvider.STRIPE).expect(409);

      fakeCheckout.configured = false;
      try {
        const res = await startCheckout(invoiceId, PaymentProvider.RAZORPAY).expect(503);
        expect(res.body.error.code).toBe("PAYMENT_PROVIDER_UNAVAILABLE");
      } finally {
        fakeCheckout.configured = true;
      }
      expect((await invoiceRow(invoiceId)).payments).toHaveLength(0);
    });
  });

  describe("Stripe webhooks (FR-BILL-004/005, SEC-PAY-002/003)", () => {
    async function stripeCheckout() {
      const { invoiceId } = await finalizedInvoice();
      const res = await startCheckout(invoiceId, PaymentProvider.STRIPE).expect(201);
      return { invoiceId, paymentId: res.body.data.paymentId as string, sessionId: res.body.data.reference as string };
    }
    const completed = (sessionId: string, paymentId: string, invoiceId: string) =>
      stripeEvent("checkout.session.completed", {
        id: sessionId,
        payment_status: "paid",
        amount_total: CONSULTATION_FEE * 100,
        currency: "inr",
        metadata: { paymentId, invoiceId, hospitalId },
        customer_details: { email: "cardholder@example.test", name: "Card Holder" },
      });

    // Mandatory scenario #8 — the Phase 10 extra gate.
    it("rejects an invalid signature with 400 WEBHOOK_SIGNATURE_INVALID and changes nothing", async () => {
      const { invoiceId, paymentId, sessionId } = await stripeCheckout();
      const payload = completed(sessionId, paymentId, invoiceId);
      const good = signStripe(payload);

      const tampered = good.replace(/v1=([0-9a-f])/, (_m, c: string) => `v1=${c === "0" ? "1" : "0"}`);
      // Built lazily: each supertest request binds its own ephemeral server.
      const attempts = [
        () => postStripe(payload, tampered),
        () => postStripe(payload), // no header
        () => postStripe(payload, signStripe(payload, { secret: "whsec_attacker" })),
        () => postStripe(payload.replace(`"amount_total":${CONSULTATION_FEE * 100}`, '"amount_total":1'), good), // body altered after signing
        () => postStripe(payload, signStripe(payload, { timestamp: Math.floor(Date.now() / 1000) - 3600 })), // replayed/stale
      ];
      for (const attempt of attempts) {
        const res = await attempt().expect(400);
        expect(res.body.error.code).toBe("WEBHOOK_SIGNATURE_INVALID");
      }
      const payment = await paymentRow(paymentId);
      expect(payment.status).toBe(PaymentStatus.PENDING);
      expect(payment.providerSignatureVerified).toBe(false);
      const invoice = await invoiceRow(invoiceId);
      expect(invoice.status).toBe(InvoiceStatus.FINALIZED);
      expect(invoice.payments).toHaveLength(1);
    });

    it("settles the payment on a valid signed event; a redelivery is a 200 no-op (no double credit)", async () => {
      const { invoiceId, paymentId, sessionId } = await stripeCheckout();
      const payload = completed(sessionId, paymentId, invoiceId);
      const first = await postStripe(payload, signStripe(payload)).expect(200);
      expect(first.body.data).toEqual({ received: true, applied: true });

      const payment = await paymentRow(paymentId);
      expect(payment.status).toBe(PaymentStatus.SUCCEEDED);
      expect(payment.providerSignatureVerified).toBe(true);
      expect(Number(payment.amount)).toBe(CONSULTATION_FEE);
      // Only identifiers and amounts are kept from the provider payload, never cardholder data.
      expect(Object.keys(payment.rawPayloadSanitized as object).sort()).toEqual(
        ["amountMinor", "currency", "eventId", "eventType", "reference"].sort(),
      );
      expect(JSON.stringify(payment.rawPayloadSanitized)).not.toContain("cardholder@example.test");
      expect((await invoiceRow(invoiceId)).status).toBe(InvoiceStatus.PAID);

      for (let i = 0; i < 3; i += 1) {
        const dup = await postStripe(payload, signStripe(payload)).expect(200);
        expect(dup.body.data.applied).toBe(false);
      }
      // A different event id for the same session (e.g. async_payment_succeeded) is also a no-op.
      const other = stripeEvent("checkout.session.async_payment_succeeded", JSON.parse(payload).data.object);
      await postStripe(other, signStripe(other)).expect(200);

      const invoice = await invoiceRow(invoiceId);
      expect(invoice.payments.filter((p) => p.status === PaymentStatus.SUCCEEDED)).toHaveLength(1);
      expect(await receiptNotifications([paymentId])).toHaveLength(1);
    });

    it("processes concurrent duplicate deliveries exactly once", async () => {
      const { invoiceId, paymentId, sessionId } = await stripeCheckout();
      const payload = completed(sessionId, paymentId, invoiceId);
      const results = await Promise.all([1, 2, 3, 4].map(() => postStripe(payload, signStripe(payload))));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => r.body.data.applied === true)).toHaveLength(1);
      expect(await receiptNotifications([paymentId])).toHaveLength(1);
    });

    it("marks an expired checkout FAILED without touching the invoice; a later success can't resurrect it", async () => {
      const { invoiceId, paymentId, sessionId } = await stripeCheckout();
      const expired = stripeEvent("checkout.session.expired", {
        id: sessionId,
        payment_status: "unpaid",
        amount_total: CONSULTATION_FEE * 100,
        currency: "inr",
        metadata: { paymentId, invoiceId, hospitalId },
      });
      await postStripe(expired, signStripe(expired)).expect(200);
      expect((await paymentRow(paymentId)).status).toBe(PaymentStatus.FAILED);
      expect((await invoiceRow(invoiceId)).status).toBe(InvoiceStatus.FINALIZED);

      const late = completed(sessionId, paymentId, invoiceId);
      const res = await postStripe(late, signStripe(late)).expect(200);
      expect(res.body.data.applied).toBe(false);
      expect((await invoiceRow(invoiceId)).status).toBe(InvoiceStatus.FINALIZED);
    });

    it("acknowledges but ignores validly-signed events that aren't ours or aren't actionable", async () => {
      const unknown = stripeEvent("checkout.session.completed", {
        id: "cs_test_not_ours",
        payment_status: "paid",
        amount_total: 100,
        currency: "inr",
        metadata: {},
      });
      expect((await postStripe(unknown, signStripe(unknown)).expect(200)).body.data.applied).toBe(false);
      const unrelated = JSON.stringify({ id: "evt_x", object: "event", type: "customer.created", data: { object: { id: "cus_1" } } });
      expect((await postStripe(unrelated, signStripe(unrelated)).expect(200)).body.data.applied).toBe(false);
    });

    it("never lets a signed event for one payment settle a different one", async () => {
      const a = await stripeCheckout();
      const b = await stripeCheckout();
      // Signed, but claims payment A under session B's reference.
      const mixed = completed(b.sessionId, a.paymentId, a.invoiceId);
      expect((await postStripe(mixed, signStripe(mixed)).expect(200)).body.data.applied).toBe(false);
      expect((await paymentRow(a.paymentId)).status).toBe(PaymentStatus.PENDING);
      expect((await paymentRow(b.paymentId)).status).toBe(PaymentStatus.PENDING);
    });
  });

  describe("Razorpay webhooks (FR-BILL-004/005, SEC-PAY-002/003)", () => {
    it("verifies the HMAC signature, settles on payment.captured, and treats order.paid for the same order as a no-op", async () => {
      const { invoiceId } = await finalizedInvoice();
      const res = await startCheckout(invoiceId, PaymentProvider.RAZORPAY).expect(201);
      expect(res.body.data.keyId).toBe("rzp_test_key");
      const orderId = res.body.data.reference as string;
      const paymentId = res.body.data.paymentId as string;

      const captured = JSON.stringify({
        entity: "event",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_test_1",
              order_id: orderId,
              amount: CONSULTATION_FEE * 100,
              currency: "INR",
              status: "captured",
              email: "payer@example.test",
              contact: "+919999999999",
            },
          },
        },
        created_at: Math.floor(Date.now() / 1000),
      });

      for (const sig of [signRazorpay(captured, "wrong_secret"), "deadbeef", ""]) {
        const bad = await postRazorpay(captured, sig).expect(400);
        expect(bad.body.error.code).toBe("WEBHOOK_SIGNATURE_INVALID");
      }
      await postRazorpay(captured, null).expect(400);
      expect((await paymentRow(paymentId)).status).toBe(PaymentStatus.PENDING);

      const ok = await postRazorpay(captured, signRazorpay(captured)).expect(200);
      expect(ok.body.data.applied).toBe(true);
      const payment = await paymentRow(paymentId);
      expect(payment.status).toBe(PaymentStatus.SUCCEEDED);
      expect(JSON.stringify(payment.rawPayloadSanitized)).not.toMatch(/payer@example|9999999999/);
      expect((await invoiceRow(invoiceId)).status).toBe(InvoiceStatus.PAID);

      const orderPaid = JSON.stringify({
        entity: "event",
        event: "order.paid",
        payload: { order: { entity: { id: orderId, amount_paid: CONSULTATION_FEE * 100, currency: "INR" } } },
      });
      expect((await postRazorpay(orderPaid, signRazorpay(orderPaid)).expect(200)).body.data.applied).toBe(false);
      expect((await invoiceRow(invoiceId)).payments.filter((p) => p.status === PaymentStatus.SUCCEEDED)).toHaveLength(1);
    });
  });

  describe("viewing and tenancy (§3.8, mandatory scenario #9)", () => {
    it("lets the patient view only their own invoice; staff per the matrix", async () => {
      const { invoiceId } = await finalizedInvoice();
      const own = await api().get(`/api/invoices/${invoiceId}`).set("Authorization", `Bearer ${patientToken}`).expect(200);
      expect(own.body.data.items).toHaveLength(1);
      expect(own.body.data.payments).toEqual([]);
      await api().get(`/api/invoices/${invoiceId}`).set("Authorization", `Bearer ${otherPatientToken}`).expect(404);
      for (const token of [receptionistToken, accountantToken, adminToken]) {
        await api().get(`/api/invoices/${invoiceId}`).set("Authorization", `Bearer ${token}`).expect(200);
      }
      for (const token of [doctorToken, nurseToken, labToken, pharmacistToken]) {
        await api().get(`/api/invoices/${invoiceId}`).set("Authorization", `Bearer ${token}`).expect(403);
      }
      await api().get("/api/invoices").set("Authorization", `Bearer ${patientToken}`).expect(403);
      await api().get("/api/invoices").set("Authorization", `Bearer ${adminToken}`).expect(200);
    });

    it("returns 404 for every invoice operation from another hospital, and writes nothing", async () => {
      const { invoiceId, appointmentId } = await finalizedInvoice();
      const t = otherReceptionistToken;
      await api().get(`/api/invoices/${invoiceId}`).set("Authorization", `Bearer ${t}`).expect(404);
      await addItem(invoiceId, { sourceType: InvoiceItemSourceType.OTHER, description: "x", quantity: 1, unitPrice: -1 }, t).expect(404);
      await finalize(invoiceId, t).expect(404);
      await api().post(`/api/invoices/${invoiceId}/cash-payment`).set("Authorization", `Bearer ${t}`).send({ amount: 1 }).expect(404);
      await api().post("/api/invoices").set("Authorization", `Bearer ${t}`).send({ appointmentId }).expect(404);
      await startCheckout(invoiceId, PaymentProvider.STRIPE, otherPatientSameNameToken).expect(404);
      const list = await api().get(`/api/invoices?appointmentId=${appointmentId}`).set("Authorization", `Bearer ${t}`).expect(200);
      expect(list.body.data).toEqual([]);

      const row = await invoiceRow(invoiceId);
      expect(row.payments).toHaveLength(0);
      expect(row.items).toHaveLength(1);
      expect(await invoicesFor(appointmentId)).toHaveLength(1);
      void otherPatientProfileId;
    });
  });
});
