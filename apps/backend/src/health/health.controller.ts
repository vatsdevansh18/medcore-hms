import { Controller, Get } from "@nestjs/common";
import { HealthCheck, HealthCheckService } from "@nestjs/terminus";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "../auth/decorators/public.decorator";
import { DatabaseHealthIndicator } from "./database.health-indicator";
import { RedisHealthIndicator } from "./redis.health-indicator";

/**
 * Liveness/readiness probes — see docs/02-SRS.md NFR-AVAIL-001.
 * `/health` reports process liveness only. `/health/ready` checks Postgres
 * (Phase 2) and Redis (Phase 3 sessions/OTP/rate-limiting) connectivity.
 *
 * @Public() is required here, not just implied by main.ts's global-prefix
 * exclusion — that exclusion only affects URL path prefixing, not guard
 * application. The global JwtAuthGuard/RolesGuard still ran against these
 * routes and rejected orchestration probes with 401 until this was added
 * (found by actually curling the endpoint, not just booting the app — see
 * docs/phase-reviews/PHASE-3-REVIEW.md). @SkipThrottle() for the same
 * reason: a load balancer polling this every few seconds shouldn't be
 * rate-limited.
 */
@Public()
@SkipThrottle()
@Controller("health")
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DatabaseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  liveness() {
    return this.health.check([]);
  }

  @Get("ready")
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.db.isHealthy("database"),
      () => this.redis.isHealthy("redis"),
    ]);
  }
}
