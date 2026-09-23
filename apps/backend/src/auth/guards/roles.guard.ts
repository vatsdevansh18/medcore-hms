import { Injectable, Logger, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { HttpStatus } from "@nestjs/common";
import { ApiErrorCode, type UserRole } from "@medcore/types";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { AppException } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../interfaces/authenticated-user.interface";

/**
 * SEC-AUTHZ-001: deny-by-default. A route with neither @Public() nor
 * @Roles(...) is refused, not silently allowed — this is what makes "every
 * controller method carries an explicit @Roles() decorator" enforceable at
 * runtime rather than just a convention.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      const request = context.switchToHttp().getRequest<Request>();
      this.logger.error(
        `Route ${request.method} ${request.path} has no @Roles() or @Public() decorator — denying by default.`,
      );
      throw new AppException(
        ApiErrorCode.FORBIDDEN_ROLE,
        "This route is not authorized for any role.",
        HttpStatus.FORBIDDEN,
      );
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user || !requiredRoles.includes(user.role)) {
      throw new AppException(
        ApiErrorCode.FORBIDDEN_ROLE,
        "Your role is not permitted to perform this action.",
        HttpStatus.FORBIDDEN,
      );
    }

    return true;
  }
}
