import { type BeforeApplicationShutdown, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Namespace, Socket } from "socket.io";
import {
  NOTIFICATIONS_NAMESPACE,
  NotificationSocketEvent,
  UserStatus,
  type NotificationView,
} from "@medcore/types";
import { PRISMA_CLIENT } from "../../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../../prisma/prisma-client.factory";
import { TenantContext } from "../../common/tenancy/tenant-context";
import type { JwtPayload } from "../../auth/interfaces/jwt-payload.interface";

interface SocketData {
  userId: string;
  expiresAt: number;
}

export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/**
 * FR-NOTIF-003 live delivery: Socket.IO namespace `/notifications`
 * (docs/08-API-CONTRACT.md §4.10). Security (SEC-NOTIF-001):
 *  - The handshake must carry a valid, unexpired access token
 *    (`auth: { token }`), checked by namespace middleware before the
 *    connection is accepted. A disabled or deleted account is refused.
 *  - The server joins the socket to its own `user:{sub}` room and nothing
 *    else. There are no client-to-server message handlers, and Socket.IO
 *    clients can't join rooms themselves, so a socket only ever receives
 *    its own user's notifications.
 *  - The socket is disconnected when its access token expires; the client
 *    reconnects with a refreshed token.
 * CORS and the Redis adapter (cross-instance fan-out) are configured once
 * in `ConfiguredIoAdapter`.
 */
@WebSocketGateway({ namespace: NOTIFICATIONS_NAMESPACE })
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, BeforeApplicationShutdown
{
  private readonly logger = new Logger(NotificationsGateway.name);
  private readonly jwt: JwtService;
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();
  private shuttingDown = false;

  @WebSocketServer()
  server: Namespace;

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    config: ConfigService,
  ) {
    this.jwt = new JwtService({ secret: config.getOrThrow<string>("JWT_ACCESS_SECRET") });
  }

  afterInit(namespace: Namespace): void {
    namespace.use((socket, next) => {
      this.authenticate(socket)
        .then((data) => {
          socket.data = data;
          next();
        })
        .catch(() => {
          // One generic message: never reveal why (expired vs. forged vs. disabled).
          next(new Error("UNAUTHENTICATED"));
        });
    });
  }

  private async authenticate(socket: Socket): Promise<SocketData> {
    const auth = socket.handshake.auth as { token?: unknown } | undefined;
    const token = typeof auth?.token === "string" ? auth.token : null;
    if (!token) throw new Error("missing token");
    const payload = await this.jwt.verifyAsync<JwtPayload & { exp: number }>(token);
    const user = await TenantContext.bypass(() =>
      this.prisma.user.findUnique({ where: { id: payload.sub }, select: { status: true, deletedAt: true } }),
    );
    if (!user || user.deletedAt || user.status === UserStatus.DISABLED) throw new Error("inactive user");
    return { userId: payload.sub, expiresAt: payload.exp * 1000 };
  }

  async handleConnection(socket: Socket): Promise<void> {
    const data = socket.data as SocketData | undefined;
    if (!data?.userId) {
      socket.disconnect(true);
      return;
    }
    await socket.join(userRoom(data.userId));
    const msUntilExpiry = Math.max(0, data.expiresAt - Date.now());
    this.expiryTimers.set(
      socket.id,
      setTimeout(() => socket.disconnect(true), msUntilExpiry),
    );
  }

  handleDisconnect(socket: Socket): void {
    const timer = this.expiryTimers.get(socket.id);
    if (timer) clearTimeout(timer);
    this.expiryTimers.delete(socket.id);
  }

  beforeApplicationShutdown(): void {
    this.shuttingDown = true;
  }

  /** Called by the in-app worker. With the Redis adapter this reaches the
   * user's sockets on every API instance, not just this one. Throws once
   * shutdown has begun, so the job fails and is retried (by this instance
   * after restart, or another one) instead of pushing into a closing
   * connection. */
  emitToUser(userId: string, notification: NotificationView): void {
    if (!this.server || this.shuttingDown) {
      throw new Error("Socket server unavailable (not initialised or shutting down).");
    }
    this.server.to(userRoom(userId)).emit(NotificationSocketEvent.NEW, notification);
  }
}
