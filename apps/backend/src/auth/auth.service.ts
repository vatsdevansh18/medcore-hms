import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcrypt";
import { ApiErrorCode, HospitalStatus, UserRole, UserStatus } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { AppException } from "../common/errors/app-exception";
import { TokenService, type IssuedTokenPair } from "./services/token.service";
import { OtpService } from "./services/otp.service";
import { PasswordResetService } from "./services/password-reset.service";
import type { RegisterDto } from "./dto/register.dto";
import type { LoginDto } from "./dto/login.dto";
import type { VerifyEmailDto } from "./dto/verify-email.dto";

export interface DeviceInfo {
  deviceLabel?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly config: ConfigService,
    private readonly tokenService: TokenService,
    private readonly otpService: OtpService,
    readonly passwordResetService: PasswordResetService,
  ) {}

  private async hashPassword(plain: string): Promise<string> {
    const cost = this.config.get<number>("BCRYPT_COST_FACTOR", 12);
    return bcrypt.hash(plain, cost);
  }

  /** FR-AUTH-001 — patient self-registration only; see docs/07-RBAC-MATRIX.md §3.2. */
  async register(dto: RegisterDto): Promise<{ userId: string; email: string }> {
    const hospital = await TenantContext.bypass(() =>
      this.prisma.hospital.findUnique({ where: { id: dto.hospitalId } }),
    );
    if (!hospital || hospital.status !== HospitalStatus.ACTIVE) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "This hospital is not accepting registrations.",
        HttpStatus.BAD_REQUEST,
      );
    }

    const existing = await TenantContext.bypass(() =>
      this.prisma.user.findUnique({ where: { email: dto.email } }),
    );
    if (existing) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "An account with this email already exists.",
        HttpStatus.BAD_REQUEST,
      );
    }

    const passwordHash = await this.hashPassword(dto.password);

    const user = await TenantContext.run(
      { hospitalId: dto.hospitalId, userId: null, bypassTenancy: false },
      async () => {
        const created = await this.prisma.user.create({
          data: {
            hospitalId: dto.hospitalId,
            email: dto.email,
            phone: dto.phone,
            firstName: dto.firstName,
            lastName: dto.lastName,
            passwordHash,
            role: UserRole.PATIENT,
            status: UserStatus.PENDING,
          },
        });
        await this.prisma.patientProfile.create({
          data: { userId: created.id, hospitalId: dto.hospitalId },
        });
        return created;
      },
    );

    await this.otpService.generateAndSend("email", user.id, user.email);

    return { userId: user.id, email: user.email };
  }

  async resendEmailOtp(email: string): Promise<void> {
    const user = await TenantContext.bypass(() =>
      this.prisma.user.findUnique({ where: { email } }),
    );
    if (!user || user.emailVerifiedAt) return; // no enumeration; nothing to do either way
    await this.otpService.generateAndSend("email", user.id, user.email);
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<void> {
    const user = await TenantContext.bypass(() =>
      this.prisma.user.findUnique({ where: { email: dto.email } }),
    );
    if (!user) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "Verification code is invalid or has expired.",
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.otpService.verify("email", user.id, dto.code);

    await TenantContext.run(
      { hospitalId: user.hospitalId, userId: user.id, bypassTenancy: false },
      () =>
        this.prisma.user.update({
          where: { id: user.id },
          data: { emailVerifiedAt: new Date(), status: UserStatus.ACTIVE },
        }),
    );
  }

  async sendPhoneOtp(userId: string, hospitalId: string | null): Promise<void> {
    const user = await TenantContext.runForCaller({ hospitalId, sub: userId }, () =>
      this.prisma.user.findUnique({ where: { id: userId } }),
    );
    if (!user) {
      throw new AppException(
        ApiErrorCode.UNAUTHENTICATED,
        "Account not found.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!user.phone) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "No phone number is on file for this account.",
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.otpService.generateAndSend("phone", userId, user.phone);
  }

  async verifyPhone(userId: string, hospitalId: string | null, code: string): Promise<void> {
    await this.otpService.verify("phone", userId, code);
    await TenantContext.runForCaller({ hospitalId, sub: userId }, () =>
      this.prisma.user.update({ where: { id: userId }, data: { phoneVerifiedAt: new Date() } }),
    );
  }

  /** SEC-AUTHN-007: login failures never distinguish "wrong password" from "unknown email." */
  async login(dto: LoginDto, device: DeviceInfo): Promise<IssuedTokenPair> {
    const user = await TenantContext.bypass(() =>
      this.prisma.user.findUnique({ where: { email: dto.email } }),
    );

    const passwordValid = user ? await bcrypt.compare(dto.password, user.passwordHash) : false;
    if (!user || !passwordValid) {
      throw new AppException(
        ApiErrorCode.UNAUTHENTICATED,
        "Invalid email or password.",
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (user.status === UserStatus.DISABLED) {
      throw new AppException(
        ApiErrorCode.UNAUTHENTICATED,
        "This account has been disabled.",
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (!user.emailVerifiedAt) {
      throw new AppException(
        ApiErrorCode.UNAUTHENTICATED,
        "Please verify your email before logging in.",
        HttpStatus.UNAUTHORIZED,
      );
    }

    const tokens = await this.tokenService.issueTokenPair(
      { id: user.id, hospitalId: user.hospitalId, role: user.role },
      device,
    );

    await TenantContext.runForCaller({ hospitalId: user.hospitalId, sub: user.id }, () =>
      this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    );

    return tokens;
  }

  async refresh(refreshToken: string): Promise<IssuedTokenPair> {
    return this.tokenService.rotateRefreshToken(refreshToken);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokenService.revokeSessionByToken(refreshToken);
  }

  async me(userId: string, hospitalId: string | null) {
    const user = await TenantContext.runForCaller({ hospitalId, sub: userId }, () =>
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
          role: true,
          hospitalId: true,
          status: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
          createdAt: true,
          // Phase 12: the portal needs the caller's own PatientProfile id
          // (the EMR routes are keyed by it) and the hospital's name,
          // timezone, and reschedule policy (CurrentUser, packages/types).
          patientProfile: { select: { id: true } },
          hospital: {
            select: {
              id: true,
              name: true,
              timezone: true,
              patientRescheduleAllowed: true,
              patientRescheduleCutoffHours: true,
            },
          },
        },
      }),
    );
    if (!user) {
      throw new AppException(
        ApiErrorCode.UNAUTHENTICATED,
        "Account not found.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    const { patientProfile, hospital, ...rest } = user;
    return { ...rest, patientProfileId: patientProfile?.id ?? null, hospital: hospital ?? null };
  }
}
