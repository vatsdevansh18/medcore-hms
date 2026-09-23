import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { TokenService } from "./services/token.service";
import { OtpService } from "./services/otp.service";
import { PasswordResetService } from "./services/password-reset.service";
import { OtpDeliveryStub, OTP_DELIVERY_PORT } from "./services/otp-delivery.stub";
import { JwtStrategy } from "./strategies/jwt.strategy";

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>("JWT_ACCESS_SECRET"),
        signOptions: { expiresIn: config.get<string>("JWT_ACCESS_TTL", "15m") },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    OtpService,
    PasswordResetService,
    JwtStrategy,
    { provide: OTP_DELIVERY_PORT, useClass: OtpDeliveryStub },
  ],
  // JwtAuthGuard/RolesGuard are registered globally in AppModule
  // (SEC-AUTHZ-002) — they have no AuthModule-specific dependencies (just
  // Reflector), so they live in src/auth/guards/ but are wired as
  // APP_GUARD providers in app.module.ts, not here.
  exports: [TokenService, PasswordResetService],
})
export class AuthModule {}
