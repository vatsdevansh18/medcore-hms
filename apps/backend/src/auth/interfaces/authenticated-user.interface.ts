import type { UserRole } from "@medcore/types";

/** Shape attached to `request.user` by JwtAuthGuard after verifying the access token. */
export interface AuthenticatedUser {
  /** User.id — matches JWT `sub` claim. */
  sub: string;
  hospitalId: string | null;
  role: UserRole;
  /** JWT id — the refresh-token-family/session this access token belongs to. */
  jti: string;
}
