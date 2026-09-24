import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/common/bootstrap/configure-app";

/**
 * The auth routes' stricter limit: 100 requests per 15 minutes per route
 * and client (auth.controller.ts `@Throttle`), stored in Redis. Added in Phase 13B,
 * when the e2e setup started clearing the limiter before each spec file
 * (helpers/reset-rate-limits.ts): this file is now where the limiter
 * itself is exercised. `forgot-password` is used because it's cheap and
 * always answers 200 for an unknown email.
 */
describe("Auth rate limiting (e2e)", () => {
  let app: INestApplication;
  const email = `nobody-${randomUUID().slice(0, 8)}@test.medcore.test`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("allows 100 requests to an auth route, then refuses with 429 RATE_LIMITED", async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 100; i++) {
      await request(server).post("/api/auth/forgot-password").send({ email }).expect(200);
    }
    const refused = await request(server).post("/api/auth/forgot-password").send({ email }).expect(429);
    expect(refused.body).toMatchObject({ success: false, error: { code: "RATE_LIMITED" } });
    // The budget is per route and client (@nestjs/throttler keys on the
    // handler): login still has its own 100.
    await request(server).post("/api/auth/login").send({ email, password: "whatever1" }).expect(401);
  });

  it("leaves non-auth routes on the general limit", async () => {
    await request(app.getHttpServer()).get("/health").expect(200);
  });
});
