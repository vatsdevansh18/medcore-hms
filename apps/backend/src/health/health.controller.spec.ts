import { Test, type TestingModule } from "@nestjs/testing";
import { TerminusModule } from "@nestjs/terminus";
import { HealthController } from "./health.controller";
import { DatabaseHealthIndicator } from "./database.health-indicator";
import { RedisHealthIndicator } from "./redis.health-indicator";

describe("HealthController", () => {
  let controller: HealthController;

  beforeEach(async () => {
    // Unit test: DatabaseHealthIndicator's real implementation needs a live
    // Prisma connection, which belongs in an e2e test (test/app.e2e-spec.ts
    // exercises the real DB-backed check), not here — mocked out so this
    // suite stays fast and DB-independent.
    const module: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        {
          provide: DatabaseHealthIndicator,
          useValue: { isHealthy: jest.fn().mockResolvedValue({ database: { status: "up" } }) },
        },
        {
          provide: RedisHealthIndicator,
          useValue: { isHealthy: jest.fn().mockResolvedValue({ redis: { status: "up" } }) },
        },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  it("reports liveness as ok", async () => {
    const result = await controller.liveness();
    expect(result.status).toBe("ok");
  });

  it("reports readiness as ok", async () => {
    const result = await controller.readiness();
    expect(result.status).toBe("ok");
  });
});
