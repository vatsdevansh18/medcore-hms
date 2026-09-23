import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { ApiErrorCode, type ApiError } from "@medcore/types";
import { AppException } from "../errors/app-exception";

const STATUS_TO_CODE: Partial<Record<number, ApiErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ApiErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: ApiErrorCode.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ApiErrorCode.FORBIDDEN_ROLE,
  [HttpStatus.NOT_FOUND]: ApiErrorCode.NOT_FOUND,
  [HttpStatus.TOO_MANY_REQUESTS]: ApiErrorCode.RATE_LIMITED,
};

/**
 * Normalises every thrown error into the standard error envelope
 * (docs/08-API-CONTRACT.md §2) — no raw stack traces, Prisma error text, or
 * framework default bodies ever reach the client (docs/02-SRS.md §4).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const { status, code, message, details } = this.resolve(exception);

    const body: ApiError = {
      success: false,
      error: { code, message, ...(details ? { details } : {}) },
    };

    if (status >= 500) {
      this.logger.error({ err: exception, code }, "Unhandled exception");
    } else {
      this.logger.warn({ code, message }, "Request error");
    }

    response.status(status).json(body);
  }

  private resolve(exception: unknown): {
    status: number;
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  } {
    if (exception instanceof AppException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as {
        message: string;
        details?: Record<string, unknown>;
      };
      return { status, code: exception.code, message: body.message, details: body.details };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const code = STATUS_TO_CODE[status] ?? ApiErrorCode.INTERNAL_ERROR;

      if (typeof body === "string") {
        return { status, code, message: body };
      }

      const bodyRecord = body as { message?: string | string[]; error?: string };
      // class-validator's ValidationPipe produces { message: string[], error: "Bad Request" }.
      if (Array.isArray(bodyRecord.message)) {
        return {
          status,
          code,
          message: "Validation failed.",
          details: { fields: bodyRecord.message },
        };
      }
      return { status, code, message: bodyRecord.message ?? bodyRecord.error ?? "Request failed." };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ApiErrorCode.INTERNAL_ERROR,
      message: "An unexpected error occurred.",
    };
  }
}
