import { plainToInstance, Transform } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MinLength,
  Min,
  validateSync,
} from "class-validator";

/**
 * Validated environment configuration for the process.
 *
 * Only variables the application actually reads in the current phase are
 * validated here — later phases (DB, Redis, JWT, S3, payment providers,
 * etc.) extend this class as each integration is wired up, rather than
 * pre-validating settings nothing yet consumes. `.env.example` at the repo
 * root documents the full eventual set for onboarding purposes.
 */
export class EnvironmentVariables {
  @IsIn(["development", "test", "production"])
  NODE_ENV: string = "development";

  // Named API_PORT, not the generic PORT, because Next.js also reads PORT by
  // convention — with both apps sharing one .env file, "PORT" would make the
  // frontend dev server bind to the backend's port too.
  @IsInt()
  @Min(1)
  @Max(65535)
  API_PORT: number = 3001;

  @IsIn(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
  @IsOptional()
  LOG_LEVEL: string = "info";

  @IsString()
  CORS_ORIGIN: string = "http://localhost:3000";

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  REDIS_URL!: string;

  // Minimum 256-bit secret per SEC-AUTHN-002 — 64 hex chars = 32 bytes.
  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @Matches(/^\d+[smhd]$/, { message: "JWT_ACCESS_TTL must look like 15m, 1h, 7d, etc." })
  JWT_ACCESS_TTL: string = "15m";

  @IsString()
  @Matches(/^\d+[smhd]$/, { message: "JWT_REFRESH_TTL must look like 15m, 1h, 7d, etc." })
  JWT_REFRESH_TTL: string = "7d";

  @IsInt()
  @Min(10)
  @Max(15)
  BCRYPT_COST_FACTOR: number = 12;

  // Phase 6: field encryption (docs/11-DECISIONS.md D-008) — 64 hex chars = 32 bytes, AES-256.
  @IsString()
  @Matches(/^[0-9a-f]{64}$/i, { message: "ENCRYPTION_KEY must be 64 hex characters (32 bytes)." })
  ENCRYPTION_KEY!: string;

  // Phase 6: file storage (docs/03-ARCHITECTURE.md §10, docs/11-DECISIONS.md D-012/D-015).
  @IsString()
  AWS_REGION: string = "ap-south-1";

  @IsString()
  AWS_ACCESS_KEY_ID: string = "test";

  @IsString()
  AWS_SECRET_ACCESS_KEY: string = "test";

  @IsString()
  AWS_S3_BUCKET: string = "medcore-hms-attachments";

  // Empty in production (real AWS); set to a LocalStack URL in dev/test.
  @IsString()
  @IsOptional()
  S3_ENDPOINT: string = "";

  // Phase 10: payments (docs/09-SECURITY.md SEC-PAY-*). All optional: an
  // unconfigured provider makes checkout return 503 and its webhook fail
  // closed (400). SEC-PAY-004 "test mode only" is enforced here, not just
  // documented: a live-mode key refuses to boot.
  @IsOptional()
  @Matches(/^(sk_test_\w+)?$/, { message: "STRIPE_SECRET_KEY must be a test-mode key (sk_test_...) — SEC-PAY-004." })
  STRIPE_SECRET_KEY: string = "";

  @IsOptional()
  @IsString()
  STRIPE_WEBHOOK_SECRET: string = "";

  @IsOptional()
  @Matches(/^(rzp_test_\w+)?$/, { message: "RAZORPAY_KEY_ID must be a test-mode key (rzp_test_...) — SEC-PAY-004." })
  RAZORPAY_KEY_ID: string = "";

  @IsOptional()
  @IsString()
  RAZORPAY_KEY_SECRET: string = "";

  @IsOptional()
  @IsString()
  RAZORPAY_WEBHOOK_SECRET: string = "";

  // Phase 11: notification channels (docs/11-DECISIONS.md D-032/D-033). All
  // optional: an unconfigured provider makes its channel's deliveries
  // SKIPPED (PROVIDER_NOT_CONFIGURED), never a crash or a silent "sent".
  @IsOptional()
  @IsString()
  RESEND_API_KEY: string = "";

  @IsOptional()
  @IsString()
  EMAIL_FROM: string = "MedCore HMS <onboarding@resend.dev>";

  // Non-production only: every email goes here instead of the real
  // recipient (brief §13/§15). Resend's own test inbox by default.
  @IsOptional()
  @IsString()
  EMAIL_SANDBOX_RECIPIENT: string = "delivered@resend.dev";

  @IsOptional()
  @IsString()
  TWILIO_ACCOUNT_SID: string = "";

  @IsOptional()
  @IsString()
  TWILIO_AUTH_TOKEN: string = "";

  @IsOptional()
  @Matches(/^(\+[1-9]\d{6,14})?$/, { message: "TWILIO_FROM_NUMBER must be E.164 (e.g. +15005550006)." })
  TWILIO_FROM_NUMBER: string = "";

  // Non-production only: if set, every SMS goes to this number instead.
  @IsOptional()
  @Matches(/^(\+[1-9]\d{6,14})?$/, { message: "SMS_SANDBOX_RECIPIENT must be E.164." })
  SMS_SANDBOX_RECIPIENT: string = "";

  // First retry delay for a failed channel job (then doubled; 3 attempts,
  // NFR-AVAIL-002). Lowered only by the e2e suite.
  @IsInt()
  @Min(1)
  NOTIFICATION_RETRY_BASE_DELAY_MS: number = 5000;

  // Bull Board (dev-only queue UI, docs/03-ARCHITECTURE.md §12). Refused in
  // production outright (SEC-NOTIF-005) and needs a password when enabled.
  // Parsed from the raw source value: with enableImplicitConversion,
  // class-transformer hands @Transform the already-converted value, and
  // Boolean("false") is true (caught by the Phase 11 e2e spec).
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.BULL_BOARD_ENABLED === true || obj.BULL_BOARD_ENABLED === "true")
  @IsBoolean()
  BULL_BOARD_ENABLED: boolean = false;

  @IsOptional()
  @IsString()
  BULL_BOARD_USERNAME: string = "admin";

  @IsOptional()
  @IsString()
  BULL_BOARD_PASSWORD: string = "";
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const message = errors.map((e) => Object.values(e.constraints ?? {}).join("; ")).join(" | ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }

  if (validated.BULL_BOARD_ENABLED) {
    if (validated.NODE_ENV === "production") {
      throw new Error("Invalid environment configuration: BULL_BOARD_ENABLED must be false in production (SEC-NOTIF-005).");
    }
    if (validated.BULL_BOARD_PASSWORD.length < 12) {
      throw new Error("Invalid environment configuration: BULL_BOARD_PASSWORD (12+ characters) is required when BULL_BOARD_ENABLED=true.");
    }
  }

  return validated;
}
