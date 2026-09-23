import { HttpException, HttpStatus } from "@nestjs/common";
import { ApiErrorCode } from "@medcore/types";

/**
 * Throw this for any domain-specific error that needs a stable, documented
 * error code (docs/08-API-CONTRACT.md §3) rather than NestJS's generic
 * HttpException subclasses. The global exception filter reads `.code` off
 * this class directly; other HttpExceptions get mapped by status code.
 */
export class AppException extends HttpException {
  public readonly code: ApiErrorCode;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: HttpStatus,
    details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
    this.code = code;
  }

  static invalidRefreshToken(
    message = "Refresh token is invalid, expired, or already used.",
  ): AppException {
    return new AppException(ApiErrorCode.INVALID_REFRESH_TOKEN, message, HttpStatus.UNAUTHORIZED);
  }

  static rateLimited(message = "Too many requests. Please try again later."): AppException {
    return new AppException(ApiErrorCode.RATE_LIMITED, message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
