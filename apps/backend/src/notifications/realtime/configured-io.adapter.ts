import type { INestApplicationContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import type { Server, ServerOptions } from "socket.io";

/**
 * The one place Socket.IO server options are set, applied by
 * `configureApp()` so `main.ts` and every e2e spec get the same behaviour:
 *  - CORS: the same allow-list as HTTP (SEC-NET-002), read from config at
 *    runtime rather than frozen into a decorator at import time.
 *  - The Redis adapter (brief/architecture: "Socket.IO gateway with Redis
 *    adapter"), so an in-app push emitted on one API instance reaches a
 *    user connected to another. It needs its own pub/sub connections
 *    (a subscriber connection can't run normal commands).
 */
export class ConfiguredIoAdapter extends IoAdapter {
  private readonly clients: Redis[] = [];

  constructor(private readonly appContext: INestApplicationContext) {
    super(appContext);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const config = this.appContext.get(ConfigService);
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: config.get<string>("CORS_ORIGIN", "http://localhost:3000").split(","),
        credentials: true,
      },
    }) as Server;

    const pub = new Redis(config.getOrThrow<string>("REDIS_URL"), { lazyConnect: false });
    const sub = pub.duplicate();
    this.clients.push(pub, sub);
    server.adapter(createAdapter(pub, sub));
    return server;
  }

  override async dispose(): Promise<void> {
    await Promise.all(this.clients.map((c) => c.quit().catch(() => undefined)));
    this.clients.length = 0;
  }
}
