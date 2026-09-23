import { plainToInstance } from "class-transformer";
import {
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

  return validated;
}
