import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type Redis from "ioredis";
import type { UserRole } from "@medcore/types";
import { REDIS_CLIENT } from "../../redis/redis.constants";
import { PRISMA_CLIENT } from "../../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../../prisma/prisma-client.factory";
import { TenantContext } from "../../common/tenancy/tenant-context";
import { AppException } from "../../common/errors/app-exception";
import type { JwtPayload } from "../interfaces/jwt-payload.interface";

interface RefreshTokenRecord {
  userId: string;
  deviceId: string;
  status: "active" | "rotated";
}

export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  refreshTokenExpiresAt: Date;
}

const REUSE_GRACE_SECONDS = 5 * 60;

/**
 * Manages access-token signing and refresh-token issue/rotate/revoke.
 *
 * Redis key design deviates slightly from the brief's suggested
 * `rt:{userId}:{deviceId}` pattern — that key shape can't, by itself,
 * support reuse detection: after rotation, a stolen *old* token needs to
 * still resolve to *whose* session it was so the whole family can be
 * revoked, which requires looking the token up by its own hash, not by a
 * (userId, deviceId) pair the caller doesn't have. Design used instead:
 *
 * - `rt:token:{sha256(token)}` → {userId, deviceId, status} — the primary,
 *   hashed (SEC-AUTHN-003) validation record.
 * - `rt:user:{userId}` → a Redis Set of that user's active token hashes,
 *   for O(1) "revoke every session" without a Redis SCAN.
 * - Postgres `RefreshTokenSession` (one row per [userId, deviceId]) is the
 *   durable, enumerable record the device-list UI (FR-AUTH-006) reads, and
 *   is what DELETE /auth/sessions/:id looks up to find the tokenHash to
 *   revoke in Redis for a device that isn't the caller's current one.
 *
 * On rotation, the old Redis record isn't deleted — it's marked
 * `status: 'rotated'` and kept for a grace window. A subsequent presentation
 * of that same old token is unambiguous evidence of token theft or a
 * client retry race, so it revokes the entire session family
 * (SEC-AUTHN-004) rather than just failing quietly.
 */
@Injectable()
export class TokenService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  signAccessToken(
    user: { id: string; hospitalId: string | null; role: UserRole },
    jti: string,
  ): string {
    const payload: JwtPayload = { sub: user.id, hospitalId: user.hospitalId, role: user.role, jti };
    return this.jwt.sign(payload, { expiresIn: this.config.get<string>("JWT_ACCESS_TTL", "15m") });
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private refreshTtlSeconds(): number {
    return this.parseDurationToSeconds(this.config.get<string>("JWT_REFRESH_TTL", "7d"));
  }

  private parseDurationToSeconds(duration: string): number {
    const match = /^(\d+)([smhd])$/.exec(duration);
    if (!match) return 7 * 24 * 60 * 60;
    const value = Number(match[1]);
    const unit = match[2];
    const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit as "s" | "m" | "h" | "d"];
    return value * multiplier;
  }

  /**
   * Issues a fresh access+refresh pair for a brand-new session (login).
   * Runs its own narrow TenantContext for the RefreshTokenSession write,
   * matching the pattern seed scripts use — login callers aren't wrapped by
   * the request-scoped TenantContextInterceptor (no authenticated user
   * exists yet at that point).
   */
  async issueTokenPair(
    user: { id: string; hospitalId: string | null; role: UserRole },
    device: { deviceId?: string; deviceLabel?: string; ipAddress?: string; userAgent?: string },
  ): Promise<IssuedTokenPair> {
    const deviceId = device.deviceId ?? randomUUID();
    const jti = randomUUID();
    const accessToken = this.signAccessToken(user, jti);

    const refreshToken = randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(refreshToken);
    const ttlSeconds = this.refreshTtlSeconds();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    const record: RefreshTokenRecord = { userId: user.id, deviceId, status: "active" };
    await this.redis.set(`rt:token:${tokenHash}`, JSON.stringify(record), "EX", ttlSeconds);
    await this.redis.sadd(`rt:user:${user.id}`, tokenHash);

    await TenantContext.run(
      { hospitalId: user.hospitalId, userId: user.id, bypassTenancy: false },
      async () => {
        await this.prisma.refreshTokenSession.upsert({
          where: { userId_deviceId: { userId: user.id, deviceId } },
          create: {
            userId: user.id,
            deviceId,
            deviceLabel: device.deviceLabel,
            ipAddress: device.ipAddress,
            userAgent: device.userAgent,
            tokenHash,
            expiresAt,
          },
          update: {
            tokenHash,
            expiresAt,
            revokedAt: null,
            ipAddress: device.ipAddress,
            userAgent: device.userAgent,
          },
        });
      },
    );

    return { accessToken, refreshToken, deviceId, refreshTokenExpiresAt: expiresAt };
  }

  /**
   * Rotates a presented refresh token. Throws AppException(INVALID_REFRESH_TOKEN)
   * for any invalid/expired/reused token — callers never learn *why* a token
   * was rejected beyond that, which is intentional (SEC-AUTHN-007-style
   * non-disclosure).
   */
  async rotateRefreshToken(presentedToken: string): Promise<IssuedTokenPair> {
    const tokenHash = this.hashToken(presentedToken);
    const raw = await this.redis.get(`rt:token:${tokenHash}`);

    if (!raw) {
      throw AppException.invalidRefreshToken();
    }

    const record = JSON.parse(raw) as RefreshTokenRecord;

    if (record.status === "rotated") {
      // Replay of an already-rotated-out token — treat as compromised and
      // revoke the whole session family (SEC-AUTHN-004).
      await this.revokeAllSessions(record.userId);
      throw AppException.invalidRefreshToken();
    }

    const user = await TenantContext.bypass(() =>
      this.prisma.user.findUnique({ where: { id: record.userId } }),
    );
    if (!user) {
      throw AppException.invalidRefreshToken();
    }

    // Mark old token as rotated (not deleted) so a subsequent replay is
    // detectable, then let it expire naturally after the grace window.
    await this.redis.set(
      `rt:token:${tokenHash}`,
      JSON.stringify({ ...record, status: "rotated" }),
      "EX",
      REUSE_GRACE_SECONDS,
    );
    await this.redis.srem(`rt:user:${record.userId}`, tokenHash);

    return this.issueTokenPair(
      { id: user.id, hospitalId: user.hospitalId, role: user.role },
      { deviceId: record.deviceId },
    );
  }

  /** Revokes the single device session the presented refresh token belongs to. */
  async revokeSessionByToken(presentedToken: string): Promise<void> {
    const tokenHash = this.hashToken(presentedToken);
    const raw = await this.redis.get(`rt:token:${tokenHash}`);
    if (!raw) return;

    const record = JSON.parse(raw) as RefreshTokenRecord;
    await this.redis.del(`rt:token:${tokenHash}`);
    await this.redis.srem(`rt:user:${record.userId}`, tokenHash);

    await TenantContext.bypass(async () => {
      await this.prisma.refreshTokenSession.updateMany({
        where: { userId: record.userId, deviceId: record.deviceId },
        data: { revokedAt: new Date() },
      });
    });
  }

  /** Revokes a specific device session by its Postgres row id — used by DELETE /auth/sessions/:id. */
  async revokeSessionById(userId: string, sessionId: string): Promise<void> {
    const session = await TenantContext.bypass(() =>
      this.prisma.refreshTokenSession.findUnique({ where: { id: sessionId } }),
    );
    if (!session || session.userId !== userId) return;

    await this.redis.del(`rt:token:${session.tokenHash}`);
    await this.redis.srem(`rt:user:${userId}`, session.tokenHash);

    await TenantContext.bypass(async () => {
      await this.prisma.refreshTokenSession.update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
      });
    });
  }

  /** Revokes every active session for a user — "log out of all devices" and reuse-detection response. */
  async revokeAllSessions(userId: string): Promise<void> {
    const hashes = await this.redis.smembers(`rt:user:${userId}`);
    if (hashes.length > 0) {
      await this.redis.del(...hashes.map((h) => `rt:token:${h}`));
    }
    await this.redis.del(`rt:user:${userId}`);

    await TenantContext.bypass(async () => {
      await this.prisma.refreshTokenSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async listSessions(userId: string) {
    return TenantContext.bypass(() =>
      this.prisma.refreshTokenSession.findMany({
        where: { userId, revokedAt: null },
        orderBy: { createdAt: "desc" },
        // NFR-PERF-003: a bounded list; the newest devices come first (D-043).
        take: 50,
      }),
    );
  }
}
