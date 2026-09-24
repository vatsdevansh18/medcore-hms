import { randomInt } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import { ApiErrorCode } from "@medcore/types";
import { REDIS_CLIENT } from "../../redis/redis.constants";
import { AppException } from "../../common/errors/app-exception";
import { OTP_DELIVERY_PORT, type OtpDeliveryPort } from "./otp-delivery";

export type OtpPurpose = "email" | "phone";

const OTP_TTL_SECONDS = 10 * 60;
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_GENERATE_PER_WINDOW = 3;
const GENERATE_WINDOW_SECONDS = 10 * 60;

interface OtpRecord {
  code: string;
  attempts: number;
}

/** SEC-AUTHN-005: 6-digit, 10-minute TTL, single-use, rate-limited OTPs for email/phone verification. */
@Injectable()
export class OtpService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(OTP_DELIVERY_PORT) private readonly delivery: OtpDeliveryPort,
  ) {}

  private recordKey(purpose: OtpPurpose, userId: string): string {
    return `otp:${purpose}:${userId}`;
  }

  private generateCountKey(purpose: OtpPurpose, userId: string): string {
    return `otp:${purpose}:${userId}:gencount`;
  }

  async generateAndSend(purpose: OtpPurpose, userId: string, destination: string): Promise<void> {
    const countKey = this.generateCountKey(purpose, userId);
    const count = await this.redis.incr(countKey);
    if (count === 1) {
      await this.redis.expire(countKey, GENERATE_WINDOW_SECONDS);
    }
    if (count > MAX_GENERATE_PER_WINDOW) {
      throw AppException.rateLimited(
        "Too many verification code requests. Please try again later.",
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const record: OtpRecord = { code, attempts: 0 };
    await this.redis.set(
      this.recordKey(purpose, userId),
      JSON.stringify(record),
      "EX",
      OTP_TTL_SECONDS,
    );

    if (purpose === "email") {
      await this.delivery.sendEmailOtp(destination, code);
    } else {
      await this.delivery.sendSmsOtp(destination, code);
    }
  }

  /** Throws AppException(VALIDATION_ERROR) on any invalid/expired/exhausted/mismatched code — single-use either way. */
  async verify(purpose: OtpPurpose, userId: string, code: string): Promise<void> {
    const key = this.recordKey(purpose, userId);
    const raw = await this.redis.get(key);
    if (!raw) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "Verification code is invalid or has expired.",
        HttpStatus.BAD_REQUEST,
      );
    }

    const record = JSON.parse(raw) as OtpRecord;

    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      await this.redis.del(key);
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "Too many incorrect attempts. Please request a new code.",
        HttpStatus.BAD_REQUEST,
      );
    }

    if (record.code !== code) {
      record.attempts += 1;
      const ttl = await this.redis.ttl(key);
      await this.redis.set(key, JSON.stringify(record), "EX", ttl > 0 ? ttl : OTP_TTL_SECONDS);
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "Incorrect verification code.",
        HttpStatus.BAD_REQUEST,
      );
    }

    // Correct — single-use, delete immediately.
    await this.redis.del(key);
  }
}
