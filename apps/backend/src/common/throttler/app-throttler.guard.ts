import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { AppException } from "../errors/app-exception";

/** Throws our standard AppException(RATE_LIMITED) instead of ThrottlerGuard's own exception shape. */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(): Promise<void> {
    throw AppException.rateLimited();
  }
}
