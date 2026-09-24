import Redis from "ioredis";

/**
 * Runs before each e2e spec file (jest-e2e.json `setupFilesAfterEnv`).
 *
 * The auth routes allow 100 requests per 15 minutes per route and client
 * IP, counted in Redis (`throttle:*`). Every spec reaches the API from the
 * same loopback address and the suite runs serially, so without this the
 * whole suite shares one login budget. It crossed 100 logins in Phase 13B
 * and every spec after that point failed with 429. Starting each file with an empty
 * counter makes a spec behave like a fresh client, which is what each one
 * assumes. The limiter itself is tested in rate-limit.e2e-spec.ts, which
 * exhausts it within that one file.
 */
beforeAll(async () => {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", "throttle:*", "COUNT", 500);
      if (keys.length) await redis.del(...keys);
      cursor = next;
    } while (cursor !== "0");
  } finally {
    redis.disconnect();
  }
});
