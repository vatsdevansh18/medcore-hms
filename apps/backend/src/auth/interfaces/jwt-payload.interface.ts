import type { UserRole } from "@medcore/types";

/** Access token claims — signed by TokenService, verified by JwtStrategy. */
export interface JwtPayload {
  sub: string;
  hospitalId: string | null;
  role: UserRole;
  jti: string;
}
