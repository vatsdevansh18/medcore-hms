import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { RedisThrottlerStorageService } from "../common/throttler/redis-throttler-storage.service";
import { REDIS_CLIENT } from "./redis.constants";

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis(config.getOrThrow<string>("REDIS_URL"), {
          // Fail fast on boot if Redis is unreachable, rather than queuing
          // commands silently — matches the Prisma module's $connect() on init.
          lazyConnect: false,
          maxRetriesPerRequest: 3,
        }),
    },
    // Lives here (not app.module.ts) so ThrottlerModule.forRootAsync's own
    // `imports: [RedisModule]` can resolve it via `inject` — a provider
    // registered directly on AppModule isn't visible to a different
    // module's forRootAsync factory, only to what that module itself imports.
    RedisThrottlerStorageService,
  ],
  exports: [REDIS_CLIENT, RedisThrottlerStorageService],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
