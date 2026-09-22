import { Controller, Get } from "@nestjs/common";
import { HealthCheck, HealthCheckService } from "@nestjs/terminus";

/**
 * Liveness/readiness probes — see docs/02-SRS.md NFR-AVAIL-001.
 * `/health` reports process liveness only. `/health/ready` will additionally
 * check downstream dependencies (Postgres, Redis) once those are wired up in
 * Phase 2; until then it intentionally mirrors liveness rather than faking a
 * dependency check that doesn't exist yet.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  @Get()
  @HealthCheck()
  liveness() {
    return this.health.check([]);
  }

  @Get("ready")
  @HealthCheck()
  readiness() {
    return this.health.check([]);
  }
}
