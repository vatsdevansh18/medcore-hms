import { Test, type TestingModule } from "@nestjs/testing";
import { TerminusModule } from "@nestjs/terminus";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
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
