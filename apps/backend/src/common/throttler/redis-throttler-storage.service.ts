import { Inject, Injectable } from "@nestjs/common";
import type { ThrottlerStorage } from "@nestjs/throttler";
import type Redis from "ioredis";
import { REDIS_CLIENT } from "../../redis/redis.constants";

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Redis-backed rate-limit counters (docs/03-ARCHITECTURE.md §13) — the
 * default in-memory ThrottlerStorage doesn't share state across horizontally
 * scaled API instances (NFR-SCALE-001), which defeats the point of a rate
 * limit. Fixed-window counter via INCR+PEXPIRE, which is the standard Redis
 * rate-limiting pattern. `ttl`/`blockDuration` are milliseconds, per
 * @nestjs/throttler v6's convention.
 */
@Injectable()
export class RedisThrottlerStorageService implements ThrottlerStorage {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `throttle:hits:${throttlerName}:${key}`;
    const blockKey = `throttle:block:${throttlerName}:${key}`;

    const blockPttl = await this.redis.pttl(blockKey);
    if (blockPttl > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: 0,
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockPttl / 1000),
      };
    }

    const totalHits = await this.redis.incr(hitKey);
    if (totalHits === 1) {
      await this.redis.pexpire(hitKey, ttl);
    }
    const hitsPttl = await this.redis.pttl(hitKey);
    const timeToExpire = Math.ceil(Math.max(hitsPttl, 0) / 1000);

    if (totalHits > limit) {
      if (blockDuration > 0) {
        await this.redis.set(blockKey, "1", "PX", blockDuration);
      }
      const timeToBlockExpire = blockDuration > 0 ? Math.ceil(blockDuration / 1000) : timeToExpire;
      return { totalHits, timeToExpire, isBlocked: true, timeToBlockExpire };
    }

    return { totalHits, timeToExpire, isBlocked: false, timeToBlockExpire: 0 };
  }
}
