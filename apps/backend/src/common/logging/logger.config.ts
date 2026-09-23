import { randomUUID } from "node:crypto";
import { stdSerializers } from "pino";
import type { Params } from "nestjs-pino";

/**
 * Structured logging config (Pino) — see docs/03-ARCHITECTURE.md §14 and
 * docs/09-SECURITY.md SEC-DATA-003. Every request gets a correlation id.
 *
 * pino-http doesn't serialize the request body into logs by default, so
 * header-level redaction was sufficient through Phase 2. Phase 3 introduces
 * real password/token/OTP fields (Auth DTOs) — these paths are defensive
 * for any future code path that does log a body or a raw object containing
 * one of these fields (e.g. `logger.debug({ user })`), not just the
 * default req/res serializers.
 */
const SENSITIVE_FIELD_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["set-cookie"]',
  "req.body.password",
  "req.body.newPassword",
  "req.body.code",
  "req.body.token",
  "*.password",
  "*.passwordHash",
  "*.newPassword",
  "*.refreshToken",
  "*.accessToken",
  "*.otp",
  "*.code",
];

export function buildLoggerConfig(nodeEnv: string, logLevel: string): Params {
  return {
    pinoHttp: {
      level: logLevel,
      genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
      redact: {
        paths: SENSITIVE_FIELD_PATHS,
        censor: "[REDACTED]",
      },
      // Error.message/.stack are non-enumerable, so pino's default
      // JSON-serialization of a raw `err` object silently drops them,
      // leaving only whatever extra enumerable props the thrown class set
      // (e.g. Prisma errors' `clientVersion`) — found while debugging a
      // 500 in Phase 4 where the logged error carried no message at all.
      // See docs/phase-reviews/PHASE-4-REVIEW.md.
      serializers: { err: stdSerializers.err },
      transport:
        nodeEnv === "production"
          ? undefined
          : {
              target: "pino-pretty",
              options: {
                colorize: true,
                singleLine: true,
                translateTime: "HH:MM:ss",
              },
            },
      customProps: (req) => ({
        requestId: (req as { id?: string }).id,
      }),
    },
  };
}
