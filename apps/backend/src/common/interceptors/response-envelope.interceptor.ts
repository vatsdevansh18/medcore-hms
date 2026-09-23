import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import { map, type Observable } from "rxjs";
import type { ApiPaginated, ApiSuccess } from "@medcore/types";
import { PaginatedResult } from "../pagination/paginated-result";

/**
 * Wraps every success response in the standard envelope
 * (docs/08-API-CONTRACT.md §2). Health endpoints keep Terminus's own shape —
 * that's a well-known convention for orchestration probes, not our API
 * surface, and main.ts already excludes them from the global "api" prefix.
 *
 * A controller returning a `PaginatedResult` gets the distinct "Paginated
 * list" shape (`{success, data, meta}`) instead of the default
 * `{success, data, message}` — recognized by class, not by duck-typing an
 * object that merely happens to have a `data` key.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<
  T,
  ApiSuccess<T> | ApiPaginated<T> | T
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccess<T> | ApiPaginated<T> | T> {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.path.startsWith("/health")) {
      return next.handle();
    }

    return next.handle().pipe(
      map((result) => {
        if (result instanceof PaginatedResult) {
          return { success: true as const, data: result.data, meta: result.meta };
        }
        return { success: true as const, data: result, message: "OK" };
      }),
    );
  }
}
