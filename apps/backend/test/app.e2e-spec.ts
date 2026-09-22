import { Test, type TestingModule } from "@nestjs/testing";
import { type INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Health (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api", { exclude: ["health", "health/ready"] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns 200 and ok status", () => {
    return request(app.getHttpServer())
      .get("/health")
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe("ok");
      });
  });

  it("GET /health/ready returns 200 and ok status", () => {
    return request(app.getHttpServer())
      .get("/health/ready")
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe("ok");
      });
  });
});
