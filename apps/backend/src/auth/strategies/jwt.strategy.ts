import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { JwtPayload } from "../interfaces/jwt-payload.interface";
import type { AuthenticatedUser } from "../interfaces/authenticated-user.interface";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>("JWT_ACCESS_SECRET"),
    });
  }

  // Whatever this returns becomes `request.user` — passport-jwt has already
  // verified the signature and expiry before this runs.
  validate(payload: JwtPayload): AuthenticatedUser {
    return {
      sub: payload.sub,
      hospitalId: payload.hospitalId,
      role: payload.role,
      jti: payload.jti,
    };
  }
}
