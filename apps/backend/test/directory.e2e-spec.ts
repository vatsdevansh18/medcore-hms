import { randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import { HospitalStatus, UserRole, UserStatus } from "@medcore/types";
import { AppModule } from "../src/app.module";
import { PRISMA_CLIENT } from "../src/prisma/prisma.module";
import type { ExtendedPrismaClient } from "../src/prisma/prisma-client.factory";
import { TenantContext } from "../src/common/tenancy/tenant-context";
import { configureApp } from "../src/common/bootstrap/configure-app";

/**
 * Phase 4 — hospital/department/staff/doctor/patient directory management.
 * Covers docs/10-TESTING-STRATEGY.md §3's mandatory cross-tenant and RBAC
 * scenarios against the real HTTP surface (tenancy.e2e-spec.ts already
 * covers the same guarantee at the Prisma-extension layer), plus a
 * regression test for the passwordHash-leak found during manual Phase 4
 * verification (docs/phase-reviews/PHASE-4-REVIEW.md).
 */
describe("Directory management (e2e)", () => {
  let app: INestApplication;
  let prisma: ExtendedPrismaClient;
  const suffix = randomUUID().slice(0, 8);

  let hospitalAId: string;
  let hospitalBId: string;
  let deptAId: string;
  let deptBId: string;
  const createdUserIds: string[] = [];
  const createdHospitalIds: string[] = [];

  let superAdminToken: string;
  let adminAToken: string;
  let adminBToken: string;
  let doctorAToken: string;
  let patientAToken: string;
  let patientAId: string; // patientProfile id

  const PASSWORD = "Passw0rd!";

  async function createUser(opts: { hospitalId: string; role: UserRole; email: string }) {
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    return TenantContext.run(
      { hospitalId: opts.hospitalId, userId: null, bypassTenancy: false },
      async () => {
        const user = await prisma.user.create({
          data: {
            hospitalId: opts.hospitalId,
            email: opts.email,
            passwordHash,
            firstName: "Test",
            lastName: "User",
            role: opts.role,
            status: UserStatus.ACTIVE,
            emailVerifiedAt: new Date(),
          },
        });
        createdUserIds.push(user.id);
        return user;
      },
    );
  }

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PRISMA_CLIENT);

    const [hospitalA, hospitalB] = await TenantContext.bypass(() =>
      Promise.all([
        prisma.hospital.create({
          data: {
            name: `Directory Test Hospital A ${suffix}`,
            slug: `dir-test-a-${suffix}`,
            status: HospitalStatus.ACTIVE,
            contactEmail: `dir-a-${suffix}@test.medcore.test`,
          },
        }),
        prisma.hospital.create({
          data: {
            name: `Directory Test Hospital B ${suffix}`,
            slug: `dir-test-b-${suffix}`,
            status: HospitalStatus.ACTIVE,
            contactEmail: `dir-b-${suffix}@test.medcore.test`,
          },
        }),
      ]),
    );
    hospitalAId = hospitalA.id;
    hospitalBId = hospitalB.id;
    createdHospitalIds.push(hospitalAId, hospitalBId);

    const [deptA, deptB] = await Promise.all([
      TenantContext.run({ hospitalId: hospitalAId, userId: null, bypassTenancy: false }, () =>
        prisma.department.create({ data: { hospitalId: hospitalAId, name: "Cardiology" } }),
      ),
      TenantContext.run({ hospitalId: hospitalBId, userId: null, bypassTenancy: false }, () =>
        prisma.department.create({ data: { hospitalId: hospitalBId, name: "Cardiology" } }),
      ),
    ]);
    deptAId = deptA.id;
    deptBId = deptB.id;

    const superAdminEmail = `superadmin-dir-${suffix}@test.medcore.test`;
    // SUPER_ADMIN rows have a null hospitalId — created via bypass, not run().
    await TenantContext.bypass(async () => {
      const passwordHash = await bcrypt.hash(PASSWORD, 4);
      const user = await prisma.user.create({
        data: {
          hospitalId: null,
          email: superAdminEmail,
          passwordHash,
          firstName: "Super",
          lastName: "Admin",
          role: UserRole.SUPER_ADMIN,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
      createdUserIds.push(user.id);
    });

    const adminAEmail = `admin-a-${suffix}@test.medcore.test`;
    const adminBEmail = `admin-b-${suffix}@test.medcore.test`;
    const doctorAEmail = `doctor-a-${suffix}@test.medcore.test`;
    const patientAEmail = `patient-a-${suffix}@test.medcore.test`;

    await createUser({
      hospitalId: hospitalAId,
      role: UserRole.HOSPITAL_ADMIN,
      email: adminAEmail,
    });
    await createUser({
      hospitalId: hospitalBId,
      role: UserRole.HOSPITAL_ADMIN,
      email: adminBEmail,
    });
    await createUser({ hospitalId: hospitalAId, role: UserRole.DOCTOR, email: doctorAEmail });

    const patientUser = await createUser({
      hospitalId: hospitalAId,
      role: UserRole.PATIENT,
      email: patientAEmail,
    });
    const patientProfile = await TenantContext.run(
      { hospitalId: hospitalAId, userId: null, bypassTenancy: false },
      () =>
        prisma.patientProfile.create({
          data: { userId: patientUser.id, hospitalId: hospitalAId },
        }),
    );
    patientAId = patientProfile.id;

    superAdminToken = await login(superAdminEmail);
    adminAToken = await login(adminAEmail);
    adminBToken = await login(adminBEmail);
    doctorAToken = await login(doctorAEmail);
    patientAToken = await login(patientAEmail);
  });

  afterAll(async () => {
    await TenantContext.bypass(async () => {
      await prisma.refreshTokenSession.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.doctorProfile.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.patientProfile.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.staffProfile.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma.department.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.auditLog.deleteMany({ where: { hospitalId: { in: createdHospitalIds } } });
      await prisma.hospital.deleteMany({ where: { id: { in: createdHospitalIds } } });
    });
    await app.close();
  });

  describe("hospital lifecycle (FR-HOSP-001) — SUPER_ADMIN only", () => {
    it("SUPER_ADMIN can create, verify, and read a hospital", async () => {
      const create = await request(app.getHttpServer())
        .post("/api/hospitals")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: `New Hospital ${suffix}`,
          slug: `new-hosp-${suffix}`,
          contactEmail: `new-${suffix}@test.medcore.test`,
        })
        .expect(201);
      expect(create.body.data.status).toBe("PENDING_VERIFICATION");
      createdHospitalIds.push(create.body.data.id);

      const verify = await request(app.getHttpServer())
        .patch(`/api/hospitals/${create.body.data.id}/verify`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .expect(200);
      expect(verify.body.data.status).toBe("ACTIVE");
    });

    // Regression (Phase 9): timezone was only @IsString() since Phase 4; the
    // pharmacy expiry logic is its first consumer and throws on an
    // unrecognised zone, so it's now validated as a real IANA zone.
    it("rejects an invalid IANA timezone on hospital create and update (400)", async () => {
      await request(app.getHttpServer())
        .post("/api/hospitals")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: `Bad TZ ${suffix}`,
          slug: `bad-tz-${suffix}`,
          contactEmail: `badtz-${suffix}@test.medcore.test`,
          timezone: "Mars/Olympus_Mons",
        })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/api/hospitals/${hospitalAId}`)
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({ timezone: "not a zone" })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/api/hospitals/${hospitalAId}`)
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({ timezone: "Asia/Kolkata" })
        .expect(200);
    });

    it("a HOSPITAL_ADMIN cannot create a hospital (FORBIDDEN_ROLE)", async () => {
      await request(app.getHttpServer())
        .post("/api/hospitals")
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({ name: "x", slug: `x-${randomUUID()}`, contactEmail: "x@test.medcore.test" })
        .expect(403)
        .expect((res) => expect(res.body.error.code).toBe("FORBIDDEN_ROLE"));
    });

    it("a DOCTOR cannot create a hospital (FORBIDDEN_ROLE)", async () => {
      await request(app.getHttpServer())
        .post("/api/hospitals")
        .set("Authorization", `Bearer ${doctorAToken}`)
        .send({ name: "x", slug: `x-${randomUUID()}`, contactEmail: "x@test.medcore.test" })
        .expect(403)
        .expect((res) => expect(res.body.error.code).toBe("FORBIDDEN_ROLE"));
    });
  });

  describe("cross-tenant isolation (SEC-TENANT-004) — mandatory scenario", () => {
    it("a HOSPITAL_ADMIN from hospital A gets 404 reading hospital B by id", async () => {
      await request(app.getHttpServer())
        .get(`/api/hospitals/${hospitalBId}`)
        .set("Authorization", `Bearer ${adminAToken}`)
        .expect(404)
        .expect((res) => expect(res.body.error.code).toBe("NOT_FOUND"));
    });

    it("a HOSPITAL_ADMIN from hospital A gets 404 updating hospital B", async () => {
      await request(app.getHttpServer())
        .patch(`/api/hospitals/${hospitalBId}`)
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({ contactEmail: "hacked@evil.test" })
        .expect(404);
    });

    it("a HOSPITAL_ADMIN from hospital A gets 404 listing hospital B's departments", async () => {
      await request(app.getHttpServer())
        .get(`/api/hospitals/${hospitalBId}/departments`)
        .set("Authorization", `Bearer ${adminAToken}`)
        .expect(404);
    });

    it("cannot provision a doctor using another hospital's departmentId", async () => {
      await request(app.getHttpServer())
        .post("/api/doctors")
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({
          email: `crossdept-${suffix}@test.medcore.test`,
          firstName: "Cross",
          lastName: "Dept",
          departmentId: deptBId,
          specialization: "Test",
          licenseNumber: `XD-${suffix}`,
          qualification: "MD",
          yearsOfExperience: 1,
          consultationFee: 50,
        })
        .expect(400)
        .expect((res) => expect(res.body.error.code).toBe("VALIDATION_ERROR"));
    });

    it("a HOSPITAL_ADMIN cannot read a doctor belonging to another hospital", async () => {
      const created = await request(app.getHttpServer())
        .post("/api/doctors")
        .set("Authorization", `Bearer ${adminBToken}`)
        .send({
          email: `xtenant-doc-${suffix}@test.medcore.test`,
          firstName: "X",
          lastName: "Tenant",
          departmentId: deptBId,
          specialization: "Test",
          licenseNumber: `XT-${suffix}`,
          qualification: "MD",
          yearsOfExperience: 1,
          consultationFee: 50,
        })
        .expect(201);
      createdUserIds.push(created.body.data.userId);

      await request(app.getHttpServer())
        .get(`/api/doctors/${created.body.data.id}`)
        .set("Authorization", `Bearer ${adminAToken}`)
        .expect(404);
    });

    it("a PATIENT cannot read another patient's profile", async () => {
      const otherUser = await createUser({
        hospitalId: hospitalAId,
        role: UserRole.PATIENT,
        email: `other-patient-${suffix}@test.medcore.test`,
      });
      const otherProfile = await TenantContext.run(
        { hospitalId: hospitalAId, userId: null, bypassTenancy: false },
        () =>
          prisma.patientProfile.create({
            data: { userId: otherUser.id, hospitalId: hospitalAId },
          }),
      );

      await request(app.getHttpServer())
        .get(`/api/patients/${otherProfile.id}`)
        .set("Authorization", `Bearer ${patientAToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/api/patients/${patientAId}`)
        .set("Authorization", `Bearer ${patientAToken}`)
        .expect(200);
    });
  });

  describe("staff/doctor/patient provisioning — passwordHash-leak regression", () => {
    it("POST /doctors never returns passwordHash", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/doctors")
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({
          email: `leak-check-doc-${suffix}@test.medcore.test`,
          firstName: "Leak",
          lastName: "Check",
          departmentId: deptAId,
          specialization: "Test",
          licenseNumber: `LC-${suffix}`,
          qualification: "MD",
          yearsOfExperience: 1,
          consultationFee: 50,
        })
        .expect(201);
      createdUserIds.push(res.body.data.userId);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
    });

    it("POST /patients never returns passwordHash", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/patients")
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({
          email: `leak-check-patient-${suffix}@test.medcore.test`,
          firstName: "Leak",
          lastName: "Check",
        })
        .expect(201);
      createdUserIds.push(res.body.data.userId);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
    });

    it("POST /users (staff) never returns passwordHash", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/users")
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({
          email: `leak-check-staff-${suffix}@test.medcore.test`,
          firstName: "Leak",
          lastName: "Check",
          role: "NURSE",
          employeeCode: `LC-${suffix}`,
        })
        .expect(201);
      createdUserIds.push(res.body.data.id);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);

      const getRes = await request(app.getHttpServer())
        .get(`/api/users/${res.body.data.id}`)
        .set("Authorization", `Bearer ${adminAToken}`)
        .expect(200);
      expect(JSON.stringify(getRes.body)).not.toMatch(/passwordHash/);
    });

    it("GET /doctors list never returns passwordHash and supports the specialization filter", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/doctors")
        .query({ page: 1, limit: 20, specialization: "Test" })
        .set("Authorization", `Bearer ${adminAToken}`)
        .expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const doc of res.body.data) {
        expect(doc.specialization).toMatch(/Test/);
      }
    });

    it("GET /patients list never returns passwordHash and supports the search filter", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/patients")
        .query({ page: 1, limit: 20, search: "Leak" })
        .set("Authorization", `Bearer ${adminAToken}`)
        .expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it("a DOCTOR cannot provision staff or doctors (FORBIDDEN_ROLE)", async () => {
      await request(app.getHttpServer())
        .post("/api/users")
        .set("Authorization", `Bearer ${doctorAToken}`)
        .send({
          email: `should-fail-${suffix}@test.medcore.test`,
          firstName: "A",
          lastName: "B",
          role: "HOSPITAL_ADMIN",
          employeeCode: `SF-${suffix}`,
        })
        .expect(403)
        .expect((res) => expect(res.body.error.code).toBe("FORBIDDEN_ROLE"));

      await request(app.getHttpServer())
        .post("/api/doctors")
        .set("Authorization", `Bearer ${doctorAToken}`)
        .send({
          email: `should-fail-2-${suffix}@test.medcore.test`,
          firstName: "A",
          lastName: "B",
          departmentId: deptAId,
          specialization: "Test",
          licenseNumber: `SF2-${suffix}`,
          qualification: "MD",
          yearsOfExperience: 1,
          consultationFee: 50,
        })
        .expect(403);
    });

    it("rejects duplicate email at doctor provisioning", async () => {
      const email = `dup-${suffix}@test.medcore.test`;
      await request(app.getHttpServer())
        .post("/api/doctors")
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({
          email,
          firstName: "Dup",
          lastName: "One",
          departmentId: deptAId,
          specialization: "Test",
          licenseNumber: `DUP1-${suffix}`,
          qualification: "MD",
          yearsOfExperience: 1,
          consultationFee: 50,
        })
        .expect(201)
        .then((res) => createdUserIds.push(res.body.data.userId));

      await request(app.getHttpServer())
        .post("/api/doctors")
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({
          email,
          firstName: "Dup",
          lastName: "Two",
          departmentId: deptAId,
          specialization: "Test",
          licenseNumber: `DUP2-${suffix}`,
          qualification: "MD",
          yearsOfExperience: 1,
          consultationFee: 50,
        })
        .expect(400)
        .expect((res) => expect(res.body.error.code).toBe("VALIDATION_ERROR"));
    });
  });

  describe("department CRUD (FR-HOSP-001)", () => {
    it("HOSPITAL_ADMIN can create, update, and soft-delete a department scoped to their own hospital", async () => {
      const create = await request(app.getHttpServer())
        .post(`/api/hospitals/${hospitalAId}/departments`)
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({ name: `CRUD Dept ${suffix}` })
        .expect(201);
      const id = create.body.data.id as string;

      await request(app.getHttpServer())
        .patch(`/api/hospitals/${hospitalAId}/departments/${id}`)
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({ description: "Updated" })
        .expect(200)
        .expect((res) => expect(res.body.data.description).toBe("Updated"));

      await request(app.getHttpServer())
        .delete(`/api/hospitals/${hospitalAId}/departments/${id}`)
        .set("Authorization", `Bearer ${adminAToken}`)
        .expect(200);

      const list = await request(app.getHttpServer())
        .get(`/api/hospitals/${hospitalAId}/departments`)
        .query({ page: 1, limit: 50 })
        .set("Authorization", `Bearer ${adminAToken}`)
        .expect(200);
      expect(list.body.data.find((d: { id: string }) => d.id === id)).toBeUndefined();
    });
  });
});
