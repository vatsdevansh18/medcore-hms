import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { firstValueFrom, from, type Observable } from "rxjs";
import { UserRole } from "@medcore/types";
import { TenantContext } from "./tenant-context";
import { BYPASS_TENANT_SCOPE_KEY } from "../../auth/decorators/bypass-tenant-scope.decorator";
import type { AuthenticatedUser } from "../../auth/interfaces/authenticated-user.interface";

/**
 * Implements "TenantScopeGuard" from docs/03-ARCHITECTURE.md §5 — named a
 * Guard there, but built as an Interceptor here: a Guard's canActivate()
 * establishes AsyncLocalStorage context only for the duration of its own
 * synchronous call, which unwinds before the controller method even runs.
 * Only an Interceptor wrapping next.handle() (which represents "the rest of
 * the pipeline including the controller") can keep the context alive for the
 * whole request. Runs after JwtAuthGuard/RolesGuard, which populate
 * `request.user`.
 *
 * Public routes (no `request.user`) pass through untouched — those handlers
 * (register, login) manage their own narrow TenantContext scope explicitly,
 * because by definition no authenticated tenant is known yet.
 *
 * Uses firstValueFrom/from (not a manual Observable+subscribe) to keep the
 * context-carrying section in native Promise/async-await land as long as
 * possible — per the AsyncLocalStorage-vs-Prisma finding in
 * docs/phase-reviews/PHASE-2-REVIEW.md, native async/await reliably
 * preserves context where other scheduling mechanisms may not. Every
 * controller in this codebase returns a Promise (a plain async method), so
 * next.handle() always emits exactly once — firstValueFrom is exact here,
 * not an approximation, and would need revisiting only if a controller ever
 * returned a genuine multi-emission Observable (none do).
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      return next.handle();
    }

    const bypassAllowed = this.reflector.getAllAndOverride<boolean>(BYPASS_TENANT_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const bypassTenancy = Boolean(bypassAllowed) && user.role === UserRole.SUPER_ADMIN;

    return from(
      TenantContext.run({ hospitalId: user.hospitalId, userId: user.sub, bypassTenancy }, () =>
        firstValueFrom(next.handle(), { defaultValue: undefined }),
      ),
    );
  }
}
