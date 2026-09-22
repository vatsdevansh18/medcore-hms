import { randomUUID } from "node:crypto";
import type { Params } from "nestjs-pino";

/**
 * Structured logging config (Pino) — see docs/03-ARCHITECTURE.md §14 and
 * docs/09-SECURITY.md SEC-DATA-003. Every request gets a correlation id.
 * Header-level secrets are redacted here; the field-level redaction for
 * request/response *bodies* (password, otp, token, ...) is added in
 * Phase 3 once those fields actually exist on any DTO.
 */
export function buildLoggerConfig(nodeEnv: string, logLevel: string): Params {
  return {
    pinoHttp: {
      level: logLevel,
      genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", 'req.headers["set-cookie"]'],
        censor: "[REDACTED]",
      },
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
