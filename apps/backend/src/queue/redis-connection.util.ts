import type { ConnectionOptions } from "bullmq";

/**
 * BullMQ needs a plain {host,port,...} connection object, not a URL string,
 * so every call site here parses REDIS_URL by hand instead of handing it to
 * `new Redis(url)` the way the rest of the codebase does. ioredis's own URL
 * constructor auto-enables TLS for a `rediss:` URL; this manual parse has to
 * do that itself or a TLS-only provider (e.g. Upstash) silently gets a plain
 * TCP connection attempt and never connects. Found deploying against Upstash
 * for the first time — every other Redis this project had used (local
 * Docker, LocalStack-adjacent dev) was plain `redis://`, so this never
 * surfaced until a real TLS-requiring provider was in the loop.
 */
export function parseRedisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    db: url.pathname ? Number(url.pathname.slice(1) || 0) : 0,
    maxRetriesPerRequest: null,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
}
