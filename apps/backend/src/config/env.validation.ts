import { plainToInstance } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min, validateSync } from "class-validator";

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
