import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import { map, type Observable } from "rxjs";
import type { ApiSuccess } from "@medcore/types";

/**
 * Wraps every success response in the standard envelope
 * (docs/08-API-CONTRACT.md §2). Health endpoints keep Terminus's own shape —
 * that's a well-known convention for orchestration probes, not our API
 * surface, and main.ts already excludes them from the global "api" prefix.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, ApiSuccess<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T> | T> {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.path.startsWith("/health")) {
      return next.handle();
    }

    return next.handle().pipe(map((data) => ({ success: true as const, data, message: "OK" })));
  }
}
