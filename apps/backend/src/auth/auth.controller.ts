import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { VerifyEmailDto } from "./dto/verify-email.dto";
import { ResendEmailOtpDto } from "./dto/resend-email-otp.dto";
import { VerifyPhoneDto } from "./dto/verify-phone.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { Public } from "./decorators/public.decorator";
import { ALL_ROLES, Roles } from "./decorators/roles.decorator";
import { CurrentUser } from "./decorators/current-user.decorator";
import { AppException } from "../common/errors/app-exception";
import { ApiErrorCode } from "@medcore/types";
import type { AuthenticatedUser } from "./interfaces/authenticated-user.interface";
import { TokenService } from "./services/token.service";
import type { IssuedTokenPair } from "./services/token.service";

const REFRESH_COOKIE_NAME = "refresh_token";
const REFRESH_COOKIE_PATH = "/api/auth";

// SEC-NET-003 / brief: 100 req/15 min on auth endpoints, stricter than the
// 1000 req/min general API default registered in app.module.ts.
@Throttle({ default: { limit: 100, ttl: 15 * 60 * 1000 } })
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly config: ConfigService,
  ) {}

  private setRefreshCookie(res: Response, tokens: IssuedTokenPair): void {
    res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, {
      httpOnly: true,
      secure: this.config.get<string>("NODE_ENV") === "production",
      sameSite: "strict",
      path: REFRESH_COOKIE_PATH,
      expires: tokens.refreshTokenExpiresAt,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  }

  private requireRefreshCookie(req: Request): string {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    if (!token) {
      throw new AppException(
        ApiErrorCode.INVALID_REFRESH_TOKEN,
        "No refresh token was provided.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    return token;
  }

  @Public()
  @Post("register")
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.authService.verifyEmail(dto);
    return { verified: true };
  }

  @Public()
  @Post("resend-email-otp")
  @HttpCode(HttpStatus.OK)
  async resendEmailOtp(@Body() dto: ResendEmailOtpDto) {
    await this.authService.resendEmailOtp(dto.email);
    return { sent: true };
  }

  @Roles(...ALL_ROLES)
  @Post("send-phone-otp")
  @HttpCode(HttpStatus.OK)
  async sendPhoneOtp(@CurrentUser() user: AuthenticatedUser) {
    await this.authService.sendPhoneOtp(user.sub, user.hospitalId);
    return { sent: true };
  }

  @Roles(...ALL_ROLES)
  @Post("verify-phone")
  @HttpCode(HttpStatus.OK)
  async verifyPhone(@CurrentUser() user: AuthenticatedUser, @Body() dto: VerifyPhoneDto) {
    await this.authService.verifyPhone(user.sub, user.hospitalId, dto.code);
    return { verified: true };
  }

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.login(dto, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    this.setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken };
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const presented = this.requireRefreshCookie(req);
    const tokens = await this.authService.refresh(presented);
    this.setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken };
  }

  @Public()
  @Post("forgot-password")
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.passwordResetService.requestReset(dto.email);
    return { sent: true };
  }

  @Public()
  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    if (!dto.token) throw new BadRequestException("token is required");
    await this.authService.passwordResetService.resetPassword(dto.token, dto.newPassword);
    return { reset: true };
  }

  @Roles(...ALL_ROLES)
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const presented = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    if (presented) {
      await this.authService.logout(presented);
    }
    this.clearRefreshCookie(res);
    return { loggedOut: true };
  }

  @Roles(...ALL_ROLES)
  @Get("sessions")
  async sessions(@CurrentUser() user: AuthenticatedUser) {
    return this.tokenService.listSessions(user.sub);
  }

  @Roles(...ALL_ROLES)
  @Delete("sessions/:id")
  @HttpCode(HttpStatus.OK)
  async revokeSession(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    if (id === "all") {
      await this.tokenService.revokeAllSessions(user.sub);
    } else {
      await this.tokenService.revokeSessionById(user.sub, id);
    }
    return { revoked: true };
  }

  @Roles(...ALL_ROLES)
  @Get("me")
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.sub, user.hospitalId);
  }
}
