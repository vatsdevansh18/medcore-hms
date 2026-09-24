import { randomBytes, createHash } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { ConfigService } from "@nestjs/config";
import type Redis from "ioredis";
import { ApiErrorCode } from "@medcore/types";
import { REDIS_CLIENT } from "../../redis/redis.constants";
import { PRISMA_CLIENT } from "../../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../../prisma/prisma-client.factory";
import { TenantContext } from "../../common/tenancy/tenant-context";
import { AppException } from "../../common/errors/app-exception";
import { OTP_DELIVERY_PORT, type OtpDeliveryPort } from "./otp-delivery";
import { TokenService } from "./token.service";

const RESET_TTL_SECONDS = 60 * 60;

/** FR-AUTH-004, SEC-AUTHN-006. */
@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    @Inject(OTP_DELIVERY_PORT) private readonly delivery: OtpDeliveryPort,
    private readonly config: ConfigService,
    private readonly tokenService: TokenService,
  ) {}

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  /**
   * Always resolves successfully regardless of whether the email exists
   * (SEC-AUTHN-006 — no user enumeration). Silently no-ops for an unknown
   * email after the same lookup cost, so response timing doesn't leak it.
   */
  async requestReset(email: string): Promise<void> {
    const user = await TenantContext.bypass(() =>
      this.prisma.user.findUnique({ where: { email } }),
    );
    if (!user) return;

    // Only one active reset token per user — generating a new one
    // invalidates whatever was previously pending, satisfying "invalidates
    // all other pending reset tokens for that user" without extra bookkeeping.
    const activeKey = `pwreset:active:${user.id}`;
    const previousHash = await this.redis.get(activeKey);
    if (previousHash) {
      await this.redis.del(`pwreset:token:${previousHash}`);
    }

    const token = randomBytes(32).toString("hex");
    const tokenHash = this.hash(token);
    await this.redis.set(`pwreset:token:${tokenHash}`, user.id, "EX", RESET_TTL_SECONDS);
    await this.redis.set(activeKey, tokenHash, "EX", RESET_TTL_SECONDS);

    await this.delivery.sendPasswordResetEmail(email, token);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = this.hash(token);
    const userId = await this.redis.get(`pwreset:token:${tokenHash}`);

    if (!userId) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "Reset link is invalid or has expired.",
        HttpStatus.BAD_REQUEST,
      );
    }

    const costFactor = this.config.get<number>("BCRYPT_COST_FACTOR", 12);
    const passwordHash = await bcrypt.hash(newPassword, costFactor);

    await TenantContext.bypass(() =>
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    );

    await this.redis.del(`pwreset:token:${tokenHash}`);
    await this.redis.del(`pwreset:active:${userId}`);

    // A password reset is a plausible compromise-recovery action — revoke
    // every existing session so a stolen session can't outlive the new password.
    await this.tokenService.revokeAllSessions(userId);
  }
}
