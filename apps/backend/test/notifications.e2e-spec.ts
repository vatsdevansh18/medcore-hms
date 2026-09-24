import "./helpers/notification-test-env";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import * as bcrypt from "bcrypt";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { Job } from "bullmq";
import { io, type Socket } from "socket.io-client";
import {
  AppointmentStatus,
  HospitalStatus,
  InvoiceStatus,
  MedicineForm,
  NOTIFICATIONS_NAMESPACE,
  NotificationChannel,
  NotificationSocketEvent,
  NotificationStatus,
  NotificationType,
  PrescriptionFrequency,
  UserRole,
  UserStatus,
  type NotificationView,
} from "@medcore/types";
import { AppModule } from "../src/app.module";
import { PRISMA_CLIENT } from "../src/prisma/prisma.module";
import type { ExtendedPrismaClient } from "../src/prisma/prisma-client.factory";
import { TenantContext } from "../src/common/tenancy/tenant-context";
import { configureApp } from "../src/common/bootstrap/configure-app";
import { validateEnv } from "../src/config/env.validation";
import {
  EMAIL_SENDER,
  PermanentDeliveryError,
  SMS_SENDER,
  type OutboundEmail,
  type OutboundSms,
} from "../src/common/messaging/messaging.types";
import { NotificationsService } from "../src/notifications/notifications.service";
import { NotificationDispatcher } from "../src/notifications/notification-dispatcher.service";
import { NotificationOutboxSweepProcessor } from "../src/notifications/notification-outbox.sweep";
import { NOTIFICATION_TRIGGERS } from "../src/notifications/notification-triggers";
import { AppointmentReminderProcessor } from "../src/queue/appointment-reminder.processor";
import { AppointmentReminderQueueService } from "../src/queue/appointment-reminder-queue.service";
import type { AppointmentReminderJobData } from "../src/queue/queue.constants";
import { purgeBilling } from "./helpers/billing-cleanup";

type FailMode = null | "transient" | "permanent";

/** A controllable stand-in for a provider SDK (only the outbound network
 * hop is replaced; everything from the domain write to the delivery log is
 * real). */
function fakeSender<M extends { to: string }>(provider: string) {
  const sender = {
    provider,
    configured: true,
    failMode: null as FailMode,
    sent: [] as M[],
    isConfigured: () => sender.configured,
    send: async (message: M) => {
      if (sender.failMode === "permanent") throw new PermanentDeliveryError(`${provider}: invalid destination`);
      if (sender.failMode === "transient") throw new Error(`${provider}: 503 upstream unavailable`);
      sender.sent.push(message);
      return { provider, providerMessageId: randomUUID(), deliveredTo: message.to };
    },
  };
  return sender;
}

/** Polls until `check` stops throwing (async work: queues, sockets). */
async function eventually<T>(check: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

/**
 * Phase 11 — Notifications & Background Jobs. FR-NOTIF-001..003,
 * NFR-AVAIL-002/003, SEC-NOTIF-001..005, docs/11-DECISIONS.md D-032/D-033.
 *
 * Covers: every brief §7.8 trigger raising the right event to the right
 * people on the right channels; the outbox → dispatcher → per-channel queue
 * → worker → delivery-log pipeline; channel failure isolation, retries and
 * dead-lettering; crash recovery by the sweep; idempotency under duplicate
 * and concurrent triggers; the Socket.IO gateway's authentication and
 * per-user isolation; `GET /notifications/me` / `PATCH /notifications/:id/read`
 * ownership and tenancy; content minimisation; and Bull Board gating.
 */
describe("Notifications (e2e)", () => {
  let app: INestApplication;
  let prisma: ExtendedPrismaClient;
  let notifications: NotificationsService;
  let dispatcher: NotificationDispatcher;
  let baseUrl: string;
  let jwtSecret: string;
  const suffix = randomUUID().slice(0, 8);
  const PASSWORD = "Passw0rd!";

  const email = fakeSender<OutboundEmail>("fake-email");
  const sms = fakeSender<OutboundSms>("fake-sms");

  let hospitalId: string;
  let otherHospitalId: string;
  let deptId: string;
  let doctorProfileId: string;
  let doctorUserId: string;
  let patientProfileId: string;
  let patientUserId: string;
  let unverifiedPatientUserId: string;
  let otherPatientUserId: string;
  let otherHospitalPatientUserId: string;
  let disabledUserId: string;
  let superAdminUserId: string;
  let medicineId: string;

  let receptionistToken: string;
  let doctorToken: string;
  let patientToken: string;
  let otherPatientToken: string;
  let otherHospitalPatientToken: string;
  let superAdminToken: string;

  const createdUserIds: string[] = [];
  const createdHospitalIds: string[] = [];
  const createdAppointmentIds: string[] = [];
  const sockets: Socket[] = [];

  const api = () => request(app.getHttpServer());

  function scoped<T>(hId: string, fn: () => Promise<T>): Promise<T> {
    return TenantContext.run({ hospitalId: hId, userId: null, bypassTenancy: false }, fn);
  }

  async function createUser(
    hId: string | null,
    role: UserRole,
    label: string,
    extra: { phone?: string; phoneVerifiedAt?: Date; status?: UserStatus } = {},
  ) {
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const create = () =>
      prisma.user.create({
        data: {
          hospitalId: hId,
          email: `${label}-${suffix}@test.medcore.test`,
          passwordHash,
          firstName: "Test",
          lastName: label,
          role,
          status: extra.status ?? UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
          phone: extra.phone,
          phoneVerifiedAt: extra.phoneVerifiedAt,
        },
      });
    const user = hId ? await scoped(hId, create) : await TenantContext.bypass(create);
    createdUserIds.push(user.id);
    return user;
  }

  async function login(address: string): Promise<string> {
    const res = await api().post("/api/auth/login").send({ email: address, password: PASSWORD }).expect(200);
    return res.body.data.accessToken as string;
  }

  function rowsFor(where: { type?: string; relatedEntityId?: string; recipientUserId?: string }) {
    return TenantContext.bypass(() => prisma.notification.findMany({ where, orderBy: { createdAt: "asc" } }));
  }

  function logsFor(notificationId: string) {
    return prisma.notificationDeliveryLog.findMany({ where: { notificationId }, orderBy: { attemptedAt: "asc" } });
  }

  /** Waits until every channel of the notification has a terminal log
   * (SENT/SKIPPED) or its job has been dead-lettered, and returns the logs. */
  async function settled(notificationId: string) {
    return eventually(async () => {
      const n = await TenantContext.bypass(() => prisma.notification.findUniqueOrThrow({ where: { id: notificationId } }));
      const logs = await logsFor(notificationId);
      for (const channel of n.channels) {
        const terminal = logs.some(
          (l) => l.channel === channel && (l.status === NotificationStatus.SENT || l.status === NotificationStatus.SKIPPED),
        );
        const job = await dispatcher.channelJobState(notificationId, channel);
        if (!terminal && job?.state !== "failed") throw new Error(`${channel} not settled yet`);
      }
      return logs;
    });
  }

  let apptOffsetMinutes = 0;
  async function createAppointment(status: string, patientId = patientProfileId) {
    apptOffsetMinutes += 60;
    const start = Date.now() + 3 * 24 * 60 * 60_000 + apptOffsetMinutes * 60_000;
    const appt = await scoped(hospitalId, () =>
      prisma.appointment.create({
        data: {
          hospitalId,
          patientId,
          doctorId: doctorProfileId,
          departmentId: deptId,
          scheduledStart: new Date(start),
          scheduledEnd: new Date(start + 1_800_000),
          status: status as (typeof AppointmentStatus)[keyof typeof AppointmentStatus],
          createdBy: "system-test",
        },
      }),
    );
    createdAppointmentIds.push(appt.id);
    return appt;
  }

  function confirm(appointmentId: string) {
    return api()
      .patch(`/api/appointments/${appointmentId}/status`)
      .set("Authorization", `Bearer ${receptionistToken}`)
      .send({ status: AppointmentStatus.CONFIRMED });
  }

  /** Records a notification directly through the service (the same call
   * every producer makes) and publishes it. */
  async function raise(type: NotificationType, recipientUserId: string, hId = hospitalId, body = "Test body") {
    const key = randomUUID();
    await scoped(hId, () =>
      notifications.record(prisma, {
        type,
        hospitalId: hId,
        recipientUserIds: [recipientUserId],
        title: `Test ${type}`,
        body,
        relatedEntityType: "Test",
        relatedEntityId: key,
        dedupeKey: `TEST:${key}`,
      }),
    );
    notifications.publish();
    const [row] = await rowsFor({ relatedEntityId: key });
    return row!;
  }

  function connect(token?: string): Socket {
    const socket = io(`${baseUrl}${NOTIFICATIONS_NAMESPACE}`, {
      auth: token === undefined ? {} : { token },
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    return socket;
  }

  function connected(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (err) => reject(err));
    });
  }

  function rejected(socket: Socket): Promise<string> {
    return new Promise((resolve, reject) => {
      socket.once("connect", () => reject(new Error("connected, but should have been rejected")));
      socket.once("connect_error", (err) => resolve(err.message));
    });
  }

  function received(socket: Socket): NotificationView[] {
    const inbox: NotificationView[] = [];
    socket.on(NotificationSocketEvent.NEW, (n: NotificationView) => inbox.push(n));
    return inbox;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(email)
      .overrideProvider(SMS_SENDER)
      .useValue(sms)
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PRISMA_CLIENT);
    notifications = app.get(NotificationsService);
    dispatcher = app.get(NotificationDispatcher);
    jwtSecret = app.get(ConfigService).getOrThrow<string>("JWT_ACCESS_SECRET");

    const mkHospital = (label: string) =>
      TenantContext.bypass(() =>
        prisma.hospital.create({
          data: {
            name: `Notif ${label} ${suffix}`,
            slug: `notif-${label}-${suffix}`,
            status: HospitalStatus.ACTIVE,
            contactEmail: `notif-${label}-${suffix}@test.medcore.test`,
          },
        }),
      );
    hospitalId = (await mkHospital("a")).id;
    otherHospitalId = (await mkHospital("b")).id;
    createdHospitalIds.push(hospitalId, otherHospitalId);
    deptId = (await scoped(hospitalId, () => prisma.department.create({ data: { hospitalId, name: "General" } }))).id;

    const verifiedAt = new Date();
    const receptionist = await createUser(hospitalId, UserRole.RECEPTIONIST, "rec");
    const doctor = await createUser(hospitalId, UserRole.DOCTOR, "doc", { phone: "+15005550010", phoneVerifiedAt: verifiedAt });
    const patient = await createUser(hospitalId, UserRole.PATIENT, "pat", { phone: "+15005550011", phoneVerifiedAt: verifiedAt });
    const unverified = await createUser(hospitalId, UserRole.PATIENT, "pat-unverified", { phone: "+15005550012" });
    const otherPatient = await createUser(hospitalId, UserRole.PATIENT, "pat2");
    const otherHospitalPatient = await createUser(otherHospitalId, UserRole.PATIENT, "pat-other-hospital");
    const disabled = await createUser(hospitalId, UserRole.PATIENT, "pat-disabled", { status: UserStatus.DISABLED });
    const superAdmin = await createUser(null, UserRole.SUPER_ADMIN, "sa");
    doctorUserId = doctor.id;
    patientUserId = patient.id;
    unverifiedPatientUserId = unverified.id;
    otherPatientUserId = otherPatient.id;
    otherHospitalPatientUserId = otherHospitalPatient.id;
    disabledUserId = disabled.id;
    superAdminUserId = superAdmin.id;

    doctorProfileId = (
      await scoped(hospitalId, () =>
        prisma.doctorProfile.create({
          data: {
            userId: doctor.id,
            hospitalId,
            departmentId: deptId,
            specialization: "General Medicine",
            licenseNumber: `LIC-N-${suffix}`,
            consultationFee: 500,
          },
        }),
      )
    ).id;
    patientProfileId = (await scoped(hospitalId, () => prisma.patientProfile.create({ data: { userId: patient.id, hospitalId } }))).id;
    medicineId = (
      await scoped(hospitalId, () =>
        prisma.medicine.create({
          data: { hospitalId, name: `Amoxicillin ${suffix}`, form: MedicineForm.CAPSULE, unit: "capsule", reorderLevel: 0 },
        }),
      )
    ).id;

    receptionistToken = await login(receptionist.email);
    doctorToken = await login(doctor.email);
    patientToken = await login(patient.email);
    otherPatientToken = await login(otherPatient.email);
    otherHospitalPatientToken = await login(otherHospitalPatient.email);
    superAdminToken = await login(superAdmin.email);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    const reminders = app.get(AppointmentReminderQueueService);
    await Promise.all(createdAppointmentIds.map((id) => reminders.cancelReminders(id).catch(() => undefined)));
    await TenantContext.bypass(async () => {
      const where = { hospitalId: { in: createdHospitalIds } };
      await prisma.notification.deleteMany({ where });
      await prisma.notification.deleteMany({ where: { recipientUserId: { in: createdUserIds } } });
      await prisma.prescriptionItem.deleteMany({ where: { prescription: where } });
      await prisma.prescription.deleteMany({ where });
      await prisma.medicalRecord.deleteMany({ where });
    });
    await purgeBilling(prisma, createdHospitalIds);
    await TenantContext.bypass(async () => {
      const where = { hospitalId: { in: createdHospitalIds } };
      await prisma.appointment.deleteMany({ where });
      await prisma.medicine.deleteMany({ where });
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

  beforeEach(() => {
    email.configured = true;
    email.failMode = null;
    sms.configured = true;
    sms.failMode = null;
  });

  describe("trigger table (brief §7.8, FR-NOTIF-001/002)", () => {
    it("channels are decided centrally by the trigger table, never by producers", () => {
      const { EMAIL, SMS, IN_APP } = NotificationChannel;
      const table = Object.fromEntries(Object.entries(NOTIFICATION_TRIGGERS).map(([k, v]) => [k, v.channels]));
      expect(table).toEqual({
        APPOINTMENT_CONFIRMED: [EMAIL, SMS, IN_APP],
        APPOINTMENT_REMINDER: [EMAIL, SMS],
        LAB_RESULT_APPROVED: [EMAIL, IN_APP],
        PRESCRIPTION_READY: [SMS, IN_APP],
        INVOICE_GENERATED: [EMAIL, IN_APP],
        PAYMENT_RECEIVED: [EMAIL, SMS],
        LOW_STOCK_ALERT: [EMAIL, IN_APP],
        EMERGENCY_APPOINTMENT: [IN_APP, SMS],
        MEDICINE_EXPIRY_DIGEST: [EMAIL, IN_APP],
      });
    });

    it("appointment confirmed: patient gets Email + SMS + In-app, each delivered by its own worker", async () => {
      const appt = await createAppointment(AppointmentStatus.PENDING);
      await confirm(appt.id).expect(200);

      const [row] = await rowsFor({ type: NotificationType.APPOINTMENT_CONFIRMED, relatedEntityId: appt.id });
      expect(row).toBeDefined();
      expect(row!.recipientUserId).toBe(patientUserId);
      expect(row!.hospitalId).toBe(hospitalId);
      expect(row!.body).toMatch(/Dr\. Test doc/);

      const logs = await settled(row!.id);
      const sent = logs.filter((l) => l.status === NotificationStatus.SENT).map((l) => l.channel).sort();
      expect(sent).toEqual([NotificationChannel.EMAIL, NotificationChannel.IN_APP, NotificationChannel.SMS]);
      expect(logs.find((l) => l.channel === NotificationChannel.EMAIL)!.provider).toBe("fake-email");
      expect(email.sent.some((m) => m.to === `pat-${suffix}@test.medcore.test` && m.subject.includes("Appointment confirmed"))).toBe(true);
      expect(sms.sent.some((m) => m.to === "+15005550011")).toBe(true);

      const dispatched = await TenantContext.bypass(() => prisma.notification.findUniqueOrThrow({ where: { id: row!.id } }));
      expect(dispatched.dispatchedAt).not.toBeNull();
    });

    it("a duplicate/concurrent confirmation raises exactly one notification", async () => {
      const appt = await createAppointment(AppointmentStatus.PENDING);
      const results = await Promise.all([confirm(appt.id), confirm(appt.id), confirm(appt.id)]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect(statuses.every((s) => s === 200 || s === 400 || s === 409)).toBe(true);
      const rows = await rowsFor({ type: NotificationType.APPOINTMENT_CONFIRMED, relatedEntityId: appt.id });
      expect(rows).toHaveLength(1);
    });

    it("emergency appointment: the doctor gets In-app + SMS, with no patient detail in the text", async () => {
      const res = await api()
        .post("/api/appointments/emergency")
        .set("Authorization", `Bearer ${receptionistToken}`)
        .send({ patientId: patientProfileId, doctorId: doctorProfileId, reasonForVisit: "Chest pain" })
        .expect(201);
      createdAppointmentIds.push(res.body.data.id);
      const [row] = await rowsFor({ type: NotificationType.EMERGENCY_APPOINTMENT, relatedEntityId: res.body.data.id });
      expect(row!.recipientUserId).toBe(doctorUserId);
      expect(row!.channels).toEqual([NotificationChannel.IN_APP, NotificationChannel.SMS]);
      expect(row!.body).not.toMatch(/Chest pain|pat/i);
      await settled(row!.id);
      expect(sms.sent.some((m) => m.to === "+15005550010" && m.body.includes("emergency"))).toBe(true);
    });

    it("appointment reminder job: Email + SMS to the patient, idempotent across job retries", async () => {
      const appt = await createAppointment(AppointmentStatus.CONFIRMED);
      const processor = app.get(AppointmentReminderProcessor);
      const job = { data: { appointmentId: appt.id, window: "24h" } } as Job<AppointmentReminderJobData>;
      await processor.process(job);
      await processor.process(job); // a BullMQ retry of the same job
      const rows = await rowsFor({ type: NotificationType.APPOINTMENT_REMINDER, relatedEntityId: appt.id });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.channels).toEqual([NotificationChannel.EMAIL, NotificationChannel.SMS]);
      expect(rows[0]!.recipientUserId).toBe(patientUserId);

      // The other window is a separate event.
      await processor.process({ data: { appointmentId: appt.id, window: "1h" } } as Job<AppointmentReminderJobData>);
      expect(await rowsFor({ type: NotificationType.APPOINTMENT_REMINDER, relatedEntityId: appt.id })).toHaveLength(2);
    });

    it("a cancelled appointment's reminder raises nothing", async () => {
      const appt = await createAppointment(AppointmentStatus.CANCELLED);
      await app.get(AppointmentReminderProcessor).process({ data: { appointmentId: appt.id, window: "1h" } } as Job<AppointmentReminderJobData>);
      expect(await rowsFor({ type: NotificationType.APPOINTMENT_REMINDER, relatedEntityId: appt.id })).toHaveLength(0);
    });

    it("prescription issued, invoice finalized, and cash payment each notify the patient on their channels", async () => {
      const appt = await createAppointment(AppointmentStatus.IN_PROGRESS);
      const record = await api()
        .post("/api/medical-records")
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({ appointmentId: appt.id, chiefComplaint: "Cough" })
        .expect(201);

      const rx = await api()
        .post("/api/prescriptions")
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({
          medicalRecordId: record.body.data.id,
          items: [{ medicineId, dosage: "500mg", frequency: PrescriptionFrequency.TDS, durationDays: 5, quantityPrescribed: 15 }],
        })
        .expect(201);
      const [rxRow] = await rowsFor({ type: NotificationType.PRESCRIPTION_READY, relatedEntityId: rx.body.data.id });
      expect(rxRow!.recipientUserId).toBe(patientUserId);
      expect(rxRow!.channels).toEqual([NotificationChannel.SMS, NotificationChannel.IN_APP]);
      expect(rxRow!.body).not.toContain("Amoxicillin");

      const invoice = await TenantContext.bypass(() =>
        prisma.invoice.findFirstOrThrow({ where: { appointmentId: appt.id, status: InvoiceStatus.DRAFT } }),
      );
      await api().patch(`/api/invoices/${invoice.id}/finalize`).set("Authorization", `Bearer ${receptionistToken}`).expect(200);
      const invRows = await rowsFor({ type: NotificationType.INVOICE_GENERATED, relatedEntityId: invoice.id });
      expect(invRows).toHaveLength(1);
      expect(invRows[0]!.channels).toEqual([NotificationChannel.EMAIL, NotificationChannel.IN_APP]);

      const paid = await api()
        .post(`/api/invoices/${invoice.id}/cash-payment`)
        .set("Authorization", `Bearer ${receptionistToken}`)
        .send({ amount: 100 })
        .expect(201);
      const payRows = await rowsFor({ type: NotificationType.PAYMENT_RECEIVED, relatedEntityId: paid.body.data.receipt.paymentId });
      expect(payRows).toHaveLength(1);
      expect(payRows[0]!.channels).toEqual([NotificationChannel.EMAIL, NotificationChannel.SMS]);

      for (const row of [rxRow!, invRows[0]!, payRows[0]!]) {
        const logs = await settled(row.id);
        expect(logs.every((l) => l.status === NotificationStatus.SENT)).toBe(true);
      }
    });
  });

  describe("delivery rules", () => {
    it("SMS goes only to a verified phone; otherwise SKIPPED, never sent (SEC-NOTIF-004)", async () => {
      const unverified = await raise(NotificationType.APPOINTMENT_CONFIRMED, unverifiedPatientUserId);
      const noPhone = await raise(NotificationType.APPOINTMENT_CONFIRMED, otherPatientUserId);
      const smsLog = async (id: string) => (await settled(id)).find((l) => l.channel === NotificationChannel.SMS)!;
      expect(await smsLog(unverified.id)).toMatchObject({ status: NotificationStatus.SKIPPED, errorMessage: "PHONE_NOT_VERIFIED" });
      expect(await smsLog(noPhone.id)).toMatchObject({ status: NotificationStatus.SKIPPED, errorMessage: "NO_PHONE" });
      expect(sms.sent.some((m) => m.to === "+15005550012")).toBe(false);
    });

    it("an unconfigured provider is SKIPPED (PROVIDER_NOT_CONFIGURED), not reported as sent", async () => {
      email.configured = false;
      const row = await raise(NotificationType.INVOICE_GENERATED, patientUserId);
      const logs = await settled(row.id);
      expect(logs.find((l) => l.channel === NotificationChannel.EMAIL)).toMatchObject({
        status: NotificationStatus.SKIPPED,
        errorMessage: "PROVIDER_NOT_CONFIGURED",
      });
      expect(logs.find((l) => l.channel === NotificationChannel.IN_APP)!.status).toBe(NotificationStatus.SENT);
    });

    it("a disabled recipient gets nothing on any channel", async () => {
      const row = await raise(NotificationType.APPOINTMENT_CONFIRMED, disabledUserId);
      const logs = await settled(row.id);
      expect(logs).toHaveLength(3);
      expect(logs.every((l) => l.status === NotificationStatus.SKIPPED && l.errorMessage === "RECIPIENT_INACTIVE")).toBe(true);
    });

    it("clinically sensitive events send no clinical detail by email (SEC-NOTIF-003)", async () => {
      const secret = `Potassium ${suffix} 6.9 mmol/L`;
      const row = await raise(NotificationType.LAB_RESULT_APPROVED, patientUserId, hospitalId, secret);
      await settled(row.id);
      const mail = email.sent.find((m) => m.idempotencyKey === `${row.id}-EMAIL`);
      expect(mail).toBeDefined();
      expect(mail!.text).not.toContain(suffix);
      expect(mail!.subject).not.toMatch(/lab/i);
      // In-app (behind authentication) keeps the full body.
      const history = await api().get("/api/notifications/me").set("Authorization", `Bearer ${patientToken}`).expect(200);
      expect(history.body.data.find((n: NotificationView) => n.id === row.id).body).toBe(secret);
    });
  });

  describe("failure isolation, retries, dead-lettering (FR-NOTIF-002, NFR-AVAIL-002/003)", () => {
    it("a failing SMS provider is retried 3 times then dead-lettered, while Email and In-app still deliver and the domain change stands", async () => {
      sms.failMode = "transient";
      const appt = await createAppointment(AppointmentStatus.PENDING);
      await confirm(appt.id).expect(200);
      const stored = await TenantContext.bypass(() => prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } }));
      expect(stored.status).toBe(AppointmentStatus.CONFIRMED);

      const [row] = await rowsFor({ type: NotificationType.APPOINTMENT_CONFIRMED, relatedEntityId: appt.id });
      const logs = await settled(row!.id);
      const smsLogs = logs.filter((l) => l.channel === NotificationChannel.SMS);
      expect(smsLogs.map((l) => [l.attempt, l.status])).toEqual([
        [1, NotificationStatus.FAILED],
        [2, NotificationStatus.FAILED],
        [3, NotificationStatus.FAILED],
      ]);
      expect(smsLogs[0]!.errorMessage).toContain("503");
      expect(await dispatcher.channelJobState(row!.id, NotificationChannel.SMS)).toEqual({ state: "failed", attemptsMade: 3 });
      expect(logs.filter((l) => l.status === NotificationStatus.SENT).map((l) => l.channel).sort()).toEqual([
        NotificationChannel.EMAIL,
        NotificationChannel.IN_APP,
      ]);
    });

    it("a transient failure that recovers is SENT on a later attempt", async () => {
      // Fail exactly one attempt of exactly this message, so no other
      // in-flight SMS job can consume the injected failure.
      const marker = `recover-${randomUUID()}`;
      let failures = 1;
      const original = sms.send;
      sms.send = async (m: OutboundSms) => {
        if (m.body.includes(marker) && failures-- > 0) throw new Error("fake-sms: 429 rate limited");
        return original(m);
      };
      try {
        const row = await raise(NotificationType.APPOINTMENT_CONFIRMED, patientUserId, hospitalId, marker);
        const smsLogs = (await settled(row.id)).filter((l) => l.channel === NotificationChannel.SMS);
        expect(smsLogs.map((l) => [l.attempt, l.status])).toEqual([
          [1, NotificationStatus.FAILED],
          [2, NotificationStatus.SENT],
        ]);
      } finally {
        sms.send = original;
      }
    });

    it("a permanent provider rejection is not retried", async () => {
      email.failMode = "permanent";
      const row = await raise(NotificationType.INVOICE_GENERATED, patientUserId);
      const emailLogs = (await settled(row.id)).filter((l) => l.channel === NotificationChannel.EMAIL);
      expect(emailLogs).toHaveLength(1);
      expect(emailLogs[0]!.status).toBe(NotificationStatus.FAILED);
      expect(await dispatcher.channelJobState(row.id, NotificationChannel.EMAIL)).toEqual({ state: "failed", attemptsMade: 1 });
    });

    it("a lost post-commit signal (crash between commit and publish) is recovered by the outbox sweep", async () => {
      const key = randomUUID();
      await scoped(hospitalId, () =>
        notifications.record(prisma, {
          type: NotificationType.INVOICE_GENERATED,
          hospitalId,
          recipientUserIds: [patientUserId],
          title: "Recovered",
          body: "Recovered",
          relatedEntityId: key,
          dedupeKey: `TEST:${key}`,
        }),
      );
      // No publish(). Age it past the sweep's minimum so it counts as missed.
      const [row] = await rowsFor({ relatedEntityId: key });
      await TenantContext.bypass(() =>
        prisma.notification.update({ where: { id: row!.id }, data: { createdAt: new Date(Date.now() - 60_000) } }),
      );
      expect(await dispatcher.channelJobState(row!.id, NotificationChannel.EMAIL)).toBeNull();

      const recovered = await app.get(NotificationOutboxSweepProcessor).process();
      expect(recovered).toBeGreaterThanOrEqual(1);
      const logs = await settled(row!.id);
      expect(logs.filter((l) => l.status === NotificationStatus.SENT)).toHaveLength(2);
    });

    it("dispatches a just-committed row even when the DB clock runs ahead of the API's (regression)", async () => {
      const key = randomUUID();
      await scoped(hospitalId, () =>
        notifications.record(prisma, {
          type: NotificationType.INVOICE_GENERATED,
          hospitalId,
          recipientUserIds: [patientUserId],
          title: "Skew",
          body: "Skew",
          relatedEntityId: key,
          dedupeKey: `TEST:${key}`,
        }),
      );
      const [row] = await rowsFor({ relatedEntityId: key });
      await TenantContext.bypass(() =>
        prisma.notification.update({ where: { id: row!.id }, data: { createdAt: new Date(Date.now() + 5_000) } }),
      );
      await dispatcher.drain();
      expect(await dispatcher.channelJobState(row!.id, NotificationChannel.EMAIL)).not.toBeNull();
    });

    it("a failing event bus never fails the request; the row waits for the sweep", async () => {
      const spy = jest.spyOn(dispatcher, "drain").mockRejectedValue(new Error("redis down"));
      try {
        const appt = await createAppointment(AppointmentStatus.PENDING);
        await confirm(appt.id).expect(200);
        const [row] = await rowsFor({ type: NotificationType.APPOINTMENT_CONFIRMED, relatedEntityId: appt.id });
        expect(row!.dispatchedAt).toBeNull();
      } finally {
        spy.mockRestore();
      }
    });

    it("concurrent drains (two instances / signal + sweep) deliver each channel exactly once", async () => {
      const key = randomUUID();
      await scoped(hospitalId, () =>
        notifications.record(prisma, {
          type: NotificationType.APPOINTMENT_CONFIRMED,
          hospitalId,
          recipientUserIds: [patientUserId],
          title: "Once",
          body: "Once",
          relatedEntityId: key,
          dedupeKey: `TEST:${key}`,
        }),
      );
      await Promise.all([dispatcher.drainOnce(0), dispatcher.drainOnce(0), dispatcher.drainOnce(0), dispatcher.drain()]);
      const [row] = await rowsFor({ relatedEntityId: key });
      const logs = await settled(row!.id);
      await new Promise((r) => setTimeout(r, 500)); // any duplicate job would have run by now
      const sent = (await logsFor(row!.id)).filter((l) => l.status === NotificationStatus.SENT);
      expect(sent.map((l) => l.channel).sort()).toEqual([
        NotificationChannel.EMAIL,
        NotificationChannel.IN_APP,
        NotificationChannel.SMS,
      ]);
      expect(logs.length).toBe(3);
    });

    it("recording the same event twice (same dedupe key) creates one row", async () => {
      const event = {
        type: NotificationType.LOW_STOCK_ALERT,
        hospitalId,
        recipientUserIds: [patientUserId, patientUserId, null],
        title: "Dup",
        body: "Dup",
        dedupeKey: `TEST:${randomUUID()}`,
      };
      const first = await scoped(hospitalId, () => notifications.record(prisma, event));
      const second = await scoped(hospitalId, () => notifications.record(prisma, event));
      expect([first, second]).toEqual([1, 0]);
    });
  });

  describe("Socket.IO gateway (FR-NOTIF-003, SEC-NOTIF-001)", () => {
    it("rejects a handshake with no token, a forged token, an expired token, or a disabled account", async () => {
      const forged = new JwtService({ secret: "not-the-real-secret-not-the-real-secret" }).sign({
        sub: patientUserId,
        hospitalId,
        role: UserRole.PATIENT,
        jti: randomUUID(),
      });
      const real = new JwtService({ secret: jwtSecret });
      const expired = real.sign(
        { sub: patientUserId, hospitalId, role: UserRole.PATIENT, jti: randomUUID(), exp: Math.floor(Date.now() / 1000) - 60 },
      );
      const disabled = real.sign({ sub: disabledUserId, hospitalId, role: UserRole.PATIENT, jti: randomUUID() }, { expiresIn: "5m" });
      for (const token of [undefined, "garbage", forged, expired, disabled]) {
        expect(await rejected(connect(token))).toBe("UNAUTHENTICATED");
      }
    });

    it("pushes a notification only to its recipient's sockets, never to other users or tenants", async () => {
      const mine = connect(patientToken);
      const sameHospital = connect(otherPatientToken);
      const otherHospital = connect(otherHospitalPatientToken);
      await Promise.all([connected(mine), connected(sameHospital), connected(otherHospital)]);
      const myInbox = received(mine);
      const theirInbox = received(sameHospital);
      const otherInbox = received(otherHospital);
      // A client can't opt into someone else's room: there is no handler for it.
      sameHospital.emit("join", `user:${patientUserId}`);
      otherHospital.emit("subscribe", { room: `user:${patientUserId}` });

      const row = await raise(NotificationType.INVOICE_GENERATED, patientUserId);
      await eventually(async () => expect(myInbox.map((n) => n.id)).toContain(row.id));
      await settled(row.id);
      await new Promise((r) => setTimeout(r, 300));
      expect(theirInbox).toHaveLength(0);
      expect(otherInbox).toHaveLength(0);
      const pushed = myInbox.find((n) => n.id === row.id)!;
      expect(pushed).toMatchObject({ type: NotificationType.INVOICE_GENERATED, readAt: null });
      expect(Object.keys(pushed).sort()).toEqual(
        ["body", "createdAt", "id", "readAt", "relatedEntityId", "relatedEntityType", "title", "type"].sort(),
      );
    });

    it("an email/SMS-only event is never pushed in-app", async () => {
      const mine = connect(patientToken);
      await connected(mine);
      const inbox = received(mine);
      const row = await raise(NotificationType.PAYMENT_RECEIVED, patientUserId);
      await settled(row.id);
      await new Promise((r) => setTimeout(r, 300));
      expect(inbox.map((n) => n.id)).not.toContain(row.id);
    });

    it("disconnects the socket when its access token expires", async () => {
      const shortLived = new JwtService({ secret: jwtSecret }).sign(
        { sub: patientUserId, hospitalId, role: UserRole.PATIENT, jti: randomUUID() },
        { expiresIn: "2s" },
      );
      const socket = connect(shortLived);
      await connected(socket);
      const reason = await new Promise<string>((resolve) => socket.once("disconnect", resolve));
      expect(reason).toBe("io server disconnect");
    });
  });

  describe("GET /notifications/me and PATCH /notifications/:id/read (FR-NOTIF-003, RBAC §3.9)", () => {
    let mineA: string;
    let mineB: string;
    let emailOnly: string;
    let othersSameHospital: string;
    let othersOtherHospital: string;

    beforeAll(async () => {
      mineA = (await raise(NotificationType.LAB_RESULT_APPROVED, patientUserId)).id;
      mineB = (await raise(NotificationType.INVOICE_GENERATED, patientUserId)).id;
      emailOnly = (await raise(NotificationType.PAYMENT_RECEIVED, patientUserId)).id;
      othersSameHospital = (await raise(NotificationType.INVOICE_GENERATED, otherPatientUserId)).id;
      othersOtherHospital = (await raise(NotificationType.INVOICE_GENERATED, otherHospitalPatientUserId, otherHospitalId)).id;
    });

    const me = (token: string, query = "") =>
      api().get(`/api/notifications/me${query}`).set("Authorization", `Bearer ${token}`);
    const markRead = (id: string, token: string) =>
      api().patch(`/api/notifications/${id}/read`).set("Authorization", `Bearer ${token}`);

    it("returns only the caller's own in-app notifications, newest first, with an unread count", async () => {
      const res = await me(patientToken, "?limit=100").expect(200);
      const ids: string[] = res.body.data.map((n: NotificationView) => n.id);
      expect(ids).toEqual(expect.arrayContaining([mineA, mineB]));
      expect(ids).not.toContain(emailOnly);
      expect(ids).not.toContain(othersSameHospital);
      expect(ids).not.toContain(othersOtherHospital);
      expect(ids.indexOf(mineB)).toBeLessThan(ids.indexOf(mineA));
      expect(res.body.meta.unreadCount).toBe(res.body.data.filter((n: NotificationView) => n.readAt === null).length);
      expect(JSON.stringify(res.body)).not.toMatch(/recipientUserId|dedupeKey|hospitalId|passwordHash/);
    });

    it("paginates and filters unread", async () => {
      const page = await me(patientToken, "?limit=1&page=1").expect(200);
      expect(page.body.data).toHaveLength(1);
      expect(page.body.meta.total).toBeGreaterThanOrEqual(2);
      await markRead(mineA, patientToken).expect(200);
      const unread = await me(patientToken, "?unreadOnly=true&limit=100").expect(200);
      const unreadIds = unread.body.data.map((n: NotificationView) => n.id);
      expect(unreadIds).not.toContain(mineA);
      expect(unreadIds).toContain(mineB);
    });

    it("rejects bad query parameters and unauthenticated calls", async () => {
      await me(patientToken, "?unreadOnly=maybe").expect(400);
      await me(patientToken, "?recipientUserId=" + otherPatientUserId).expect(400);
      await me(patientToken, "?limit=101").expect(400);
      await api().get("/api/notifications/me").expect(401);
    });

    it("marks the caller's own notification read, idempotently", async () => {
      const first = await markRead(mineB, patientToken).expect(200);
      expect(first.body.data.readAt).not.toBeNull();
      const again = await markRead(mineB, patientToken).expect(200);
      expect(again.body.data.readAt).toBe(first.body.data.readAt);
    });

    it("404s for anyone else's notification, cross-tenant ids, email-only rows, and unknown ids", async () => {
      await markRead(othersSameHospital, patientToken).expect(404);
      await markRead(othersOtherHospital, patientToken).expect(404);
      await markRead(mineA, otherPatientToken).expect(404);
      await markRead(mineA, otherHospitalPatientToken).expect(404);
      await markRead(emailOnly, patientToken).expect(404);
      await markRead(randomUUID(), patientToken).expect(404);
      const untouched = await TenantContext.bypass(() => prisma.notification.findUniqueOrThrow({ where: { id: othersSameHospital } }));
      expect(untouched.readAt).toBeNull();
    });

    it("works for every role, including a Super Admin with no hospital", async () => {
      const sa = await me(superAdminToken).expect(200);
      expect(sa.body.data).toEqual([]);
      const own = await raise(NotificationType.LOW_STOCK_ALERT, superAdminUserId, otherHospitalId);
      const after = await me(superAdminToken).expect(200);
      expect(after.body.data.map((n: NotificationView) => n.id)).toEqual([own.id]);
      await markRead(own.id, superAdminToken).expect(200);
      await me(doctorToken).expect(200);
      await me(receptionistToken).expect(200);
    });
  });

  describe("tenancy hardening", () => {
    it("createManyAndReturn gets the tenant's hospitalId injected, like createMany", async () => {
      const [row] = await scoped(hospitalId, () =>
        prisma.notification.createManyAndReturn({
          data: [
            {
              hospitalId: otherHospitalId,
              recipientUserId: patientUserId,
              type: NotificationType.LOW_STOCK_ALERT,
              title: "t",
              body: "b",
              channels: [],
              dispatchedAt: new Date(),
            },
          ],
        }),
      );
      expect(row!.hospitalId).toBe(hospitalId);
    });
  });

  describe("Bull Board and env guards (SEC-NOTIF-005)", () => {
    const baseEnv = {
      DATABASE_URL: "postgresql://x",
      REDIS_URL: "redis://x",
      JWT_ACCESS_SECRET: "x".repeat(64),
      ENCRYPTION_KEY: "a".repeat(64),
    };

    it("is not mounted unless explicitly enabled", async () => {
      await api().get("/api/admin/queues").expect(404);
    });

    it("env validation refuses Bull Board in production, or without a strong password", () => {
      expect(() =>
        validateEnv({ ...baseEnv, NODE_ENV: "production", BULL_BOARD_ENABLED: "true", BULL_BOARD_PASSWORD: "p".repeat(20) }),
      ).toThrow(/production/);
      expect(() => validateEnv({ ...baseEnv, BULL_BOARD_ENABLED: "true" })).toThrow(/BULL_BOARD_PASSWORD/);
      expect(validateEnv({ ...baseEnv, BULL_BOARD_ENABLED: "false" }).BULL_BOARD_ENABLED).toBe(false);
      expect(validateEnv({ ...baseEnv, BULL_BOARD_ENABLED: "true", BULL_BOARD_PASSWORD: "p".repeat(12) }).BULL_BOARD_ENABLED).toBe(true);
    });

    it("when enabled (dev), requires its own Basic-auth credential", async () => {
      const password = `bb-${suffix}-password`;
      const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const boardApp = moduleFixture.createNestApplication();
      const config = boardApp.get(ConfigService);
      const realGet = config.get.bind(config);
      jest.spyOn(config, "get").mockImplementation(((key: string, fallback?: unknown) => {
        if (key === "BULL_BOARD_ENABLED") return true;
        if (key === "BULL_BOARD_USERNAME") return "admin";
        return realGet(key, fallback as never);
      }) as typeof config.get);
      jest.spyOn(config, "getOrThrow").mockImplementation(((key: string) =>
        key === "BULL_BOARD_PASSWORD" ? password : realGet(key)) as typeof config.getOrThrow);
      configureApp(boardApp);
      await boardApp.init();
      try {
        const board = () => request(boardApp.getHttpServer()).get("/api/admin/queues");
        await board().expect(401);
        await board().auth("admin", "wrong-password").expect(401);
        await board().auth("root", password).expect(401);
        const ok = await board().auth("admin", password).expect(200);
        expect(ok.text).toMatch(/<html/i);
      } finally {
        await boardApp.close();
      }
    });
  });
});
