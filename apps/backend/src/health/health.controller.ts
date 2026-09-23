import { Controller, Get } from "@nestjs/common";
import { HealthCheck, HealthCheckService } from "@nestjs/terminus";
import { DatabaseHealthIndicator } from "./database.health-indicator";

/**
 * Liveness/readiness probes — see docs/02-SRS.md NFR-AVAIL-001.
 * `/health` reports process liveness only. `/health/ready` additionally
 * checks Postgres connectivity (wired up in Phase 2); Redis joins this check
 * once it's actually consumed by the application (Phase 3 sessions).
 */
@Controller("health")
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DatabaseHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  liveness() {
    return this.health.check([]);
  }

  @Get("ready")
  @HealthCheck()
  readiness() {
    return this.health.check([() => this.db.isHealthy("database")]);
  }
}
