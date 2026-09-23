import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { validateEnv } from "./config/env.validation";
import { buildLoggerConfig } from "./common/logging/logger.config";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/guards/jwt-auth.guard";
import { RolesGuard } from "./auth/guards/roles.guard";
import { AppThrottlerGuard } from "./common/throttler/app-throttler.guard";
import { RedisThrottlerStorageService } from "./common/throttler/redis-throttler-storage.service";
import { TenantContextInterceptor } from "./common/tenancy/tenant-context.interceptor";
import { ResponseEnvelopeInterceptor } from "./common/interceptors/response-envelope.interceptor";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // pnpm always runs this package's scripts with cwd=apps/backend, so the
      // repo-root .env (where it actually lives) is "../../.env" from here.
      // In Docker, env vars are injected directly by docker-compose and no
      // .env file exists in the image at all — dotenv silently no-ops on a
      // missing path, so this array is safe in both contexts.
      envFilePath: [".env", "../../.env"],
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildLoggerConfig(
          config.get<string>("NODE_ENV", "development"),
          config.get<string>("LOG_LEVEL", "info"),
        ),
    }),
    // General API default (brief: 1000 req/min); AuthController overrides
    // this to the stricter 100 req/15min via @Throttle().
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisThrottlerStorageService],
      useFactory: (storage: RedisThrottlerStorageService) => ({
        throttlers: [{ name: "default", ttl: 60_000, limit: 1000 }],
        storage,
      }),
    }),
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
  ],
  providers: [
    // Order matters: throttling and authentication happen before RBAC, and
    // both guards run before TenantContextInterceptor establishes tenant
    // scope for the controller (docs/03-ARCHITECTURE.md §3, §5).
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
