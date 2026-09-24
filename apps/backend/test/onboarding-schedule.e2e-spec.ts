import { randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import { GetBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";
import { HospitalStatus, UserRole, UserStatus } from "@medcore/types";
import { AppModule } from "../src/app.module";
import { PRISMA_CLIENT } from "../src/prisma/prisma.module";
import type { ExtendedPrismaClient } from "../src/prisma/prisma-client.factory";
import { TenantContext } from "../src/common/tenancy/tenant-context";
import { configureApp } from "../src/common/bootstrap/configure-app";

/**
 * Phase 13B follow-up (docs/11-DECISIONS.md D-042): the reads and writes the
 * last five screens needed.
 * - The doctor's own schedule (`GET /doctors/:id/schedule`) and removing a
 *   date exception.
 * - A Super Admin giving a hospital its Hospital Admin (`POST /hospitals/:id/admins`).
 * - The dev bucket's CORS rule, without which a browser can't upload to a
 *   pre-signed URL.
 */
describe("Onboarding and schedule (e2e)", () => {
  let app: INestApplication;
  let prisma: ExtendedPrismaClient;
  const suffix = randomUUID().slice(0, 8);
  const PASSWORD = "Passw0rd!";
  const createdUserIds: string[] = [];
  const createdHospitalIds: string[] = [];
  const tokens: Record<string, string> = {};
  let hospitalId: string;
  let otherHospitalId: string;
  let doctorProfileId: string;
  let doctor2ProfileId: string;

  const mail = (name: string) => `${name}-${suffix}@test.medcore.test`;

  async function createUser(hId: string | null, role: UserRole, email: string) {
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const user = await TenantContext.bypass(() =>
      prisma.user.create({
        data: { hospitalId: hId, email, passwordHash, firstName: "Test", lastName: "User", role, status: UserStatus.ACTIVE, emailVerifiedAt: new Date() },
      }),
    );
    createdUserIds.push(user.id);
    return user;
  }

  async function login(email: string) {
    const res = await request(app.getHttpServer()).post("/api/auth/login").send({ email, password: PASSWORD }).expect(200);
    return res.body.data.accessToken as string;
  }

  const http = () => request(app.getHttpServer());
  const auth = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PRISMA_CLIENT);

    const [a, b] = await TenantContext.bypass(() =>
      Promise.all(
        ["a", "b"].map((tag) =>
          prisma.hospital.create({
            data: {
              name: `Onboard ${tag} ${suffix}`,
              slug: `onboard-${tag}-${suffix}`,
              status: HospitalStatus.ACTIVE,
              contactEmail: `onboard-${tag}-${suffix}@test.medcore.test`,
              timezone: "Asia/Kolkata",
            },
          }),
        ),
      ),
    );
    hospitalId = a.id;
    otherHospitalId = b.id;
    createdHospitalIds.push(a.id, b.id);
    const dept = await TenantContext.bypass(() => prisma.department.create({ data: { hospitalId, name: "General" } }));
    const otherDept = await TenantContext.bypass(() => prisma.department.create({ data: { hospitalId: otherHospitalId, name: "General" } }));

    const doctor = await createUser(hospitalId, UserRole.DOCTOR, mail("doctor"));
    const doctor2 = await createUser(hospitalId, UserRole.DOCTOR, mail("doctor2"));
    const otherDoctor = await createUser(otherHospitalId, UserRole.DOCTOR, mail("other-doctor"));
    const receptionist = await createUser(hospitalId, UserRole.RECEPTIONIST, mail("reception"));
    const admin = await createUser(hospitalId, UserRole.HOSPITAL_ADMIN, mail("admin"));
    const superAdmin = await createUser(null, UserRole.SUPER_ADMIN, mail("super"));
    const profile = (userId: string, hId: string, dId: string, lic: string) =>
      TenantContext.bypass(() =>
        prisma.doctorProfile.create({
          data: { userId, hospitalId: hId, departmentId: dId, specialization: "General Medicine", licenseNumber: lic, consultationFee: 100 },
        }),
      );
    doctorProfileId = (await profile(doctor.id, hospitalId, dept.id, `L1-${suffix}`)).id;
    doctor2ProfileId = (await profile(doctor2.id, hospitalId, dept.id, `L2-${suffix}`)).id;
    await profile(otherDoctor.id, otherHospitalId, otherDept.id, `L3-${suffix}`);

    for (const [key, user] of Object.entries({ doctor, doctor2, otherDoctor, receptionist, admin, superAdmin })) {
      tokens[key] = await login(user.email);
    }
  });

  afterAll(async () => {
    await TenantContext.bypass(async () => {
      const inHospitals = { hospitalId: { in: createdHospitalIds } };
      await prisma.doctorAvailabilityException.deleteMany({ where: { doctor: inHospitals } });
      await prisma.doctorAvailability.deleteMany({ where: { doctor: inHospitals } });
      await prisma.doctorProfile.deleteMany({ where: inHospitals });
      await prisma.staffProfile.deleteMany({ where: inHospitals });
      const provisioned = await prisma.user.findMany({ where: inHospitals, select: { id: true } });
      const ids = [...createdUserIds, ...provisioned.map((u) => u.id)];
      await prisma.refreshTokenSession.deleteMany({ where: { userId: { in: ids } } });
      await prisma.notification.deleteMany({ where: { recipientUserId: { in: ids } } });
      await prisma.auditLog.deleteMany({ where: { OR: [inHospitals, { actorUserId: { in: ids } }] } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      await prisma.department.deleteMany({ where: inHospitals });
      await prisma.hospital.deleteMany({ where: { id: { in: createdHospitalIds } } });
    });
    await app.close();
  });

  describe("doctor schedule", () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);

    beforeAll(async () => {
      await http()
        .put(`/api/doctors/${doctorProfileId}/availability`)
        .set(auth("doctor"))
        .send({ slots: [{ dayOfWeek: 1, startTime: "09:00", endTime: "13:00", slotDurationMinutes: 20 }] })
        .expect(200);
      await http()
        .post(`/api/doctors/${doctorProfileId}/availability-exceptions`)
        .set(auth("doctor"))
        .send({ date: future, isUnavailable: true, reason: "Conference" })
        .expect(201);
      // A past exception must not come back in the upcoming list.
      await TenantContext.bypass(() =>
        prisma.doctorAvailabilityException.create({
          data: { doctorId: doctorProfileId, date: new Date("2020-01-06T00:00:00.000Z"), isUnavailable: true },
        }),
      );
    });

    it("returns the doctor's own weekly hours and upcoming exceptions, in the hospital's timezone", async () => {
      const res = await http().get(`/api/doctors/${doctorProfileId}/schedule`).set(auth("doctor")).expect(200);
      expect(res.body.data.timezone).toBe("Asia/Kolkata");
      expect(res.body.data.weekly).toContainEqual(
        expect.objectContaining({ dayOfWeek: 1, startTime: "09:00", endTime: "13:00", slotDurationMinutes: 20, isActive: true }),
      );
      expect(res.body.data.exceptions).toEqual([expect.objectContaining({ date: future, isUnavailable: true, reason: "Conference" })]);
    });

    it("is self only: a colleague and another hospital's doctor get 404, other roles 403", async () => {
      await http().get(`/api/doctors/${doctorProfileId}/schedule`).set(auth("doctor2")).expect(404);
      await http().get(`/api/doctors/${doctorProfileId}/schedule`).set(auth("otherDoctor")).expect(404);
      await http().get(`/api/doctors/${doctorProfileId}/schedule`).set(auth("receptionist")).expect(403);
      await http().get(`/api/doctors/${doctorProfileId}/schedule`).set(auth("admin")).expect(403);
      await http().delete(`/api/doctors/${doctorProfileId}/availability-exceptions/${future}`).set(auth("doctor2")).expect(404);
    });

    it("refuses overlapping windows on the same weekday, but allows touching ones", async () => {
      const put = (slots: object[]) => http().put(`/api/doctors/${doctorProfileId}/availability`).set(auth("doctor")).send({ slots });
      const res = await put([
        { dayOfWeek: 2, startTime: "09:00", endTime: "12:00", slotDurationMinutes: 30 },
        { dayOfWeek: 2, startTime: "11:30", endTime: "14:00", slotDurationMinutes: 30 },
      ]).expect(400);
      expect(res.body.error.message).toMatch(/overlap/);
      await put([
        { dayOfWeek: 2, startTime: "09:00", endTime: "12:00", slotDurationMinutes: 30 },
        { dayOfWeek: 2, startTime: "12:00", endTime: "14:00", slotDurationMinutes: 30 },
        { dayOfWeek: 1, startTime: "09:00", endTime: "13:00", slotDurationMinutes: 20 },
      ]).expect(200);
    });

    it("removes an exception once, and rejects a malformed date", async () => {
      await http().delete(`/api/doctors/${doctorProfileId}/availability-exceptions/not-a-date`).set(auth("doctor")).expect(400);
      await http().delete(`/api/doctors/${doctorProfileId}/availability-exceptions/${future}`).set(auth("doctor")).expect(200);
      await http().delete(`/api/doctors/${doctorProfileId}/availability-exceptions/${future}`).set(auth("doctor")).expect(404);
      const res = await http().get(`/api/doctors/${doctorProfileId}/schedule`).set(auth("doctor")).expect(200);
      expect(res.body.data.exceptions).toEqual([]);
      void doctor2ProfileId;
    });
  });

  describe("Super Admin provisions a hospital's admin", () => {
    const body = () => ({ email: mail(`ha-${randomUUID().slice(0, 4)}`), firstName: "Hema", lastName: "Admin", employeeCode: `HA-${randomUUID().slice(0, 6)}` });

    it("creates a verified Hospital Admin in that hospital, with no password hash in the response", async () => {
      const input = body();
      const res = await http().post(`/api/hospitals/${otherHospitalId}/admins`).set(auth("superAdmin")).send(input).expect(201);
      expect(res.body.data).toMatchObject({ email: input.email, role: "HOSPITAL_ADMIN", hospitalId: otherHospitalId, status: "ACTIVE" });
      expect(res.body.data.passwordHash).toBeUndefined();
      const staff = await TenantContext.bypass(() => prisma.staffProfile.findFirst({ where: { user: { email: input.email } } }));
      expect(staff).toMatchObject({ hospitalId: otherHospitalId, employeeCode: input.employeeCode });
    });

    it("ignores a role in the body (the route only makes admins) and rejects extra fields", async () => {
      await http().post(`/api/hospitals/${otherHospitalId}/admins`).set(auth("superAdmin")).send({ ...body(), role: "DOCTOR" }).expect(400);
    });

    it("refuses a duplicate email, an unknown hospital, and every non-Super-Admin", async () => {
      const input = body();
      await http().post(`/api/hospitals/${hospitalId}/admins`).set(auth("superAdmin")).send(input).expect(201);
      await http().post(`/api/hospitals/${hospitalId}/admins`).set(auth("superAdmin")).send({ ...input, employeeCode: "X-1" }).expect(400);
      await http().post(`/api/hospitals/${randomUUID()}/admins`).set(auth("superAdmin")).send(body()).expect(404);
      await http().post(`/api/hospitals/${hospitalId}/admins`).set(auth("admin")).send(body()).expect(403);
      await http().post(`/api/hospitals/${otherHospitalId}/admins`).set(auth("admin")).send(body()).expect(403);
      await http().post(`/api/hospitals/${hospitalId}/admins`).send(body()).expect(401);
    });
  });

  describe("dev bucket CORS for browser uploads", () => {
    it("allows the web app's origin to PUT and GET, and nothing else", async () => {
      const endpoint = process.env.S3_ENDPOINT;
      expect(endpoint).toBeTruthy();
      const s3 = new S3Client({
        region: process.env.AWS_REGION ?? "us-east-1",
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test", secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test" },
      });
      const cors = await s3.send(new GetBucketCorsCommand({ Bucket: process.env.AWS_S3_BUCKET ?? "medcore-hms-attachments" }));
      expect(cors.CORSRules).toEqual([
        expect.objectContaining({ AllowedOrigins: (process.env.CORS_ORIGIN ?? "").split(","), AllowedMethods: ["PUT", "GET"] }),
      ]);

      const origin = (process.env.CORS_ORIGIN ?? "").split(",")[0];
      const preflight = await fetch(`${endpoint}/${process.env.AWS_S3_BUCKET}/probe.png`, {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
      });
      expect(preflight.status).toBe(200);
      expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
      const foreign = await fetch(`${endpoint}/${process.env.AWS_S3_BUCKET}/probe.png`, {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "PUT" },
      });
      expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
    });
  });
});
