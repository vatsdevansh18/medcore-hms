import { randomUUID } from "node:crypto";
import { Controller, Get, INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import { HospitalStatus, UserRole } from "@medcore/types";
import { AppModule } from "../src/app.module";
import { OTP_DELIVERY_PORT, type OtpDeliveryPort } from "../src/auth/services/otp-delivery.stub";
import { Roles } from "../src/auth/decorators/roles.decorator";
import { PRISMA_CLIENT } from "../src/prisma/prisma.module";
import type { ExtendedPrismaClient } from "../src/prisma/prisma-client.factory";
import { TenantContext } from "../src/common/tenancy/tenant-context";

/** Minimal DOCTOR-only route, registered only in this test module, to prove
 * RolesGuard's role-mismatch enforcement against a real restricted route —
 * no such route exists in AuthModule itself yet (Phase 4+ adds real ones). */
@Controller("test-only/doctors")
class DoctorOnlyTestController {
  @Roles(UserRole.DOCTOR)
  @Get()
  ping() {
    return { ok: true };
  }
}

describe("Auth (e2e)", () => {
  let app: INestApplication;
  let prisma: ExtendedPrismaClient;
  let hospitalId: string;
  const sentCodes = new Map<string, string>();
  const capturingDelivery: OtpDeliveryPort = {
    sendEmailOtp: async (email, code) => {
      sentCodes.set(`email:${email}`, code);
      await Promise.resolve();
    },
    sendSmsOtp: async (phone, code) => {
      sentCodes.set(`phone:${phone}`, code);
      await Promise.resolve();
    },
    sendPasswordResetEmail: async (email, token) => {
      sentCodes.set(`reset:${email}`, token);
      await Promise.resolve();
    },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [DoctorOnlyTestController],
    })
      .overrideProvider(OTP_DELIVERY_PORT)
      .useValue(capturingDelivery)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api", { exclude: ["health", "health/ready"] });
    const cookieParser = (await import("cookie-parser")).default;
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PRISMA_CLIENT);
    const suffix = randomUUID().slice(0, 8);
    const hospital = await TenantContext.bypass(() =>
      prisma.hospital.create({
        data: {
          name: `Auth Test Hospital ${suffix}`,
          slug: `auth-test-${suffix}`,
          status: HospitalStatus.ACTIVE,
          contactEmail: `auth-${suffix}@test.medcore.test`,
        },
      }),
    );
    hospitalId = hospital.id;
  });

  afterAll(async () => {
    await TenantContext.bypass(async () => {
      await prisma.refreshTokenSession.deleteMany({ where: { user: { hospitalId } } });
      await prisma.auditLog.deleteMany({ where: { hospitalId } });
      await prisma.patientProfile.deleteMany({ where: { hospitalId } });
      await prisma.user.deleteMany({ where: { hospitalId } });
      await prisma.hospital.delete({ where: { id: hospitalId } });
    });
    await app.close();
  });

  async function registerAndVerify(email: string, password = "Passw0rd!") {
    await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({ email, password, firstName: "Test", lastName: "User", hospitalId })
      .expect(201);

    const code = sentCodes.get(`email:${email}`);
    expect(code).toBeDefined();

    await request(app.getHttpServer())
      .post("/api/auth/verify-email")
      .send({ email, code })
      .expect(200);
  }

  describe("registration & verification (FR-AUTH-001)", () => {
    it("registers, sends an email OTP, and verification activates the account", async () => {
      const email = `patient-${randomUUID()}@test.medcore.test`;
      await registerAndVerify(email);

      const user = await TenantContext.bypass(() =>
        prisma.user.findUniqueOrThrow({ where: { email } }),
      );
      expect(user.status).toBe("ACTIVE");
      expect(user.emailVerifiedAt).not.toBeNull();
    });

    it("rejects registration against a hospital that doesn't exist", async () => {
      await request(app.getHttpServer())
        .post("/api/auth/register")
        .send({
          email: `x-${randomUUID()}@test.medcore.test`,
          password: "Passw0rd!",
          firstName: "X",
          lastName: "Y",
          hospitalId: "00000000-0000-0000-0000-000000000000",
        })
        .expect(400)
        .expect((res) => expect(res.body.error.code).toBe("VALIDATION_ERROR"));
    });

    it("rejects a wrong verification code without consuming a legitimate one", async () => {
      const email = `wrongcode-${randomUUID()}@test.medcore.test`;
      await request(app.getHttpServer())
        .post("/api/auth/register")
        .send({ email, password: "Passw0rd!", firstName: "T", lastName: "U", hospitalId })
        .expect(201);

      await request(app.getHttpServer())
        .post("/api/auth/verify-email")
        .send({ email, code: "000000" })
        .expect(400)
        .expect((res) => expect(res.body.error.code).toBe("VALIDATION_ERROR"));

      const realCode = sentCodes.get(`email:${email}`);
      await request(app.getHttpServer())
        .post("/api/auth/verify-email")
        .send({ email, code: realCode })
        .expect(200);
    });

    it("an unverified account cannot log in", async () => {
      const email = `unverified-${randomUUID()}@test.medcore.test`;
      await request(app.getHttpServer())
        .post("/api/auth/register")
        .send({ email, password: "Passw0rd!", firstName: "T", lastName: "U", hospitalId })
        .expect(201);

      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email, password: "Passw0rd!" })
        .expect(401)
        .expect((res) => expect(res.body.error.code).toBe("UNAUTHENTICATED"));
    });
  });

  describe("login (FR-AUTH-002, SEC-AUTHN-007)", () => {
    it("issues an access token and sets an httpOnly refresh cookie on success", async () => {
      const email = `login-${randomUUID()}@test.medcore.test`;
      await registerAndVerify(email);

      const res = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email, password: "Passw0rd!" })
        .expect(200);

      expect(res.body.data.accessToken).toEqual(expect.any(String));
      const setCookie = res.headers["set-cookie"];
      expect(setCookie?.[0]).toMatch(/refresh_token=.+HttpOnly.+SameSite=Strict/i);
    });

    it("rejects wrong password and unknown email with the identical error shape (no enumeration)", async () => {
      const email = `known-${randomUUID()}@test.medcore.test`;
      await registerAndVerify(email);

      const wrongPassword = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email, password: "WrongPass1" })
        .expect(401);

      const unknownEmail = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: `nope-${randomUUID()}@test.medcore.test`, password: "WrongPass1" })
        .expect(401);

      expect(wrongPassword.body.error).toEqual(unknownEmail.body.error);
    });
  });

  describe("refresh rotation & reuse detection (FR-AUTH-003, SEC-AUTHN-004) — mandatory scenario", () => {
    it("rotates on refresh; replaying the old token fails AND revokes the whole session family", async () => {
      const email = `reuse-${randomUUID()}@test.medcore.test`;
      await registerAndVerify(email);

      const login = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email, password: "Passw0rd!" })
        .expect(200);
      const originalCookie = login.headers["set-cookie"][0] as string;

      const firstRefresh = await request(app.getHttpServer())
        .post("/api/auth/refresh")
        .set("Cookie", originalCookie)
        .expect(200);
      const rotatedCookie = firstRefresh.headers["set-cookie"][0] as string;
      expect(rotatedCookie).not.toEqual(originalCookie);

      // Replaying the ORIGINAL (already-rotated-out) cookie must fail.
      await request(app.getHttpServer())
        .post("/api/auth/refresh")
        .set("Cookie", originalCookie)
        .expect(401)
        .expect((res) => expect(res.body.error.code).toBe("INVALID_REFRESH_TOKEN"));

      // The replay must have revoked the ENTIRE family — even the token
      // issued by the legitimate first rotation is now dead.
      await request(app.getHttpServer())
        .post("/api/auth/refresh")
        .set("Cookie", rotatedCookie)
        .expect(401)
        .expect((res) => expect(res.body.error.code).toBe("INVALID_REFRESH_TOKEN"));
    });

    it("a garbage/unknown refresh token is rejected without a 500", async () => {
      await request(app.getHttpServer())
        .post("/api/auth/refresh")
        .set("Cookie", "refresh_token=not-a-real-token")
        .expect(401)
        .expect((res) => expect(res.body.error.code).toBe("INVALID_REFRESH_TOKEN"));
    });

    it("refresh with no cookie at all is rejected", async () => {
      await request(app.getHttpServer())
        .post("/api/auth/refresh")
        .expect(401)
        .expect((res) => expect(res.body.error.code).toBe("INVALID_REFRESH_TOKEN"));
    });
  });

  describe("authorization (SEC-AUTHZ-*) — mandatory scenario: unauthorized role/no auth rejected", () => {
    it("a protected route with no token is rejected", async () => {
      await request(app.getHttpServer())
        .get("/api/auth/me")
        .expect(401)
        .expect((res) => expect(res.body.error.code).toBe("UNAUTHENTICATED"));
    });

    it("a malformed/garbage access token is rejected", async () => {
      await request(app.getHttpServer())
        .get("/api/auth/me")
        .set("Authorization", "Bearer garbage.not.a.jwt")
        .expect(401);
    });

    it("returns the caller's own profile for a valid token", async () => {
      const email = `me-${randomUUID()}@test.medcore.test`;
      await registerAndVerify(email);
      const login = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email, password: "Passw0rd!" })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${login.body.data.accessToken}`)
        .expect(200);

      expect(res.body.data.email).toBe(email);
      expect(res.body.data.role).toBe("PATIENT");
    });

    it("a PATIENT is rejected from a DOCTOR-only route (FORBIDDEN_ROLE)", async () => {
      const email = `rbac-${randomUUID()}@test.medcore.test`;
      await registerAndVerify(email);
      const login = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email, password: "Passw0rd!" })
        .expect(200);

      await request(app.getHttpServer())
        .get("/api/test-only/doctors")
        .set("Authorization", `Bearer ${login.body.data.accessToken}`)
        .expect(403)
        .expect((res) => expect(res.body.error.code).toBe("FORBIDDEN_ROLE"));
    });
  });

  describe("password reset (FR-AUTH-004, SEC-AUTHN-006)", () => {
    it("forgot-password returns 200 for both a known and an unknown email (no enumeration)", async () => {
      const email = `forgot-${randomUUID()}@test.medcore.test`;
      await registerAndVerify(email);

      await request(app.getHttpServer())
        .post("/api/auth/forgot-password")
        .send({ email })
        .expect(200);
      await request(app.getHttpServer())
        .post("/api/auth/forgot-password")
        .send({ email: `nope-${randomUUID()}@test.medcore.test` })
        .expect(200);
    });

    it("resets the password with a valid token and revokes existing sessions", async () => {
      const email = `reset-${randomUUID()}@test.medcore.test`;
      await registerAndVerify(email);
      const login = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email, password: "Passw0rd!" })
        .expect(200);
      const cookie = login.headers["set-cookie"][0] as string;

      await request(app.getHttpServer())
        .post("/api/auth/forgot-password")
        .send({ email })
        .expect(200);
      const token = sentCodes.get(`reset:${email}`);
      expect(token).toBeDefined();

      await request(app.getHttpServer())
        .post("/api/auth/reset-password")
        .send({ token, newPassword: "NewPassw0rd!" })
        .expect(200);

      // Old session must be dead after a password reset.
      await request(app.getHttpServer())
        .post("/api/auth/refresh")
        .set("Cookie", cookie)
        .expect(401);

      // New password works; old one doesn't.
      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email, password: "Passw0rd!" })
        .expect(401);
      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email, password: "NewPassw0rd!" })
        .expect(200);
    });

    it("rejects an invalid/unknown reset token", async () => {
      await request(app.getHttpServer())
        .post("/api/auth/reset-password")
        .send({ token: "not-a-real-token", newPassword: "NewPassw0rd!" })
        .expect(400);
    });
  });

  describe("sessions (FR-AUTH-006)", () => {
    it("lists the caller's own sessions and can revoke all of them", async () => {
      const email = `sessions-${randomUUID()}@test.medcore.test`;
      await registerAndVerify(email);
      const login = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email, password: "Passw0rd!" })
        .expect(200);
      const accessToken = login.body.data.accessToken as string;
      const cookie = login.headers["set-cookie"][0] as string;

      const list = await request(app.getHttpServer())
        .get("/api/auth/sessions")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(list.body.data.length).toBeGreaterThanOrEqual(1);

      await request(app.getHttpServer())
        .delete("/api/auth/sessions/all")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post("/api/auth/refresh")
        .set("Cookie", cookie)
        .expect(401);
    });
  });
});
